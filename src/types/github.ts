/**
 * GitHub API types for Kakarot CI
 */

export interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  head: {
    ref: string;
    sha: string;
    repo: {
      owner: {
        login: string;
      };
      name: string;
    };
  };
  base: {
    ref: string;
    sha: string;
    repo: {
      owner: {
        login: string;
      };
      name: string;
    };
  };
  user: {
    login: string;
  };
}

export interface PullRequestFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previous_filename?: string;
}

export interface FileContents {
  content: string;
  encoding: 'base64' | 'utf-8';
  sha: string;
  size: number;
}

export interface CommitFile {
  path: string;
  mode: '100644' | '100755' | '040000' | '160000' | '120000';
  type: 'blob' | 'tree' | 'commit';
  sha?: string;
  content?: string;
}

export interface GitHubClientOptions {
  token: string;
  owner: string;
  repo: string;
}

