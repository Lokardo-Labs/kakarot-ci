/**
 * Core test generation logic shared between PR and local modes
 */

import type { KakarotConfig } from '../types/config.js';
import type { TestTarget } from '../types/diff.js';
import { TestGenerator } from '../llm/test-generator.js';
import { getTestFilePath } from '../utils/test-file-path.js';
import { calculateImportPath } from '../utils/import-path-calculator.js';
import { detectPackageManager } from '../utils/package-manager-detector.js';
import { createTestRunner } from '../utils/test-runner/factory.js';
import { writeTestFiles } from '../utils/test-file-writer.js';
import { readCoverageReport } from '../utils/coverage-reader.js';
import type { CoverageDelta } from '../types/coverage.js';
import { formatGeneratedCode, lintGeneratedCode } from '../utils/code-standards.js';
import { findProjectRoot } from '../utils/config-loader.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { info, error, warn, success, progress } from '../utils/logger.js';
import type { TestResult } from '../types/test-runner.js';
import type { CoverageReport } from '../types/coverage.js';

export interface TestGenerationOptions {
  targets: TestTarget[];
  config: KakarotConfig;
  mode: 'pr' | 'scaffold' | 'full';
  getExistingTestFile?: (testFilePath: string) => Promise<string | undefined>;
}

/**
 * Map test file paths to their original function targets
 */
interface TestFileToTargetsMap {
  [testFilePath: string]: TestTarget[];
}

export interface TestGenerationResult {
  targetsProcessed: number;
  testsGenerated: number;
  testsFailed: number;
  testFiles: Array<{
    path: string;
    targets: string[];
  }>;
  errors: Array<{
    target: string;
    error: string;
  }>;
  coverageReport?: CoverageReport;
  coverageDelta?: CoverageDelta;
  testResults?: TestResult[];
  finalTestFiles: Map<string, { content: string; targets: string[] }>;
}

/**
 * Core test generation logic - shared between PR and local modes
 */
