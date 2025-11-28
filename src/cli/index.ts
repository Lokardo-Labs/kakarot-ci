#!/usr/bin/env node
/**
 * CLI entry point for Kakarot CI
 * Parses CI environment variables and runs test generation
 */

import { readFileSync } from 'fs';
import { simpleGit } from 'simple-git';
import gitUrlParse from 'git-url-parse';
import { Command } from 'commander';
import { runPullRequest, type PullRequestContext } from '../core/orchestrator.js';
import { error, info, debug } from '../utils/logger.js';
import { loadConfig } from '../utils/config-loader.js';
import { findProjectRoot } from '../utils/config-loader.js';

interface GitHubEvent {
  pull_request?: {
    number: number;
  };
  number?: number;
}

/**
 * Parse GitHub repository string (format: "owner/repo")
 */
function parseRepository(repo: string): { owner: string; repo: string } {
  const parts = repo.split('/');
  if (parts.length !== 2) {
    throw new Error(`Invalid repository format: ${repo}. Expected "owner/repo"`);
  }
  return { owner: parts[0], repo: parts[1] };
}

/**
 * Detect repository from current git working directory
 */
async function detectGitRepository(projectRoot: string): Promise<{ owner: string; repo: string } | null> {
  try {
    const git = simpleGit(projectRoot);
    
    // Get the remote URL (prefer origin, fallback to first remote)
    let remoteUrl: string | null = null;
    
    try {
      remoteUrl = await git.getRemotes(true).then(remotes => {
        const origin = remotes.find(r => r.name === 'origin');
        return origin?.refs?.fetch || origin?.refs?.push || null;
      });
      
      if (!remoteUrl) {
        const remotes = await git.getRemotes(true);
        if (remotes.length > 0) {
          remoteUrl = remotes[0].refs?.fetch || remotes[0].refs?.push || null;
        }
      }
    } catch {
      return null;
    }
    
    if (!remoteUrl) {
      return null;
    }
    
    // Parse GitHub URL
    try {
      const parsed = gitUrlParse(remoteUrl);
      if (parsed.resource === 'github.com') {
        return {
          owner: parsed.owner,
          repo: parsed.name.replace(/\.git$/, ''),
        };
      }
    } catch {
      // Not a GitHub URL or parse failed
      return null;
    }
    
    return null;
  } catch (err) {
    debug(`Failed to detect git repository: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Extract PR number from GitHub event JSON
 */
function extractPRNumber(eventPath?: string): number | null {
  if (!eventPath) {
    return null;
  }

  try {
    const eventContent = readFileSync(eventPath, 'utf-8');
    const event: GitHubEvent = JSON.parse(eventContent);

    if (event.pull_request?.number) {
      return event.pull_request.number;
    }

    if (event.number) {
      return event.number;
    }

    return null;
  } catch (err) {
    error(`Failed to read GitHub event file: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Main CLI function
 */
async function main(): Promise<void> {
  const program = new Command();

  program
    .name('kakarot-ci')
    .description('AI-powered unit test generation for pull requests')
    .version('0.2.0')
    .option('--pr <number>', 'Pull request number')
    .option('--owner <string>', 'Repository owner')
    .option('--repo <string>', 'Repository name')
    .option('--token <string>', 'GitHub token (or use GITHUB_TOKEN env var)')
    .parse(process.argv);

  const options = program.opts();

  // Load config first to get defaults
  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    // Config loading might fail if apiKey is missing, but we can continue
    config = null;
  }

  // Parse environment variables (with CLI args as highest priority, then config, then env)
  const githubRepository = process.env.GITHUB_REPOSITORY;
  const githubEventPath = process.env.GITHUB_EVENT_PATH;
  const githubToken = options.token || config?.githubToken || process.env.GITHUB_TOKEN;
  const prNumberEnv = process.env.PR_NUMBER;

  // Extract owner/repo from various sources (priority: CLI > env > config > git)
  let owner: string | undefined = options.owner;
  let repo: string | undefined = options.repo;

  // Try parsing from GITHUB_REPOSITORY if not provided via CLI
  if (!owner || !repo) {
    if (githubRepository) {
      try {
        const parsed = parseRepository(githubRepository);
        owner = owner || parsed.owner;
        repo = repo || parsed.repo;
      } catch (err) {
        if (!owner && !repo) {
          error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      }
    }
  }

  // Fallback to config defaults
  if (!owner || !repo) {
    owner = owner || config?.githubOwner;
    repo = repo || config?.githubRepo;
  }

  // Fallback to git repository detection
  if (!owner || !repo) {
    const projectRoot = await findProjectRoot();
    const gitRepo = await detectGitRepository(projectRoot);
    if (gitRepo) {
      owner = owner || gitRepo.owner;
      repo = repo || gitRepo.repo;
      debug(`Detected repository from git: ${owner}/${repo}`);
    }
  }

  // Validate required values
  if (!owner || !repo) {
    error('Repository owner and name are required.');
    error('Provide via:');
    error('  - Config file: githubOwner and githubRepo');
    error('  - CLI flags: --owner and --repo');
    error('  - Environment: GITHUB_REPOSITORY (format: "owner/repo")');
    error('  - Git remote: auto-detected from current repository');
    process.exit(1);
  }

  if (!githubToken) {
    error('GitHub token is required.');
    error('Provide via:');
    error('  - Config file: githubToken');
    error('  - CLI flag: --token');
    error('  - Environment: GITHUB_TOKEN');
    process.exit(1);
  }

  // Extract PR number from various sources
  let prNumber: number | null = null;

  // Priority: CLI arg > env var > GitHub event file
  if (options.pr) {
    prNumber = parseInt(String(options.pr), 10);
    if (isNaN(prNumber)) {
      error(`Invalid PR number: ${options.pr}`);
      process.exit(1);
    }
  } else if (prNumberEnv) {
    const parsed = parseInt(prNumberEnv, 10);
    if (!isNaN(parsed)) {
      prNumber = parsed;
    }
  } else if (githubEventPath) {
    prNumber = extractPRNumber(githubEventPath);
  }

  if (!prNumber) {
    error('Pull request number is required.');
    error('Provide via:');
    error('  - CLI flag: --pr <number>');
    error('  - Environment: PR_NUMBER');
    error('  - GitHub Actions: GITHUB_EVENT_PATH (auto-detected)');
    process.exit(1);
  }

  // Build context
  const context: PullRequestContext = {
    prNumber,
    owner,
    repo,
    githubToken,
  };

  info(`Starting Kakarot CI for PR #${prNumber} in ${owner}/${repo}`);

  try {
    const summary = await runPullRequest(context);

    // Exit with error code if there were failures
    if (summary.errors.length > 0 || summary.testsFailed > 0) {
      error(`Test generation completed with errors: ${summary.errors.length} error(s), ${summary.testsFailed} test(s) failed`);
      process.exit(1);
    }

    info(`Test generation completed successfully: ${summary.testsGenerated} test(s) generated`);
    process.exit(0);
  } catch (err) {
    error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) {
      error(err.stack);
    }
    process.exit(1);
  }
}

// Run CLI
main().catch((err) => {
  error(`Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
