import { Octokit } from '@octokit/rest';
import type { PullRequest, PullRequestFile, FileContents, GitHubClientOptions } from '../types/github.js';
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
   * Commit or update a file in the repository
   */
  async commitOrUpdateFile(
    path: string,
    content: string,
    message: string,
    branch: string,
    sha?: string
  ): Promise<string> {
    return this.withRetry(async () => {
      debug(`Committing file: ${path} to branch ${branch}`);
      
      const fileContent = Buffer.from(content, 'utf-8').toString('base64');

      const params: Parameters<typeof this.octokit.rest.repos.createOrUpdateFileContents>[0] = {
        owner: this.owner,
        repo: this.repo,
        path,
        message,
        content: fileContent,
        branch,
      };

      if (sha) {
        params.sha = sha;
      }

      const response = await this.octokit.rest.repos.createOrUpdateFileContents(params);
      
      if (!response.data.commit.sha) {
        throw new Error('Failed to get commit SHA from response');
      }
      
      return response.data.commit.sha;
    }, `commitOrUpdateFile(${path})`);
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