export async function generateTestsFromTargets(
  options: TestGenerationOptions
): Promise<TestGenerationResult> {
  const { targets, config, mode, getExistingTestFile } = options;

  if (targets.length === 0) {
    return {
      targetsProcessed: 0,
      testsGenerated: 0,
      testsFailed: 0,
      testFiles: [],
      errors: [],
      finalTestFiles: new Map(),
    };
  }

  // Limit targets based on config
  const limitedTargets = targets.slice(0, config.maxTestsPerPR);
  
  if (targets.length > limitedTargets.length) {
    warn(`Limited to ${limitedTargets.length} target(s) (maxTestsPerPR: ${config.maxTestsPerPR})`);
  }

  info(`Processing ${limitedTargets.length} test target(s)`);

  // Initialize test generator
  const testGenerator = new TestGenerator(config);
  const framework = config.framework;
  const projectRoot = await findProjectRoot();

  // Generate tests
  const testFiles = new Map<string, { content: string; targets: string[] }>();
  const testFileToTargetsMap: TestFileToTargetsMap = {}; // Map test files to their original targets
  let testsGenerated = 0;
  let testsFailed = 0;
  const errors: Array<{ target: string; error: string }> = [];

  for (let i = 0; i < limitedTargets.length; i++) {
    const target = limitedTargets[i];
    progress(i + 1, limitedTargets.length, `Generating test for ${target.functionName}`);

    // Add delay between requests to avoid rate limits (if configured)
    if (i > 0 && config.requestDelay && config.requestDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, config.requestDelay));
    }

    try {
      const testFilePath = getTestFilePath(target, config);
      
      // Get existing test file content
      let existingContent: string | undefined;
      if (getExistingTestFile) {
        existingContent = await getExistingTestFile(testFilePath);
      } else {
        // Default: check filesystem
        const fullTestPath = join(projectRoot, testFilePath);
        if (existsSync(fullTestPath)) {
          existingContent = readFileSync(fullTestPath, 'utf-8');
        }
      }

      // Calculate correct import path from test file to source file
      const importPath = calculateImportPath(testFilePath, target.filePath);
      
      let result;
      if (mode === 'scaffold') {
        result = await testGenerator.generateTestScaffold(target, existingContent, framework, testFilePath, importPath);
      } else {
        result = await testGenerator.generateTest({
          target: {
            filePath: target.filePath,
            functionName: target.functionName,
            functionType: target.functionType,
            code: target.code,
            context: target.context,
            className: target.className,
            isPrivate: target.isPrivate,
            classPrivateProperties: target.classPrivateProperties,
          },
          framework,
          existingTestFile: existingContent,
          testFilePath,
          importPath,
        });
      }

      // Apply code standards if enabled
      let formattedCode = result.testCode;
      if (config.codeStyle?.formatGeneratedCode) {
        formattedCode = await formatGeneratedCode(formattedCode, projectRoot);
      }

      if (config.codeStyle?.lintGeneratedCode) {
        formattedCode = await lintGeneratedCode(formattedCode, projectRoot);
      }

      // Store test file
      let fileData = testFiles.get(testFilePath);
      if (!fileData) {
        fileData = { content: formattedCode, targets: [] };
        testFiles.set(testFilePath, fileData);
        testFileToTargetsMap[testFilePath] = [];
      } else {
        // Append with separator if base content exists
        if (fileData.content && existingContent) {
          fileData.content += '\n\n' + formattedCode;
        } else {
          fileData.content = formattedCode;
        }
      }
      
      fileData.targets.push(target.functionName);
      testFileToTargetsMap[testFilePath].push(target); // Store full target for fix loop
      testsGenerated++;

      info(`✓ Generated test for ${target.functionName}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      error(`✗ Failed to generate test for ${target.functionName}: ${errorMessage}`);
      errors.push({
        target: `${target.filePath}:${target.functionName}`,
        error: errorMessage,
      });
      testsFailed++;
    }
  }

  // Write tests to disk and run them (only in full/pr mode, not scaffold)
  const packageManager = detectPackageManager(projectRoot);
  info(`Detected package manager: ${packageManager}`);

  let finalTestFiles = testFiles;
  let finalTestsFailed = testsFailed;
  let coverageEnabled = false;
  let testResults: TestResult[] | undefined = undefined;

  if (testFiles.size > 0) {
    // Write test files to disk
    const writtenPaths = writeTestFiles(testFiles, projectRoot);
    info(`Wrote ${writtenPaths.length} test file(s) to disk`);

    // Run tests and fix failures if not in scaffold mode
    if (mode !== 'scaffold') {
      const testRunner = createTestRunner(framework);
      
      try {
        info('Running tests and fixing failures...');
        const fixedTestFiles = await runTestsAndFix(
          testRunner,
          testFiles,
          writtenPaths,
          framework,
          packageManager,
          projectRoot,
          testGenerator,
          config.maxFixAttempts,
          config,
          testFileToTargetsMap
        );
        
        // Update final test files with fixed versions
        finalTestFiles = fixedTestFiles;
        
        // Run final tests (with coverage if enabled in full mode)
        coverageEnabled = mode === 'full' && config.enableCoverage;
        testResults = await testRunner.runTests({
          testFiles: writtenPaths,
          framework,
          packageManager,
          projectRoot,
          coverage: coverageEnabled,
        });
        
        // Count actual failures after fix attempts
        finalTestsFailed = testResults.reduce((sum, r) => sum + (r.success ? 0 : r.failed), 0);
        
        if (finalTestsFailed > 0) {
          warn(`Some tests still failing after fix attempts: ${finalTestsFailed} test(s)`);
        } else {
          info(`All tests passed after fix attempts`);
        }
      } catch (err) {
        warn(`Failed to run tests or apply fixes: ${err instanceof Error ? err.message : String(err)}`);
        // Don't fail the whole operation, just report the error
      }
    }
  }

  // Read coverage report if coverage was enabled
  let coverageReport = null;
  let coverageDelta = null;
  if (coverageEnabled) {
    try {
      // Get baseline coverage before running new tests (if coverage report exists)
      const baselineCoverage = readCoverageReport(projectRoot, framework);
      
      // Read coverage report after running tests
      coverageReport = readCoverageReport(projectRoot, framework);
      if (coverageReport) {
        info(`Coverage collected: ${coverageReport.total.lines.percentage.toFixed(1)}% lines`);
        
        // Calculate coverage delta if baseline exists
        if (baselineCoverage) {
          coverageDelta = calculateCoverageDelta(baselineCoverage, coverageReport);
          info(`Coverage delta: +${coverageDelta.lines.toFixed(1)}% lines, +${coverageDelta.functions.toFixed(1)}% functions`);
        }
      } else {
        warn('Could not read coverage report. Check that coverage package is installed and coverage/coverage-final.json exists.');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      warn(`Failed to read coverage report: ${errorMessage}`);
    }
  }

  // Initialize result
  const result: TestGenerationResult = {
    targetsProcessed: limitedTargets.length,
    testsGenerated,
    testsFailed: finalTestsFailed,
    testFiles: Array.from(finalTestFiles.entries()).map(([path, data]) => ({
      path,
      targets: data.targets,
    })),
    errors,
    finalTestFiles,
    coverageReport: coverageReport || undefined,
    coverageDelta: coverageDelta || undefined,
    testResults: testResults,
  };

  success(`Completed: ${testsGenerated} test(s) generated, ${finalTestsFailed} failed`);

  return result;
}

/**
 * Run tests and fix failures in a loop
 */
async function runTestsAndFix(
  testRunner: ReturnType<typeof createTestRunner>,
  testFiles: Map<string, { content: string; targets: string[] }>,
  testFilePaths: string[],
  framework: 'jest' | 'vitest',
  packageManager: 'npm' | 'yarn' | 'pnpm',
  projectRoot: string,
  testGenerator: TestGenerator,
  maxFixAttempts: number,
  config: KakarotConfig,
  testFileToTargetsMap: TestFileToTargetsMap
): Promise<Map<string, { content: string; targets: string[] }>> {
  
  let attempt = 0;
  const currentTestFiles = new Map(testFiles);

  while (attempt < maxFixAttempts) {
    info(`Running tests (attempt ${attempt + 1}/${maxFixAttempts})`);

    // Run tests
    const results = await testRunner.runTests({
      testFiles: testFilePaths,
      framework,
      packageManager,
      projectRoot,
      coverage: false,
    });

    // Check if all tests passed
    const allPassed = results.every(r => r.success);
    if (allPassed) {
      success(`All tests passed on attempt ${attempt + 1}`);
      return currentTestFiles;
    }

    // Find failing tests
    const failures: Array<{ testFile: string; result: TestResult }> = [];
    let totalFailingTests = 0;
    for (const result of results) {
      if (!result.success && result.failures.length > 0) {
        failures.push({ testFile: result.testFile, result });
        totalFailingTests += result.failed;
      }
    }

    if (failures.length > 0) {
      info(`Found ${failures.length} failing test file(s) with ${totalFailingTests} failing test(s), attempting fixes...`);
      // Log details about partial failures
      for (const { testFile, result } of failures) {
        if (result.passed > 0) {
          info(`  ${testFile}: ${result.passed} passed, ${result.failed} failed`);
        } else {
          info(`  ${testFile}: All ${result.failed} test(s) failed`);
        }
      }
    }

    // Fix each failing test file
    let fixedAny = false;
    for (const { testFile, result } of failures) {
      try {
        const currentContent = currentTestFiles.get(testFile)?.content;
        if (!currentContent) {
          continue;
        }

        // Get original function code from targets
        const targets = testFileToTargetsMap[testFile] || [];
        // Use the first target's code as the original code (or combine if multiple)
        const originalCode = targets.length > 0 
          ? targets.map(t => {
              // Include context if available
              const contextInfo = t.context ? `\n// Context (surrounding code):\n${t.context}\n` : '';
              return `${t.functionName} (${t.functionType}):\n${t.code}${contextInfo}`;
            }).join('\n\n')
          : currentContent; // Fallback to test code if no targets found
        
        const errorMessages = result.failures.map(f => f.message).join('\n');
        const testOutput = result.failures.map(f => f.message).join('\n');
        
        // Extract function names and source file path from targets
        const functionNames = targets.map(t => t.functionName);
        const sourceFilePath = targets.length > 0 ? targets[0].filePath : undefined;
        
        // Extract failing test details
        const failingTests = result.failures.map(f => ({
          testName: f.testName,
          message: f.message,
          stack: f.stack,
        }));

        const fixedResult = await testGenerator.fixTest({
          testCode: currentContent,
          errorMessage: errorMessages,
          testOutput,
          originalCode,
          framework,
          attempt: attempt + 1,
          maxAttempts: maxFixAttempts,
          testFilePath: testFile,
          functionNames: functionNames.length > 0 ? functionNames : undefined,
          failingTests: failingTests.length > 0 ? failingTests : undefined,
          sourceFilePath,
        });

        // Apply code standards to fixed code
        let formattedCode = fixedResult.testCode;
        if (config.codeStyle?.formatGeneratedCode) {
          formattedCode = await formatGeneratedCode(formattedCode, projectRoot);
        }
        if (config.codeStyle?.lintGeneratedCode) {
          formattedCode = await lintGeneratedCode(formattedCode, projectRoot);
        }

        currentTestFiles.set(testFile, {
          content: formattedCode,
          targets: currentTestFiles.get(testFile)!.targets,
        });

        // Update file on disk
        const fs = await import('fs/promises');
        const path = await import('path');
        const fullPath = path.join(projectRoot, testFile);
        await fs.writeFile(fullPath, formattedCode, 'utf-8');

        fixedAny = true;
        info(`✓ Fixed test file: ${testFile}`);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        warn(`Failed to fix test file ${testFile}: ${errorMessage}`);
      }
    }

    if (!fixedAny) {
      warn('No fixes could be applied, stopping fix attempts');
      break;
    }

    attempt++;
  }

  if (attempt >= maxFixAttempts) {
    warn(`Reached maximum fix attempts (${maxFixAttempts}), some tests may still be failing`);
  }

  return currentTestFiles;
}

/**
 * Calculate coverage delta between baseline and current coverage
 */
function calculateCoverageDelta(
  baseline: CoverageReport,
  current: CoverageReport
): CoverageDelta {
  return {
    lines: current.total.lines.percentage - baseline.total.lines.percentage,
    branches: current.total.branches.percentage - baseline.total.branches.percentage,
    functions: current.total.functions.percentage - baseline.total.functions.percentage,
    statements: current.total.statements.percentage - baseline.total.statements.percentage,
  };
}

