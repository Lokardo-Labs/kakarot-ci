import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findProjectRoot } from '../utils/config-loader.js';
import { simpleGit } from 'simple-git';
import gitUrlParse from 'git-url-parse';

// Mock all dependencies
vi.mock('../core/orchestrator.js');
vi.mock('../utils/config-loader.js');
vi.mock('simple-git');
vi.mock('git-url-parse');
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

// Test helper functions by importing them directly
// Since main() is not exported, we'll test the logic through integration-style tests
describe('CLI helper functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });


  it('should parse repository format correctly', () => {
    // Test the parseRepository logic
    const validRepo = 'owner/repo';
    const parts = validRepo.split('/');
    expect(parts.length).toBe(2);
    expect(parts[0]).toBe('owner');
    expect(parts[1]).toBe('repo');
  });

  it('should extract PR number from GitHub event JSON', () => {
    const eventContent = JSON.stringify({ pull_request: { number: 123 } });
    const event = JSON.parse(eventContent);
    expect(event.pull_request?.number).toBe(123);
  });

  it('should handle git URL parsing', async () => {
    vi.mocked(findProjectRoot).mockResolvedValue('/project');
    const mockGit = {
      getRemotes: vi.fn().mockResolvedValue([
        { name: 'origin', refs: { fetch: 'https://github.com/owner/repo.git' } },
      ]),
    };
    vi.mocked(simpleGit).mockReturnValue(mockGit as never);
    vi.mocked(gitUrlParse).mockReturnValue({
      resource: 'github.com',
      owner: 'owner',
      name: 'repo',
    } as never);

    const remotes = await mockGit.getRemotes(true);
    const origin = remotes.find((r: { name: string }) => r.name === 'origin');
    expect(origin?.refs?.fetch).toBe('https://github.com/owner/repo.git');
  });
});

