import type { TestRunner } from '../../types/test-runner.js';
import { JestRunner } from './jest-runner.js';
import { VitestRunner } from './vitest-runner.js';

/**
 * Create a test runner for the specified framework
 */
export function createTestRunner(framework: 'jest' | 'vitest'): TestRunner {
  switch (framework) {
    case 'jest':
      return new JestRunner();
    case 'vitest':
      return new VitestRunner();
    default:
      throw new Error(`Unsupported test framework: ${framework}`);
  }
}

