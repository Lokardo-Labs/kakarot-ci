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

/**
 * Find the Vitest JSON result line from stdout.
 * Vitest 4 may output pool warnings before/after the JSON line,
 * so we can't assume it's the last line.
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
  return null;
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

      const jsonLine = findJsonResultLine(stdout);
      if (!jsonLine) {
        throw new Error('No valid JSON output from Vitest');
      }

      const result = JSON.parse(jsonLine) as VitestTestResult;

      return testFiles.map((testFile) => {
        // Match by filename suffix since Vitest uses absolute paths in testResults
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
    } catch (err: unknown) {
      // Vitest returns non-zero exit code on failures, but stdout may still contain JSON
      if (err && typeof err === 'object' && 'stdout' in err) {
        try {
          const jsonLine = findJsonResultLine(err.stdout as string);
          
          if (jsonLine) {
            const result = JSON.parse(jsonLine) as VitestTestResult;
            return testFiles.map((testFile) => {
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

