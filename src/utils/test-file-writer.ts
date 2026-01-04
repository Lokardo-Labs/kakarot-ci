import { writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { debug, warn, error } from './logger.js';
import { validateTestFile } from './file-validator.js';

/**
 * Write test files to disk atomically with validation
 */
export async function writeTestFiles(
  testFiles: Map<string, { content: string; targets: string[] }>,
  projectRoot: string,
  privatePropertiesMap?: Map<string, string[]>
): Promise<{ writtenPaths: string[]; failedPaths: string[] }> {
  const writtenPaths: string[] = [];
  const failedPaths: string[] = [];

  for (const [relativePath, fileData] of testFiles.entries()) {
    const fullPath = join(projectRoot, relativePath);
    const tempPath = fullPath + '.tmp';
    const dir = dirname(fullPath);

    try {
    // Create directory if it doesn't exist
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      debug(`Created directory: ${dir}`);
    }

      // Validate file before writing
      const privateProperties = privatePropertiesMap?.get(relativePath);
      let validation = await validateTestFile(relativePath, fileData.content, projectRoot, privateProperties);
      
      // If missing imports detected, fix them automatically
      if (validation.missingImports && validation.missingImports.length > 0) {
        const { fixMissingImports } = await import('./import-fixer.js');
        // Detect framework from file content
        const isVitest = fileData.content.includes("from 'vitest'") || fileData.content.includes('from "vitest"');
        const framework = isVitest ? 'vitest' : 'jest';
        fileData.content = fixMissingImports(fileData.content, validation.missingImports, framework);
        // Re-validate after fixing imports
        validation = await validateTestFile(relativePath, fileData.content, projectRoot, privateProperties);
      }
      
      if (!validation.valid) {
        error(`Test file validation failed for ${relativePath}:`);
        validation.errors.forEach(err => error(`  - ${err}`));
        failedPaths.push(relativePath);
        continue; // Skip writing invalid file
      }
      
      if (validation.warnings.length > 0) {
        validation.warnings.forEach(w => warn(`  - ${w}`));
      }

      // Write to temp file first (atomic write)
      writeFileSync(tempPath, fileData.content, 'utf-8');
      
      // Validate temp file exists and is readable
      if (!existsSync(tempPath)) {
        throw new Error('Failed to write temp file');
      }
      
      // Move temp file to final location (atomic)
      renameSync(tempPath, fullPath);
      
    writtenPaths.push(relativePath);
    debug(`Wrote test file: ${relativePath}`);
    } catch (err) {
      // Clean up temp file if it exists
      try {
        if (existsSync(tempPath)) {
          unlinkSync(tempPath);
        }
      } catch {
        // Ignore cleanup errors
      }
      
      const errorMessage = err instanceof Error ? err.message : String(err);
      error(`Failed to write test file ${relativePath}: ${errorMessage}`);
      failedPaths.push(relativePath);
    }
  }

  return { writtenPaths, failedPaths };
}

