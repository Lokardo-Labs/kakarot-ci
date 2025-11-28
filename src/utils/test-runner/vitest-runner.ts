import { exec } from 'child_process';
import { promisify } from 'util';
import type { TestRunner, TestResult, TestRunOptions, TestFailure } from '../../types/test-runner.js';
import { debug, error } from '../logger.js';

const execAsync = promisify(exec);

interface VitestTestResult {
  numPassedTests: number;
  numFailedTests: number;
  numTotalTests: number;
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

export class VitestRunner implements TestRunner {
  async runTests(options: TestRunOptions): Promise<TestResult[]> {
    const { testFiles, packageManager, projectRoot, coverage } = options;
    
    debug(`Running Vitest tests for ${testFiles.length} file(s)`);

    // Build Vitest command
    const testFilesArg = testFiles.map(f => `"${f}"`).join(' ');
    const coverageFlag = coverage ? '--coverage' : '';
    const cmd = `${packageManager} test -- --reporter=json ${coverageFlag} ${testFilesArg}`;

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: projectRoot,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      if (stderr && !stderr.includes('PASS') && !stderr.includes('FAIL')) {
        debug(`Vitest stderr: ${stderr}`);
      }

      // Vitest JSON output is line-delimited, get the last line
      const lines = stdout.trim().split('\n');
      const jsonLine = lines[lines.length - 1];
      
      if (!jsonLine || !jsonLine.startsWith('{')) {
        throw new Error('No valid JSON output from Vitest');
      }

      const result = JSON.parse(jsonLine) as VitestTestResult;

      return testFiles.map((testFile, index) => {
        const testResult = result.testResults[index] || result.testResults[0];
        const failures: TestFailure[] = [];

        if (testResult) {
          for (const assertion of testResult.assertionResults) {
            if (assertion.status === 'failed' && assertion.failureMessages.length > 0) {
              const failureMessage = assertion.failureMessages[0];
              failures.push({
                testName: assertion.title,
                message: failureMessage,
                stack: failureMessage,
              });
            }
          }
        }

        return {
          success: result.numFailedTests === 0,
          testFile,
          passed: result.numPassedTests,
          failed: result.numFailedTests,
          total: result.numTotalTests,
          duration: 0, // Vitest JSON doesn't include duration per file
          failures,
        };
      });
    } catch (err: unknown) {
      // Vitest returns non-zero exit code on failures, but stdout may still contain JSON
      if (err && typeof err === 'object' && 'stdout' in err) {
        try {
          const lines = (err.stdout as string).trim().split('\n');
          const jsonLine = lines[lines.length - 1];
          
          if (jsonLine && jsonLine.startsWith('{')) {
            const result = JSON.parse(jsonLine) as VitestTestResult;
            return testFiles.map((testFile) => {
              const failures: TestFailure[] = [];
              
              for (const testResult of result.testResults) {
                for (const assertion of testResult.assertionResults) {
                  if (assertion.status === 'failed' && assertion.failureMessages.length > 0) {
                    failures.push({
                      testName: assertion.title,
                      message: assertion.failureMessages[0],
                      stack: assertion.failureMessages[0],
                    });
                  }
                }
              }

              return {
                success: result.numFailedTests === 0,
                testFile,
                passed: result.numPassedTests,
                failed: result.numFailedTests,
                total: result.numTotalTests,
                duration: 0,
                failures,
              };
            });
          }
        } catch (parseErr) {
          error(`Failed to parse Vitest output: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
          throw err;
        }
      }
      
      error(`Vitest test execution failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
}

