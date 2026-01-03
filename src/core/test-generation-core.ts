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
import { checkSyntaxCompleteness } from '../utils/file-validator.js';
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

  info(`Processing ${limitedTargets.length} test target(s)${targets.length > limitedTargets.length ? ` (limited from ${targets.length} total)` : ''}`);
  
  // Log which functions/classes will be tested
  if (limitedTargets.length > 0) {
    const targetNames = limitedTargets.map(t => t.className ? `${t.className}.${t.functionName}` : t.functionName).join(', ');
    info(`Test targets: ${targetNames}`);
  }

  // Initialize test generator
  const testGenerator = new TestGenerator(config);
  const framework = config.framework;
  const projectRoot = await findProjectRoot();

  // Generate tests
  const testFiles = new Map<string, { content: string; targets: string[] }>();
  const testFileToTargetsMap: TestFileToTargetsMap = {}; // Map test files to their original targets
  const privatePropertiesMap = new Map<string, string[]>(); // Map test files to their private properties
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
      
      // Get existing test file content (read once per file, not per target)
      let existingContent: string | undefined;
      const existingFileData = testFiles.get(testFilePath);
      if (existingFileData) {
        // We've already processed this file - use accumulated content as existing
        existingContent = existingFileData.content;
      } else {
        // First time processing this file - read from disk/GitHub
        if (getExistingTestFile) {
          existingContent = await getExistingTestFile(testFilePath);
        } else {
          // Default: check filesystem
          const fullTestPath = join(projectRoot, testFilePath);
          if (existsSync(fullTestPath)) {
            existingContent = readFileSync(fullTestPath, 'utf-8');
          }
        }
      }
      
      // Check if this function/class already has tests
      if (existingContent) {
        const { hasExistingTests } = await import('../utils/test-file-merger.js');
        if (hasExistingTests(existingContent, target.functionName, target.className)) {
          info(`Skipping ${target.functionName} - tests already exist in ${testFilePath}`);
          continue; // Skip this target
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

      // Track private properties for this test file
      if (target.classPrivateProperties && target.classPrivateProperties.length > 0) {
        const existing = privatePropertiesMap.get(testFilePath) || [];
        privatePropertiesMap.set(testFilePath, [...new Set([...existing, ...target.classPrivateProperties])]);
      }
      
      // Store test file - merge intelligently with existing content
      let fileData = testFiles.get(testFilePath);
      if (!fileData) {
        // First target for this file - use existing content as base if it exists
        const baseContent = existingContent || '';
        if (baseContent) {
          // Merge with existing file
          const { mergeTestFiles } = await import('../utils/test-file-merger.js');
          fileData = { content: await mergeTestFiles(baseContent, formattedCode), targets: [] };
        } else {
          fileData = { content: formattedCode, targets: [] };
        }
        testFiles.set(testFilePath, fileData);
        testFileToTargetsMap[testFilePath] = [];
      } else {
        // Merge new code with accumulated content
        const { mergeTestFiles } = await import('../utils/test-file-merger.js');
        const mergedContent = await mergeTestFiles(fileData.content, formattedCode);
        
        // Validate merged content before storing (basic syntax check)
        const syntaxCheck = checkSyntaxCompleteness(mergedContent);
        if (!syntaxCheck.valid) {
          throw new Error(`Merged test code has syntax errors: ${syntaxCheck.errors.join('; ')}`);
        }
        
        fileData.content = mergedContent;
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
    // Write test files to disk with validation
    const { writtenPaths, failedPaths } = await writeTestFiles(testFiles, projectRoot, privatePropertiesMap);
    
    // Update failed count for files that couldn't be written
    if (failedPaths.length > 0) {
      testsFailed += failedPaths.length;
      failedPaths.forEach(path => {
        const fileData = testFiles.get(path);
        if (fileData) {
          fileData.targets.forEach(target => {
            errors.push({
              target: `${path}:${target}`,
              error: 'File validation failed (syntax errors, type errors, or private property access)',
            });
          });
        }
      });
      
      // Remove failed files from testFiles so they're not run
      failedPaths.forEach(path => testFiles.delete(path));
    }
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
        warn('Could not read coverage report. Ensure:');
        warn('  1. Coverage package is installed (@vitest/coverage-v8 for Vitest or @jest/coverage for Jest)');
        warn('  2. Coverage is configured in your test framework config (vitest.config.ts or jest.config.js)');
        warn('  3. Coverage reporter includes "json" (e.g., coverage.reporter: ["text", "json"])');
        warn('  4. Tests ran successfully (coverage is generated after tests complete)');
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

  const isInfinite = maxFixAttempts === -1;
  while (isInfinite || attempt < maxFixAttempts) {
    const attemptLabel = isInfinite ? `${attempt + 1}` : `${attempt + 1}/${maxFixAttempts}`;
    info(`Running tests (attempt ${attemptLabel})`);

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
        const currentFileData = currentTestFiles.get(testFile);
        const currentContent = currentFileData?.content;
        if (!currentContent) {
          continue;
        }
        
        // Track last valid version and syntax error attempts
        const lastValidContent = currentFileData && '_lastValidContent' in currentFileData
          ? (currentFileData as { _lastValidContent?: string })._lastValidContent
          : currentContent; // Use current as last valid if no previous valid version
        
        const syntaxErrorAttempts = currentFileData && '_syntaxErrorAttempts' in currentFileData
          ? ((currentFileData as { _syntaxErrorAttempts?: number })._syntaxErrorAttempts || 0)
          : 0;
        
        // If we've had too many syntax errors, revert to last valid and stop trying to fix syntax
        if (syntaxErrorAttempts >= 3) {
          warn(`Too many syntax error attempts (${syntaxErrorAttempts}) for ${testFile}, reverting to last valid version`);
          if (lastValidContent && lastValidContent !== currentContent) {
            currentTestFiles.set(testFile, {
              content: lastValidContent,
              targets: currentFileData.targets,
            });
            // Update file on disk
            const fs = await import('fs/promises');
            const path = await import('path');
            const fullPath = path.join(projectRoot, testFile);
            await fs.writeFile(fullPath, lastValidContent, 'utf-8');
            info(`Reverted ${testFile} to last valid version`);
          }
          // Skip this file for now, try again next iteration with test logic fixes only
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
        
        // Always format to fix syntax errors before validation
        // This helps prevent syntax errors from being written
        if (config.codeStyle?.formatGeneratedCode) {
          formattedCode = await formatGeneratedCode(formattedCode, projectRoot);
        } else {
          // Even if formatting is disabled, try to consolidate imports to prevent duplicates
          try {
            const { consolidateImports } = await import('../utils/import-consolidator.js');
            const importRegex = /^import\s+.*?from\s+['"].*?['"];?$/gm;
            const imports = formattedCode.match(importRegex) || [];
            if (imports.length > 0) {
              const consolidated = consolidateImports(imports);
              const nonImportCode = formattedCode.replace(importRegex, '').trim();
              formattedCode = consolidated.join('\n') + '\n\n' + nonImportCode;
            }
          } catch {
            // If consolidation fails, continue with original code
          }
        }
        
        if (config.codeStyle?.lintGeneratedCode) {
          formattedCode = await lintGeneratedCode(formattedCode, projectRoot);
        }

        // Get private properties for this test file
        const targetsForFile = testFileToTargetsMap[testFile] || [];
        const privateProperties = targetsForFile
          .flatMap(t => t.classPrivateProperties || [])
          .filter((v, i, a) => a.indexOf(v) === i); // Unique

        // Validate fixed file before writing
        const { validateTestFile } = await import('../utils/file-validator.js');
        let validation = await validateTestFile(testFile, formattedCode, projectRoot, privateProperties);
        
        // If missing imports detected, fix them automatically
        if (validation.missingImports && validation.missingImports.length > 0) {
          const { fixMissingImports } = await import('../utils/import-fixer.js');
          formattedCode = fixMissingImports(formattedCode, validation.missingImports, framework);
          // Re-validate after fixing imports
          validation = await validateTestFile(testFile, formattedCode, projectRoot, privateProperties);
        }
        
        if (!validation.valid) {
          warn(`Fixed test file validation failed for ${testFile}:`);
          validation.errors.forEach(err => warn(`  - ${err}`));
          
          // Check if these are syntax errors (recoverable) vs other errors
          const syntaxErrors = validation.errors.filter(e => 
            e.includes('Unclosed') || e.includes('Syntax') || e.includes('syntax') || 
            e.includes('brace') || e.includes('parenthes') || e.includes('bracket')
          );
          
          if (syntaxErrors.length > 0) {
            // Syntax errors are recoverable - store them and retry in next iteration
            // Increment syntax error attempt counter
            const fileDataWithErrors = currentTestFiles.get(testFile);
            if (fileDataWithErrors) {
              const fileDataWithValidationErrors = {
                ...fileDataWithErrors,
                _validationErrors: validation.errors,
                _syntaxErrorAttempts: (fileDataWithErrors && '_syntaxErrorAttempts' in fileDataWithErrors
                  ? ((fileDataWithErrors as { _syntaxErrorAttempts?: number })._syntaxErrorAttempts || 0)
                  : 0) + 1,
              } as typeof fileDataWithErrors & { _validationErrors: string[]; _syntaxErrorAttempts: number };
              currentTestFiles.set(testFile, fileDataWithValidationErrors);
            }
            warn(`Syntax errors detected (attempt ${syntaxErrorAttempts + 1}/3) for ${testFile}, will retry with syntax fixes`);
            // Mark that we're still working on fixes (don't stop the loop)
            fixedAny = true; // Keep the loop going
          } else {
            // Non-syntax errors (type errors, etc.) - may be harder to fix automatically
            // Still mark as working to keep loop going, but don't store errors
            warn(`Non-syntax validation errors for ${testFile}, will retry in next attempt`);
            fixedAny = true;
          }
          continue; // Skip writing this invalid file, but continue loop
        }
        
        // Validation passed - clear any previous validation errors and syntax error attempts
        // Save this as the last valid version
        const fileDataToClean = currentTestFiles.get(testFile);
        if (fileDataToClean) {
          const cleanedData: typeof fileDataToClean & { _lastValidContent?: string } = { ...fileDataToClean };
          if ('_validationErrors' in cleanedData) {
            delete (cleanedData as { _validationErrors?: string[] })._validationErrors;
          }
          if ('_syntaxErrorAttempts' in cleanedData) {
            delete (cleanedData as { _syntaxErrorAttempts?: number })._syntaxErrorAttempts;
          }
          // Save as last valid content
          cleanedData._lastValidContent = formattedCode;
          currentTestFiles.set(testFile, cleanedData);
        }

        currentTestFiles.set(testFile, {
          content: formattedCode,
          targets: currentTestFiles.get(testFile)!.targets,
        });

        // Update file on disk atomically
        const fs = await import('fs/promises');
        const path = await import('path');
        const fullPath = path.join(projectRoot, testFile);
        const tempPath = fullPath + '.tmp';
        
        // Write to temp file first
        await fs.writeFile(tempPath, formattedCode, 'utf-8');
        
        // Move to final location (atomic)
        await fs.rename(tempPath, fullPath);

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

  if (!isInfinite && attempt >= maxFixAttempts) {
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

