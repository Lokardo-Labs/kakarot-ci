/**
 * Types for test execution and results
 */

export interface TestResult {
  success: boolean;
  testFile: string;
  passed: number;
  failed: number;
  total: number;
  duration: number;
  failures: TestFailure[];
}

export interface TestFailure {
  testName: string;
  message: string;
  stack?: string;
  line?: number;
  column?: number;
}

export interface TestRunOptions {
  testFiles: string[];
  framework: 'jest' | 'vitest';
  packageManager: 'npm' | 'yarn' | 'pnpm';
  projectRoot: string;
  coverage?: boolean;
}

export interface TestRunner {
  runTests(options: TestRunOptions): Promise<TestResult[]>;
}

