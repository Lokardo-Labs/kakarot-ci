import type { KakarotConfig } from '../types/config.js';
import type { TestTarget } from '../types/diff.js';

/**
 * Determine the test file path for a test target based on configuration
 */
export function getTestFilePath(
  target: TestTarget,
  config: Pick<KakarotConfig, 'testLocation' | 'testDirectory' | 'testFilePattern'>
): string {
  const sourcePath = target.filePath;
  const dir = sourcePath.substring(0, sourcePath.lastIndexOf('/'));
  const baseName = sourcePath.substring(sourcePath.lastIndexOf('/') + 1).replace(/\.(ts|tsx|js|jsx)$/, '');
  
  // Determine file extension
  let ext: 'ts' | 'tsx' | 'js' | 'jsx';
  if (sourcePath.endsWith('.tsx')) ext = 'tsx';
  else if (sourcePath.endsWith('.jsx')) ext = 'jsx';
  else if (sourcePath.endsWith('.ts')) ext = 'ts';
  else ext = 'js';

  // Determine test file extension (prefer matching source type)
  const testExt = ext === 'tsx' || ext === 'ts' ? 'ts' : 'js';

  if (config.testLocation === 'co-located') {
    // Co-located: same directory as source file
    return `${dir}/${baseName}.test.${testExt}`;
  } else {
    // Separate: in test directory
    // Replace testFilePattern wildcard with actual filename
    const testFileName = config.testFilePattern.replace('*', baseName);
    return `${config.testDirectory}/${testFileName}`;
  }
}

