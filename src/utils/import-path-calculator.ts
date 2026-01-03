import { dirname, relative, normalize } from 'path';

/**
 * Calculate the correct import path from a test file to a source file
 */
export function calculateImportPath(
  testFilePath: string,
  sourceFilePath: string
): string {
  // Normalize paths to handle different separators
  const testDir = normalize(dirname(testFilePath));
  
  // Get relative path from test directory to source file
  const relativePath = relative(testDir, normalize(sourceFilePath));
  
  // Remove file extension
  const pathWithoutExt = relativePath.replace(/\.(ts|tsx|js|jsx)$/, '');
  
  // Ensure path starts with ./ or ../ (not just the filename)
  if (!pathWithoutExt.startsWith('.')) {
    return `./${pathWithoutExt}`;
  }
  
  return pathWithoutExt;
}

/**
 * Extract the base name (without extension) from a file path
 */
export function getBaseName(filePath: string): string {
  const fileName = filePath.substring(filePath.lastIndexOf('/') + 1);
  return fileName.replace(/\.(ts|tsx|js|jsx)$/, '');
}

