import { exec } from 'child_process';
import { promisify } from 'util';
import type { TestRunner, TestResult, TestRunOptions, TestFailure } from '../../types/test-runner.js';
import { debug, error } from '../logger.js';

const execAsync = promisify(exec);

interface JestTestResult {
  numPassedTests: number;
  numFailedTests: number;
  numTotalTests: number;
  numTotalTestSuites: number;
  testResults: Array<{
    name: string;
    status: 'passed' | 'failed';
    assertionResults: Array<{
      title: string;
      status: 'passed' | 'failed';
      failureMessages: string[];
    }>;
  }>;
}

/**
 * Find the Jest JSON result from stdout.
 * `npm test -- --json` prefixes output with script echo lines (e.g. "> test\n> jest"),
 * so we can't parse stdout directly. Search for the JSON object containing test results.
 */
function findJsonResultLine(stdout: string): string | null {
  const lines = stdout.trim().split('\n');
  // Search backwards since JSON is typically near the end
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('{') && line.includes('"numTotalTestSuites"')) {
      return line;
    }
  }
  // Fallback: try to find a JSON block that spans multiple lines
  // Jest sometimes outputs pretty-printed JSON
  const fullText = stdout.trim();
  const jsonStart = fullText.indexOf('{"numFailedTestSuites"');
  if (jsonStart === -1) {
    const altStart = fullText.indexOf('{"numFailedTests"');
    if (altStart !== -1) {
      return fullText.substring(altStart);
    }
    return null;
  }
  return fullText.substring(jsonStart);
}

/**
 * Parse Jest JSON result into per-file TestResult array.
 */
function parseJestResults(result: JestTestResult, testFiles: string[]): TestResult[] {
  return testFiles.map((testFile) => {
    // Match by filename suffix since Jest uses absolute paths in testResults
    const testResult = result.testResults.find(r => r.name.endsWith(testFile)) || null;
    const failures: TestFailure[] = [];
    let filePassed = 0;
    let fileFailed = 0;

    if (testResult) {
      for (const assertion of testResult.assertionResults) {
        if (assertion.status === 'failed') {
          fileFailed++;
          if (assertion.failureMessages.length > 0) {
            failures.push({
              testName: assertion.title,
              message: assertion.failureMessages[0],
              stack: assertion.failureMessages[0],
            });
          }
        } else {
          filePassed++;
        }
      }
    }

    return {
      success: fileFailed === 0,
      testFile,
      passed: filePassed,
      failed: fileFailed,
      total: filePassed + fileFailed,
      duration: 0,
      failures,
    };
  });
}

export class JestRunner implements TestRunner {
  async runTests(options: TestRunOptions): Promise<TestResult[]> {
    const { testFiles, packageManager, projectRoot, coverage } = options;
    
    debug(`Running Jest tests for ${testFiles.length} file(s)`);

    // Build Jest command
    const testFilesArg = testFiles.map(f => `"${f}"`).join(' ');
    const coverageFlag = coverage ? '--coverage --coverageReporters=json' : '--no-coverage';
    const cmd = `${packageManager} test -- --json ${coverageFlag} ${testFilesArg}`;

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: projectRoot,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      if (stderr && !stderr.includes('PASS') && !stderr.includes('FAIL')) {
        debug(`Jest stderr: ${stderr}`);
      }

      const jsonLine = findJsonResultLine(stdout);
      if (!jsonLine) {
        throw new Error('No valid JSON output from Jest');
      }

      const result = JSON.parse(jsonLine) as JestTestResult;
      return parseJestResults(result, testFiles);
    } catch (err: unknown) {
      // Jest returns non-zero exit code on failures, but stdout still contains JSON
      if (err && typeof err === 'object' && 'stdout' in err) {
        try {
          const jsonLine = findJsonResultLine(err.stdout as string);

          if (jsonLine) {
            const result = JSON.parse(jsonLine) as JestTestResult;
            return parseJestResults(result, testFiles);
          }
        } catch (parseErr) {
          error(`Failed to parse Jest output: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
          throw err;
        }
      }
      
      error(`Jest test execution failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
}

