import { Octokit } from '@octokit/rest';
import type { PullRequest, PullRequestFile, FileContents, GitHubClientOptions, BatchCommitOptions } from '../types/github.js';
import { debug, error, warn } from '../utils/logger.js';

/**
 * GitHub API client wrapper with retry and rate-limit handling
 */
export class GitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;
  private maxRetries = 3;
  private retryDelay = 1000; // 1 second

  constructor(options: GitHubClientOptions) {
    this.owner = options.owner;
    this.repo = options.repo;
    this.octokit = new Octokit({
      auth: options.token,
      request: {
        retries: this.maxRetries,
        retryAfter: this.retryDelay / 1000,
      },
    });
  }

  /**
   * Retry wrapper with exponential backoff
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    operation: string,
    retries = this.maxRetries
  ): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      // Don't retry on 404 errors - they're expected for file not found
      const isNotFound = err && typeof err === 'object' && 'status' in err && err.status === 404;
      if (isNotFound) {
        throw err; // Re-throw so caller can handle it
      }

      if (retries <= 0) {
        error(`${operation} failed after ${this.maxRetries} retries: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }

      const isRateLimit = err instanceof Error && err.message.includes('rate limit');
      const isServerError = err instanceof Error && (
        err.message.includes('500') ||
        err.message.includes('502') ||
        err.message.includes('503') ||
        err.message.includes('504')
      );

      if (isRateLimit || isServerError) {
        const delay = this.retryDelay * Math.pow(2, this.maxRetries - retries);
        warn(`${operation} failed, retrying in ${delay}ms... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.withRetry(fn, operation, retries - 1);
      }

      throw err;
    }
  }

  /**
   * Get pull request details
   */
  async getPullRequest(prNumber: number): Promise<PullRequest> {
    return this.withRetry(async () => {
      debug(`Fetching PR #${prNumber}`);
      const response = await this.octokit.rest.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
      });
      return response.data as PullRequest;
    }, `getPullRequest(${prNumber})`);
  }

  /**
   * List all files changed in a pull request with patches
   */
  async listPullRequestFiles(prNumber: number): Promise<PullRequestFile[]> {
    return this.withRetry(async () => {
      debug(`Fetching files for PR #${prNumber}`);
      const response = await this.octokit.rest.pulls.listFiles({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
      });
      return response.data.map(file => ({
        filename: file.filename,
        status: file.status as PullRequestFile['status'],
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch || undefined,
        previous_filename: file.previous_filename || undefined,
      }));
    }, `listPullRequestFiles(${prNumber})`);
  }

  /**
   * Get file contents from a specific ref (branch, commit, etc.)
   */
  async getFileContents(ref: string, path: string): Promise<FileContents> {
    return this.withRetry(async () => {
      debug(`Fetching file contents: ${path}@${ref}`);
      const response = await this.octokit.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref,
      });

      if (Array.isArray(response.data)) {
        throw new Error(`Expected file but got directory: ${path}`);
      }

      const data = response.data as { content: string; encoding: string; sha: string; size: number };
      
      // Decode base64 content
      let content: string;
      if (data.encoding === 'base64') {
        content = Buffer.from(data.content, 'base64').toString('utf-8');
      } else {
        content = data.content;
      }

      return {
        content,
        encoding: data.encoding as 'base64' | 'utf-8',
        sha: data.sha,
        size: data.size,
      };
    }, `getFileContents(${ref}, ${path})`);
  }

  /**
   * Commit multiple files in a single commit using Git tree API
   */
  async commitFiles(options: BatchCommitOptions): Promise<string> {
    return this.withRetry(async () => {
      debug(`Committing ${options.files.length} file(s) to branch ${options.branch}`);

      // Get the base tree SHA
      const baseCommit = await this.octokit.rest.repos.getCommit({
        owner: this.owner,
        repo: this.repo,
        ref: options.baseSha,
      });
      const baseTreeSha = baseCommit.data.commit.tree.sha;

      // Create blobs for all files
      const blobPromises = options.files.map(async (file) => {
        const blobResponse = await this.octokit.rest.git.createBlob({
          owner: this.owner,
          repo: this.repo,
          content: Buffer.from(file.content, 'utf-8').toString('base64'),
          encoding: 'base64',
        });
        return {
          path: file.path,
          sha: blobResponse.data.sha,
          mode: '100644' as const,
          type: 'blob' as const,
        };
      });

      const treeItems = await Promise.all(blobPromises);

      // Create a new tree with the blobs
      const treeResponse = await this.octokit.rest.git.createTree({
        owner: this.owner,
        repo: this.repo,
        base_tree: baseTreeSha,
        tree: treeItems,
      });

      // Create the commit
      const commitResponse = await this.octokit.rest.git.createCommit({
        owner: this.owner,
        repo: this.repo,
        message: options.message,
        tree: treeResponse.data.sha,
        parents: [options.baseSha],
      });

      // Update the branch reference
      await this.octokit.rest.git.updateRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${options.branch}`,
        sha: commitResponse.data.sha,
      });

      return commitResponse.data.sha;
    }, `commitFiles(${options.files.length} files)`);
  }

  /**
   * Create a new branch from a base ref
   */
  async createBranch(branchName: string, baseRef: string): Promise<string> {
    return this.withRetry(async () => {
      debug(`Creating branch ${branchName} from ${baseRef}`);

      // Get the SHA of the base ref
      const baseRefResponse = await this.octokit.rest.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: baseRef.startsWith('refs/') ? baseRef : `heads/${baseRef}`,
      });
      const baseSha = baseRefResponse.data.object.sha;

      // Create the new branch
      await this.octokit.rest.git.createRef({
        owner: this.owner,
        repo: this.repo,
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      });

      return baseSha;
    }, `createBranch(${branchName})`);
  }

  /**
   * Create a pull request
   */
  async createPullRequest(
    title: string,
    body: string,
    head: string,
    base: string
  ): Promise<PullRequest> {
    return this.withRetry(async () => {
      debug(`Creating PR: ${head} -> ${base}`);

      const response = await this.octokit.rest.pulls.create({
        owner: this.owner,
        repo: this.repo,
        title,
        body,
        head,
        base,
      });

      return response.data as PullRequest;
    }, `createPullRequest(${head} -> ${base})`);
  }

  /**
   * Post a comment on a pull request
   */
  async commentPR(prNumber: number, body: string): Promise<void> {
    await this.withRetry(async () => {
      debug(`Posting comment on PR #${prNumber}`);
      await this.octokit.rest.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: prNumber,
        body,
      });
    }, `commentPR(${prNumber})`);
  }

  /**
   * Check if a file exists in the repository
   */
  async fileExists(ref: string, path: string): Promise<boolean> {
    // Suppress 404 errors from console - they're expected
    const originalError = console.error;
    const originalWarn = console.warn;
    
    const suppress404 = (...args: unknown[]): void => {
      const message = String(args[0] || '');
      if (message.includes('404') || message.includes('Not Found')) {
        return; // Don't log 404s
      }
      originalError(...args);
    };
    
    const suppress404Warn = (...args: unknown[]): void => {
      const message = String(args[0] || '');
      if (message.includes('404') || message.includes('Not Found')) {
        return; // Don't log 404s
      }
      originalWarn(...args);
    };
    
    try {
      console.error = suppress404;
      console.warn = suppress404Warn;
      
      await this.octokit.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref,
      });
      return true;
    } catch (err) {
      // Handle 404 as file not found (not an error)
      // Octokit RequestError has status property at the top level
      const status = (err && typeof err === 'object' && 'status' in err) ? (err as { status: number }).status : undefined;
      if (status === 404) {
        return false;
      }
      // Also check error message for 404 (fallback for different error formats)
      if (err instanceof Error) {
        const message = err.message.toLowerCase();
        if (message.includes('404') || message.includes('not found')) {
          return false;
        }
      }
      // For any other error, throw it (will be handled by withRetry if called from other methods)
      throw err;
    } finally {
      // Restore original console methods
      console.error = originalError;
      console.warn = originalWarn;
    }
  }

  /**
   * Get the current rate limit status
   */
  async getRateLimit(): Promise<{ remaining: number; reset: number }> {
    const response = await this.octokit.rest.rateLimit.get();
    return {
      remaining: response.data.rate.remaining,
      reset: response.data.rate.reset,
    };
  }
}

