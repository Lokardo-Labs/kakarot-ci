import { existsSync } from 'fs';
import { join } from 'path';

export type PackageManager = 'npm' | 'yarn' | 'pnpm';

/**
 * Detect package manager from project files
 */
export function detectPackageManager(projectRoot: string): PackageManager {
  // Check for lock files (most reliable indicator)
  if (existsSync(join(projectRoot, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  
  if (existsSync(join(projectRoot, 'yarn.lock'))) {
    return 'yarn';
  }
  
  if (existsSync(join(projectRoot, 'package-lock.json'))) {
    return 'npm';
  }
  
  // Default to npm if no lock file found
  return 'npm';
}

