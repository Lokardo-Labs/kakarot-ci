import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { debug } from './logger.js';

/**
 * Write test files to disk in the project directory
 */
export function writeTestFiles(
  testFiles: Map<string, { content: string; targets: string[] }>,
  projectRoot: string
): string[] {
  const writtenPaths: string[] = [];

  for (const [relativePath, fileData] of testFiles.entries()) {
    const fullPath = join(projectRoot, relativePath);
    const dir = dirname(fullPath);

    // Create directory if it doesn't exist
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      debug(`Created directory: ${dir}`);
    }

    // Write test file
    writeFileSync(fullPath, fileData.content, 'utf-8');
    writtenPaths.push(relativePath);
    debug(`Wrote test file: ${relativePath}`);
  }

  return writtenPaths;
}

