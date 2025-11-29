import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubClient } from './client.js';
import { Octokit } from '@octokit/rest';

vi.mock('@octokit/rest');
vi.mock('../utils/logger.js', () => ({
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

describe('GitHubClient', () => {
  let client: GitHubClient;
  let mockOctokit: {
    rest: {
      pulls: { get: ReturnType<typeof vi.fn>; listFiles: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
      repos: { getContent: ReturnType<typeof vi.fn>; getCommit: ReturnType<typeof vi.fn> };
      git: {
        createBlob: ReturnType<typeof vi.fn>;
        createTree: ReturnType<typeof vi.fn>;
        createCommit: ReturnType<typeof vi.fn>;
        updateRef: ReturnType<typeof vi.fn>;
        getRef: ReturnType<typeof vi.fn>;
        createRef: ReturnType<typeof vi.fn>;
      };
      issues: { createComment: ReturnType<typeof vi.fn> };
      rateLimit: { get: ReturnType<typeof vi.fn> };
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOctokit = {
      rest: {
        pulls: {
          get: vi.fn(),
          listFiles: vi.fn(),
          create: vi.fn(),
        },
        repos: {
          getContent: vi.fn(),
          getCommit: vi.fn(),
        },
        git: {
          createBlob: vi.fn(),
          createTree: vi.fn(),
          createCommit: vi.fn(),
          updateRef: vi.fn(),
          getRef: vi.fn(),
          createRef: vi.fn(),
        },
        issues: {
          createComment: vi.fn(),
        },
        rateLimit: {
          get: vi.fn(),
        },
      },
    };
    vi.mocked(Octokit).mockImplementation(() => mockOctokit as never);
    client = new GitHubClient({ owner: 'owner', repo: 'repo', token: 'token' });
  });

  it('should get pull request', async () => {
    mockOctokit.rest.pulls.get.mockResolvedValue({
      data: { number: 1, title: 'Test PR' },
    } as never);

    const pr = await client.getPullRequest(1);

    expect(pr.number).toBe(1);
    expect(mockOctokit.rest.pulls.get).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      pull_number: 1,
    });
  });

  it('should list pull request files', async () => {
    mockOctokit.rest.pulls.listFiles.mockResolvedValue({
      data: [
        { filename: 'file.ts', status: 'added', additions: 10, deletions: 0, changes: 10, patch: 'diff' },
      ],
    } as never);

    const files = await client.listPullRequestFiles(1);

    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe('file.ts');
  });

  it('should get file contents', async () => {
    const content = Buffer.from('file content').toString('base64');
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: { content, encoding: 'base64', sha: 'abc123', size: 100 },
    } as never);

    const result = await client.getFileContents('main', 'file.ts');

    expect(result.content).toBe('file content');
    expect(result.encoding).toBe('base64');
  });

  it('should commit files', async () => {
    mockOctokit.rest.repos.getCommit.mockResolvedValue({
      data: { commit: { tree: { sha: 'tree-sha' } } },
    } as never);
    mockOctokit.rest.git.createBlob.mockResolvedValue({
      data: { sha: 'blob-sha' },
    } as never);
    mockOctokit.rest.git.createTree.mockResolvedValue({
      data: { sha: 'new-tree-sha' },
    } as never);
    mockOctokit.rest.git.createCommit.mockResolvedValue({
      data: { sha: 'commit-sha' },
    } as never);
    mockOctokit.rest.git.updateRef.mockResolvedValue({} as never);

    const sha = await client.commitFiles({
      branch: 'test-branch',
      baseSha: 'base-sha',
      message: 'Test commit',
      files: [{ path: 'file.ts', content: 'content' }],
    });

    expect(sha).toBe('commit-sha');
    expect(mockOctokit.rest.git.createBlob).toHaveBeenCalled();
    expect(mockOctokit.rest.git.createTree).toHaveBeenCalled();
    expect(mockOctokit.rest.git.createCommit).toHaveBeenCalled();
  });

  it('should create branch', async () => {
    mockOctokit.rest.git.getRef.mockResolvedValue({
      data: { object: { sha: 'base-sha' } },
    } as never);
    mockOctokit.rest.git.createRef.mockResolvedValue({} as never);

    const sha = await client.createBranch('new-branch', 'main');

    expect(sha).toBe('base-sha');
    expect(mockOctokit.rest.git.createRef).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      ref: 'refs/heads/new-branch',
      sha: 'base-sha',
    });
  });

  it('should create pull request', async () => {
    mockOctokit.rest.pulls.create.mockResolvedValue({
      data: { number: 1, title: 'Test PR' },
    } as never);

    const pr = await client.createPullRequest('Title', 'Body', 'head', 'base');

    expect(pr.number).toBe(1);
    expect(mockOctokit.rest.pulls.create).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      title: 'Title',
      body: 'Body',
      head: 'head',
      base: 'base',
    });
  });

  it('should comment on PR', async () => {
    mockOctokit.rest.issues.createComment.mockResolvedValue({} as never);

    await client.commentPR(1, 'Comment');

    expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      issue_number: 1,
      body: 'Comment',
    });
  });

  it('should check if file exists', async () => {
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: { content: 'test' },
    } as never);

    const exists = await client.fileExists('main', 'file.ts');

    expect(exists).toBe(true);
  });

  it('should return false if file does not exist', async () => {
    mockOctokit.rest.repos.getContent.mockRejectedValue(
      new Error('404 Not Found')
    );

    const exists = await client.fileExists('main', 'file.ts');

    expect(exists).toBe(false);
  });

  it('should get rate limit', async () => {
    mockOctokit.rest.rateLimit.get.mockResolvedValue({
      data: { rate: { remaining: 100, reset: 1234567890 } },
    } as never);

    const limit = await client.getRateLimit();

    expect(limit.remaining).toBe(100);
    expect(limit.reset).toBe(1234567890);
  });
});

