import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectPackageManager } from './package-manager-detector.js';
import { existsSync } from 'fs';
import type { PathLike } from 'fs';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('path', () => ({
  join: (...args: string[]) => args.join('/'),
}));

describe('detectPackageManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should detect pnpm from pnpm-lock.yaml', () => {
    vi.mocked(existsSync).mockImplementation((path: PathLike) => {
      return String(path).includes('pnpm-lock.yaml');
    });

    const result = detectPackageManager('/project');

    expect(result).toBe('pnpm');
    expect(existsSync).toHaveBeenCalledWith('/project/pnpm-lock.yaml');
  });

  it('should detect yarn from yarn.lock', () => {
    vi.mocked(existsSync).mockImplementation((path: PathLike) => {
      return String(path).includes('yarn.lock');
    });

    const result = detectPackageManager('/project');

    expect(result).toBe('yarn');
  });

  it('should detect npm from package-lock.json', () => {
    vi.mocked(existsSync).mockImplementation((path: PathLike) => {
      return String(path).includes('package-lock.json');
    });

    const result = detectPackageManager('/project');

    expect(result).toBe('npm');
  });

  it('should default to npm when no lock file exists', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = detectPackageManager('/project');

    expect(result).toBe('npm');
  });

  it('should prioritize pnpm over yarn and npm', () => {
    vi.mocked(existsSync).mockImplementation((path: PathLike) => {
      const pathStr = String(path);
      return (
        pathStr.includes('pnpm-lock.yaml') ||
        pathStr.includes('yarn.lock') ||
        pathStr.includes('package-lock.json')
      );
    });

    const result = detectPackageManager('/project');

    expect(result).toBe('pnpm');
  });

  it('should prioritize yarn over npm', () => {
    vi.mocked(existsSync).mockImplementation((path: PathLike) => {
      const pathStr = String(path);
      return pathStr.includes('yarn.lock') || pathStr.includes('package-lock.json');
    });

    const result = detectPackageManager('/project');

    expect(result).toBe('yarn');
  });
});

