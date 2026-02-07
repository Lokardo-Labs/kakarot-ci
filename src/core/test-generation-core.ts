/**
 * Core test generation logic shared between PR and local modes
 */

import type { KakarotConfig } from '../types/config.js';
import type { TestTarget } from '../types/diff.js';
import { RateLimitError } from '../types/errors.js';
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
import { checkSyntaxCompleteness, validateTestFile, validateTypeScript } from '../utils/file-validator.js';
import { readFileSync, existsSync } from 'fs';
import * as fs from 'fs/promises';
import { join } from 'path';
import { info, error, warn, success, progress, debug } from '../utils/logger.js';
import type { TestResult } from '../types/test-runner.js';
import type { CoverageReport } from '../types/coverage.js';
import { mergeTestFiles, hasExistingTests } from '../utils/test-file-merger.js';
import { fixMissingImports } from '../utils/import-fixer.js';
import { consolidateImports } from '../utils/import-consolidator.js';
import { fixTypeErrors } from '../utils/type-error-fixer.js';

// ============================================================================
// Constants
// ============================================================================

/** Estimated tokens needed per test generation request */
const ESTIMATED_TOKENS_PER_REQUEST = 3000;

/** Maximum tokens per minute (OpenAI default, adjust per provider if needed) */
const MAX_TOKENS_PER_MINUTE = 30000;

/** Maximum wait time for token refill before proceeding (1 minute) */
const MAX_TOKEN_WAIT_MS = 60000;

/** Minimum test retention percentage - reject fixes that remove more than this */
const MIN_TEST_RETENTION_PERCENT = 0.95;

/** Minimum test count before applying retention threshold */
const MIN_TESTS_FOR_RETENTION_CHECK = 10;

/** Maximum type check attempts during initial validation */
const MAX_TYPE_CHECK_ATTEMPTS_INITIAL = 10;

/** Maximum type check attempts during fix loop */
const MAX_TYPE_CHECK_ATTEMPTS_FIX_LOOP = 5;

/** Maximum syntax error attempts before reverting to last valid version */
const MAX_SYNTAX_ERROR_ATTEMPTS = 3;

/** Maximum network retries on final fix attempt */
const MAX_NETWORK_RETRIES_FINAL = 5;

/** Maximum network retries on non-final attempts */
const MAX_NETWORK_RETRIES_NORMAL = 3;

/** Maximum backoff delay for network retries (10 seconds) */
const MAX_NETWORK_BACKOFF_MS = 10000;

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
 * Combine all class-method targets for the same class+file into a single target.
 * Standalone functions pass through unchanged. This avoids N API calls for N methods
 * of the same class - instead one call gets the full class context and generates all tests.
 */
function consolidateClassTargets(targets: TestTarget[]): TestTarget[] {
  const classGroups = new Map<string, TestTarget[]>();
  const standalone: TestTarget[] = [];

  for (const target of targets) {
    if (target.className && target.functionType === 'class-method') {
      const key = `${target.filePath}::${target.className}`;
      const group = classGroups.get(key) || [];
      group.push(target);
      classGroups.set(key, group);
    } else {
      standalone.push(target);
    }
  }

  const consolidated: TestTarget[] = [...standalone];

  for (const [, methods] of classGroups) {
    const first = methods[0];
    // Combine all method codes into one block the LLM sees as the full class
    const combinedCode = methods.map(m => m.code).join('\n\n');
    const combinedFunctionName = methods.map(m => m.functionName).join(', ');

    // Use the widest line range across all methods
    const startLine = Math.min(...methods.map(m => m.startLine));
    const endLine = Math.max(...methods.map(m => m.endLine));

    // Merge all changedRanges
    const allRanges = methods.flatMap(m => m.changedRanges);

    // Merge private properties
    const allPrivate = [...new Set(methods.flatMap(m => m.classPrivateProperties || []))];

    consolidated.push({
      filePath: first.filePath,
      functionName: combinedFunctionName,
      functionType: 'class-method',
      startLine,
      endLine,
      code: combinedCode,
      context: first.context, // class context is shared
      className: first.className,
      isPrivate: false,
      classPrivateProperties: allPrivate.length > 0 ? allPrivate : undefined,
      changedRanges: allRanges,
      existingTestFile: first.existingTestFile,
    });
  }

  return consolidated;
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

  // Limit targets based on config (-1 means unlimited)
  const isUnlimited = config.maxTestsPerPR === -1;
  const limitedTargets = isUnlimited ? targets : targets.slice(0, config.maxTestsPerPR);
  
  if (!isUnlimited && targets.length > limitedTargets.length) {
    warn(`Limited to ${limitedTargets.length} target(s) (maxTestsPerPR: ${config.maxTestsPerPR})`);
  }

  // Group class methods into single targets to avoid per-method API calls.
  // All methods of the same class in the same file become one combined target.
  const consolidatedTargets = consolidateClassTargets(limitedTargets);

  info(`Processing ${consolidatedTargets.length} test target(s) (consolidated from ${limitedTargets.length})${!isUnlimited && targets.length > limitedTargets.length ? ` (limited from ${targets.length} total)` : ''}`);
  
  // Log which functions/classes will be tested
  if (consolidatedTargets.length > 0) {
    const targetNames = consolidatedTargets.map(t => t.className ? t.className : t.functionName).join(', ');
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
  
  // Track token capacity to avoid starting work without sufficient tokens
  let lastRateLimitInfo: {
    availableTokens: number;
    requestTokens: number;
    refillRate: number; // tokens per minute
    timestamp: number; // when this info was recorded
  } | null = null;

  for (let i = 0; i < consolidatedTargets.length; i++) {
    const target = consolidatedTargets[i];
    const targetLabel = target.className || target.functionName;
    progress(i + 1, consolidatedTargets.length, `Generating test for ${targetLabel}`);

    // Check token capacity before starting new function generation
    // Estimate tokens needed for this request (~2000-4000 tokens for test generation)
    const estimatedTokensNeeded = ESTIMATED_TOKENS_PER_REQUEST;
    if (lastRateLimitInfo) {
      const timeSinceLastCheck = (Date.now() - lastRateLimitInfo.timestamp) / 1000 / 60; // minutes
      const tokensRefilled = timeSinceLastCheck * lastRateLimitInfo.refillRate;
      const currentAvailableTokens = Math.min(
        lastRateLimitInfo.availableTokens + tokensRefilled,
        MAX_TOKENS_PER_MINUTE
      );
      
      if (currentAvailableTokens < estimatedTokensNeeded) {
        // Not enough tokens available - wait for refill
        const tokensNeeded = estimatedTokensNeeded - currentAvailableTokens;
        const waitMinutes = tokensNeeded / lastRateLimitInfo.refillRate;
        const waitMs = Math.ceil(waitMinutes * 60 * 1000);
        
        if (waitMs > 0 && waitMs < MAX_TOKEN_WAIT_MS) {
          warn(`Insufficient token capacity (${Math.floor(currentAvailableTokens)} available, ${estimatedTokensNeeded} needed). Waiting ${Math.ceil(waitMs / 1000)}s for token refill...`);
          await new Promise(resolve => setTimeout(resolve, waitMs));
          // Update available tokens after waiting
          const newTimeSinceCheck = (Date.now() - lastRateLimitInfo.timestamp) / 1000 / 60;
          lastRateLimitInfo.availableTokens = Math.min(
            lastRateLimitInfo.availableTokens + (newTimeSinceCheck * lastRateLimitInfo.refillRate),
            MAX_TOKENS_PER_MINUTE
          );
          lastRateLimitInfo.timestamp = Date.now();
        }
      }
    }

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
        if (hasExistingTests(existingContent, target.functionName, target.className)) {
          info(`Skipping ${targetLabel} - tests already exist in ${testFilePath}`);
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
          fileData = { content: await mergeTestFiles(baseContent, formattedCode), targets: [] };
        } else {
        fileData = { content: formattedCode, targets: [] };
        }
        testFiles.set(testFilePath, fileData);
        testFileToTargetsMap[testFilePath] = [];
      } else {
        // Merge new code with accumulated content
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

      info(`✓ Generated test for ${targetLabel}`);
      
      // Clear rate limit info on successful generation (tokens were used successfully)
      lastRateLimitInfo = null;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      
      // Check if this is a rate limit error with token information
      if (
        err instanceof RateLimitError &&
        err.availableTokens !== null &&
        err.requestTokens !== null &&
        err.refillRate !== null
      ) {
        lastRateLimitInfo = {
          availableTokens: err.availableTokens,
          requestTokens: err.requestTokens,
          refillRate: err.refillRate,
          timestamp: Date.now(),
        };
        warn(`Rate limit hit: ${lastRateLimitInfo.availableTokens} tokens available, ${lastRateLimitInfo.requestTokens} requested. Refill rate: ${lastRateLimitInfo.refillRate} tokens/min.`);
      }
      
      // Classify errors: quota errors and configuration errors should fail fast
      const isQuotaError = errorMessage.toLowerCase().includes('exceeded your current quota') ||
                          errorMessage.toLowerCase().includes('quota exceeded') ||
                          (errorMessage.toLowerCase().includes('quota') && 
                           !errorMessage.toLowerCase().includes('rate limit')) ||
                          errorMessage.toLowerCase().includes('billing');
      
      // Syntax errors from LLM output are NOT configuration errors - they're just bad generations
      const isSyntaxError = errorMessage.includes('syntax error') || 
                           errorMessage.includes('Cannot merge') ||
                           errorMessage.includes('Unclosed') ||
                           errorMessage.includes('truncated');
      
      const isConfigurationError = !isSyntaxError && (
                                   errorMessage.includes('400') || 
                                   errorMessage.includes('401') ||
                                   errorMessage.includes('Unsupported parameter') ||
                                   errorMessage.includes('max_tokens') ||
                                   errorMessage.includes('max_completion_tokens'));
      
      if (isQuotaError) {
        // Quota errors won't resolve by retrying - fail fast
        error(`✗ Quota error detected: ${errorMessage}`);
        error(`Quota exceeded. Please check your billing and plan. This error won't resolve by retrying.`);
        error(`Stopping all test generation attempts.`);
        // Stop generation immediately for quota errors
        throw new Error(`Quota exceeded: ${errorMessage}. Please check your billing and plan.`);
      }
      
      if (isConfigurationError) {
        // Configuration errors won't resolve - fail fast
        error(`✗ Configuration error detected: ${errorMessage}`);
        error(`This error will occur for all test generations. Please check your configuration.`);
        if (errorMessage.includes('max_tokens') || errorMessage.includes('max_completion_tokens')) {
          error(`Hint: GPT-5 and newer models require 'max_completion_tokens' instead of 'max_tokens'.`);
          error(`Please use gpt-4o, gpt-4-turbo, or gpt-4, or wait for GPT-5 support.`);
        }
        // Stop generation immediately for configuration errors
        throw new Error(`Configuration error: ${errorMessage}. Please fix your configuration and try again.`);
      }
      
      error(`✗ Failed to generate test for ${targetLabel}: ${errorMessage}`);
      errors.push({
        target: `${target.filePath}:${target.functionName}`,
        error: errorMessage,
      });
      testsFailed++;
      
      // If we've seen the same configuration error 2+ times, fail fast
      // But NOT for syntax errors - those are expected when LLM generates bad code
      if (errors.length >= 2 && !isSyntaxError) {
        const recentErrors = errors.slice(-2).map(e => e.error);
        const allSameConfigError = recentErrors.every(e => 
          (e.includes('400') || e.includes('401') || e.includes('Unsupported parameter')) &&
          !e.includes('syntax error') && !e.includes('Cannot merge') && !e.includes('Unclosed')
        );
        if (allSameConfigError) {
          error(`Multiple configuration errors detected. Stopping generation to avoid wasting API calls.`);
          throw new Error(`Configuration error detected: ${recentErrors[0]}. Please fix your configuration and try again.`);
        }
      }
    }
  }

  // Write tests to disk and run them (only in full/pr mode, not scaffold)
  const packageManager = detectPackageManager(projectRoot);
  info(`Detected package manager: ${packageManager}`);

  let finalTestFiles = testFiles;
  let finalTestsFailed = testsFailed;
  let coverageEnabled = false;
  let coverageAttempted = false;
  let testResults: TestResult[] | undefined = undefined;

  // Capture baseline coverage before running new tests so delta is meaningful
  const baselineCoverage = config.enableCoverage ? readCoverageReport(projectRoot, framework) : null;

  // Ensure existing test files are included in testFiles map for fix loop
  // This allows the fix loop to run on existing test files even when all targets are skipped
  const existingTestFiles = new Set<string>();
  for (const target of consolidatedTargets) {
    const testFilePath = getTestFilePath(target, config);
    const fullTestPath = join(projectRoot, testFilePath);
    if (existsSync(fullTestPath) && !testFiles.has(testFilePath)) {
      existingTestFiles.add(testFilePath);
      // Read existing test file and add to testFiles map so fix loop can run on it
      const existingContent = readFileSync(fullTestPath, 'utf-8');
      testFiles.set(testFilePath, { content: existingContent, targets: [] });
      // Also add to testFileToTargetsMap for fix loop context
      if (!testFileToTargetsMap[testFilePath]) {
        testFileToTargetsMap[testFilePath] = [];
      }
    }
  }
  if (existingTestFiles.size > 0) {
    debug(`Including ${existingTestFiles.size} existing test file(s) in fix loop: ${Array.from(existingTestFiles).join(', ')}`);
  }

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

    // Type check all written test files and fix type errors before running tests
    if (writtenPaths.length > 0 && mode !== 'scaffold') {
      info('Type checking all test files before running tests...');
      
      let typeErrorsFixed = true;
      let typeCheckAttempts = 0;
      const maxTypeCheckAttempts = MAX_TYPE_CHECK_ATTEMPTS_INITIAL;
      
      while (typeErrorsFixed && typeCheckAttempts < maxTypeCheckAttempts) {
        typeCheckAttempts++;
        typeErrorsFixed = false;
        const filesWithErrors: Array<{ path: string; errors: string[]; missingImports?: string[] }> = [];
        
        // Type check all files
        for (const testPath of writtenPaths) {
          const fullPath = join(projectRoot, testPath);
          if (!existsSync(fullPath)) {
            continue;
          }
          
          const validation = await validateTypeScript(fullPath, projectRoot);
          
          if (!validation.valid && validation.errors.length > 0) {
            // Check if these are type errors (not syntax errors - those should be caught earlier)
            const typeErrors = validation.errors.filter((e: string) => 
              !e.includes('Unclosed') && 
              !e.includes('Syntax') && 
              !e.includes('syntax') &&
              !e.includes('brace') &&
              !e.includes('parenthes') &&
              !e.includes('bracket')
            );
            
            if (typeErrors.length > 0 || validation.missingImports) {
              filesWithErrors.push({
                path: testPath,
                errors: typeErrors,
                missingImports: validation.missingImports,
              });
            }
          }
        }
        
        // Fix type errors in all files
        if (filesWithErrors.length > 0) {
          info(`Found type errors in ${filesWithErrors.length} file(s), fixing...`);
          typeErrorsFixed = true;
          
          
          for (const { path: testPath, missingImports, errors } of filesWithErrors) {
            const fullPath = join(projectRoot, testPath);
            let content = readFileSync(fullPath, 'utf-8');
            let fixed = false;
            
            // Fix missing imports first
            if (missingImports && missingImports.length > 0) {
              const isVitest = content.includes("from 'vitest'") || content.includes('from "vitest"');
              const framework = isVitest ? 'vitest' : 'jest';
              content = fixMissingImports(content, missingImports, framework);
              fixed = true;
            }
            
            // Attempt to auto-fix common type errors
            if (errors && errors.length > 0) {
              const { fixedCode, fixedErrors, remainingErrors } = fixTypeErrors(content, errors);
              if (fixedErrors.length > 0) {
                content = fixedCode;
                fixed = true;
                debug(`Auto-fixed ${fixedErrors.length} type error(s) in ${testPath}`);
                if (remainingErrors.length > 0) {
                  warn(`Could not auto-fix ${remainingErrors.length} type error(s) in ${testPath}:`);
                  remainingErrors.slice(0, 3).forEach(err => warn(`  - ${err}`));
                }
              }
            }
            
            if (fixed) {
              // Write fixed content
              const tempPath = fullPath + '.tmp';
              await fs.writeFile(tempPath, content, 'utf-8');
              await fs.rename(tempPath, fullPath);
              
              // Update in-memory test files
              const fileData = testFiles.get(testPath);
              if (fileData) {
                fileData.content = content;
              }
              
              info(`✓ Fixed type errors in ${testPath}`);
            }
          }
        } else {
          typeErrorsFixed = false;
        }
      }
      
      if (typeCheckAttempts >= maxTypeCheckAttempts && typeErrorsFixed) {
        warn(`Type checking reached maximum attempts (${maxTypeCheckAttempts}). Proceeding with remaining type errors.`);
      } else if (!typeErrorsFixed) {
        info('All test files pass type checking');
      }
    }

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
        coverageAttempted = coverageEnabled; // Track if coverage was actually attempted
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

  // Read coverage report if coverage was enabled and attempted
  let coverageReport = null;
  let coverageDelta = null;
  if (coverageEnabled && coverageAttempted) {
    try {
      coverageReport = readCoverageReport(projectRoot, framework);
      if (coverageReport) {
        // Coverage info is now printed in the final summary block below
        
        // Calculate coverage delta if baseline exists
        if (baselineCoverage) {
          coverageDelta = calculateCoverageDelta(baselineCoverage, coverageReport);
        }
      } else {
        // Coverage was attempted but not generated - check if it's a setup issue
        const coverageDir = join(projectRoot, 'coverage');
        const coverageFile = join(projectRoot, 'coverage', 'coverage-final.json');
        
        // Check if coverage package is installed
        const packageJsonPath = join(projectRoot, 'package.json');
        let coveragePackageInstalled = false;
        if (existsSync(packageJsonPath)) {
          try {
            const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
            const coveragePackage = framework === 'vitest' ? '@vitest/coverage-v8' : '@jest/coverage';
            coveragePackageInstalled = 
              (packageJson.dependencies && packageJson.dependencies[coveragePackage]) ||
              (packageJson.devDependencies && packageJson.devDependencies[coveragePackage]);
          } catch {
            // Ignore package.json parsing errors
          }
        }
        
        // Check if coverage config exists
        const configPath = framework === 'vitest' 
          ? join(projectRoot, 'vitest.config.ts')
          : join(projectRoot, 'jest.config.js');
        const configExists = existsSync(configPath) || existsSync(join(projectRoot, 'vitest.config.js')) || 
                            existsSync(join(projectRoot, 'jest.config.ts'));
        
        if (!existsSync(coverageDir)) {
          // Coverage directory doesn't exist - check if it's a setup issue
          if (!coveragePackageInstalled) {
            // Setup issue: package not installed
            warn('Coverage package not found. Ensure:');
            warn(`  1. Coverage package is installed: ${framework === 'vitest' ? '@vitest/coverage-v8' : '@jest/coverage'}`);
            warn(`  2. Run: ${packageManager} add -D ${framework === 'vitest' ? '@vitest/coverage-v8' : '@jest/coverage'}`);
          } else if (!configExists) {
            // Setup issue: config missing
            warn('Coverage config not found. Ensure:');
            warn(`  1. Coverage is configured in your test framework config (${framework === 'vitest' ? 'vitest.config.ts' : 'jest.config.js'})`);
            warn('  2. Coverage reporter includes "json" (e.g., coverage.reporter: ["text", "json"])');
          } else {
            // Coverage was attempted but directory wasn't created - likely a generation issue
            debug('Coverage was attempted but directory was not created. Coverage may not have been generated (check test framework logs).');
          }
        } else if (!existsSync(coverageFile)) {
          // Coverage directory exists but file doesn't - coverage may not have been generated
          // This can happen if tests fail or have unhandled rejections
          debug('Coverage directory exists but coverage-final.json not found. Coverage may not have been generated (tests may have failed or had unhandled rejections).');
        } else {
          // File exists but couldn't be read - parsing issue
          warn('Coverage file exists but could not be read. Check file format.');
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      warn(`Failed to read coverage report: ${errorMessage}`);
    }
  } else if (coverageEnabled && !coverageAttempted) {
    // Coverage was enabled but not attempted (e.g., in fix loop)
    debug('Coverage is enabled but was not attempted in this run (fix loop runs without coverage).');
  }

  // Initialize result
  const result: TestGenerationResult = {
    targetsProcessed: consolidatedTargets.length,
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

  // Print styled summary block
  const testFileList = Array.from(finalTestFiles.entries());
  const totalTests = testResults ? testResults.reduce((sum, r) => sum + r.total, 0) : 0;
  const totalPassed = testResults ? testResults.reduce((sum, r) => sum + r.passed, 0) : 0;
  const hasCoverage = coverageReport !== null;
  const hasFailures = finalTestsFailed > 0 || errors.length > 0;

  info('');
  info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (hasFailures) {
    error('  KAKAROT CI — COMPLETED WITH ISSUES');
  } else {
    success('  KAKAROT CI — COMPLETED SUCCESSFULLY');
  }
  info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  info('');

  // Test files
  info(`  Test Files:    ${testFileList.length} written`);
  for (const [filePath] of testFileList) {
    info(`                 → ${filePath}`);
  }

  // Test counts
  if (totalTests > 0) {
    if (hasFailures) {
      info(`  Tests:         ${totalPassed} passed, ${finalTestsFailed} failed (${totalTests} total)`);
    } else {
      success(`  Tests:         ${totalPassed} passed (${totalTests} total)`);
    }
  } else {
    info(`  Targets:       ${testsGenerated} test suite(s) generated`);
  }

  // Coverage
  if (hasCoverage) {
    const cov = coverageReport!.total;
    info(`  Coverage:      ${cov.lines.percentage.toFixed(1)}% lines | ${cov.statements.percentage.toFixed(1)}% statements | ${cov.functions.percentage.toFixed(1)}% functions | ${cov.branches.percentage.toFixed(1)}% branches`);
    if (coverageDelta) {
      const sign = (v: number) => v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
      info(`  Delta:         ${sign(coverageDelta.lines)}% lines | ${sign(coverageDelta.functions)}% functions`);
    }
  }

  // Errors
  if (errors.length > 0) {
    error(`  Errors:        ${errors.length}`);
    for (const e of errors) {
      error(`                 → ${e.target}: ${e.error}`);
    }
  }

  info('');
  info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

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

    // Fix each failing test file - collect all validated fixes first, then write all at once
    // This ensures all files are validated and written before tests run again
    const fixesToApply: Array<{ testFile: string; formattedCode: string; fileData: { content: string; targets: string[] } }> = [];
    let fixedAny = false;
    
    // Save original content as last valid version BEFORE making any changes
    // This allows us to revert if syntax errors persist
    for (const { testFile } of failures) {
      const currentFileData = currentTestFiles.get(testFile);
      if (currentFileData && !('_lastValidContent' in currentFileData)) {
        // Save current content as last valid before we start making changes
        const fileDataWithLastValid = {
          ...currentFileData,
          _lastValidContent: currentFileData.content,
        } as typeof currentFileData & { _lastValidContent: string };
        currentTestFiles.set(testFile, fileDataWithLastValid);
      }
    }
    
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
          : undefined;
        
        const syntaxErrorAttempts = currentFileData && '_syntaxErrorAttempts' in currentFileData
          ? ((currentFileData as { _syntaxErrorAttempts?: number })._syntaxErrorAttempts || 0)
          : 0;
        
        // Revert after 3 syntax error attempts if we have a valid version to revert to
        // This prevents infinite loops with broken code
        if (syntaxErrorAttempts >= MAX_SYNTAX_ERROR_ATTEMPTS && lastValidContent && lastValidContent !== currentContent) {
          warn(`Too many syntax error attempts (${syntaxErrorAttempts}) for ${testFile}, reverting to last valid version`);
          if (lastValidContent && lastValidContent !== currentContent) {
            currentTestFiles.set(testFile, {
              content: lastValidContent,
              targets: currentFileData.targets,
            });
            // Add to fixes to apply (will be written atomically with others)
            fixesToApply.push({
              testFile,
              formattedCode: lastValidContent,
              fileData: { content: lastValidContent, targets: currentFileData.targets },
            });
            info(`Reverted ${testFile} to last valid version (will write with other fixes)`);
            fixedAny = true;
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

        // Get validation errors if available (for syntax errors with line numbers)
        const fileDataForErrors = currentTestFiles.get(testFile);
        const validationErrors = fileDataForErrors && '_validationErrors' in fileDataForErrors
          ? ((fileDataForErrors as { _validationErrors?: string[] })._validationErrors)
          : undefined;
        
        // Check if previous fix was rejected for removing tests
        const testRemovalRejected = fileDataForErrors && '_testRemovalRejected' in fileDataForErrors
          ? ((fileDataForErrors as { _testRemovalRejected?: boolean })._testRemovalRejected)
          : false;
        
        // Retry network errors with exponential backoff (all attempts, not just final)
        const isFinalAttempt = attempt + 1 >= maxFixAttempts;
        let fixedResult;
        let retryCount = 0;
        const maxNetworkRetries = isFinalAttempt ? MAX_NETWORK_RETRIES_FINAL : MAX_NETWORK_RETRIES_NORMAL;
        
        while (retryCount <= maxNetworkRetries) {
          try {
            fixedResult = await testGenerator.fixTest({
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
              _validationErrors: validationErrors,
              _testRemovalRejected: testRemovalRejected,
            });
            break; // Success, exit retry loop
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            const isNetworkError = errorMessage.toLowerCase().includes('fetch failed') ||
                                  errorMessage.toLowerCase().includes('network') ||
                                  errorMessage.toLowerCase().includes('econnrefused') ||
                                  errorMessage.toLowerCase().includes('etimedout') ||
                                  errorMessage.toLowerCase().includes('enotfound') ||
                                  errorMessage.toLowerCase().includes('eai_again') ||
                                  errorMessage.toLowerCase().includes('socket') ||
                                  errorMessage.toLowerCase().includes('connection');
            
            if (isNetworkError && retryCount < maxNetworkRetries) {
              retryCount++;
              const backoffDelay = Math.min(1000 * Math.pow(2, retryCount - 1), MAX_NETWORK_BACKOFF_MS);
              const attemptLabel = isFinalAttempt ? 'final attempt' : `attempt ${attempt + 1}`;
              warn(`Network error on ${attemptLabel} (retry ${retryCount}/${maxNetworkRetries}): ${errorMessage}`);
              warn(`Retrying in ${Math.ceil(backoffDelay / 1000)}s...`);
              await new Promise(resolve => setTimeout(resolve, backoffDelay));
              continue; // Retry
            } else {
              throw err; // Not a network error, or out of retries
            }
          }
        }
        
        if (!fixedResult) {
          throw new Error('Failed to fix test after network retries');
        }

        // Apply code standards to fixed code
        let formattedCode = fixedResult.testCode;
        
        // Validate test count before processing - ensure we're not losing tests
        const originalTestCount = (currentContent.match(/it\(/g) || []).length;
        const originalDescribeCount = (currentContent.match(/describe\(/g) || []).length;
        
        // ALWAYS format to fix syntax errors before validation
        // Formatting can auto-fix many syntax errors (missing braces, etc.)
        // Even if formatting is disabled in config, we should try it for syntax fixes
        try {
          formattedCode = await formatGeneratedCode(formattedCode, projectRoot);
        } catch {
          // If formatting fails, continue with original code
        }
        
        // Check test count after formatting
        const fixedTestCount = (formattedCode.match(/it\(/g) || []).length;
        const fixedDescribeCount = (formattedCode.match(/describe\(/g) || []).length;
        
        // Reject fixes that remove too many tests (more than 5% loss is suspicious)
        // This prevents the LLM from deleting tests when it should be fixing them
        if (originalTestCount > MIN_TESTS_FOR_RETENTION_CHECK && fixedTestCount < originalTestCount * MIN_TEST_RETENTION_PERCENT) {
          const testLoss = originalTestCount - fixedTestCount;
          const lossPercent = ((testLoss / originalTestCount) * 100).toFixed(1);
          warn(`⚠️ REJECTING FIX: Fixed test file has ${fixedTestCount} tests (down from ${originalTestCount}, ${lossPercent}% loss). Too many tests removed.`);
          warn(`⚠️ The LLM should fix tests, not delete them. If a test can't be fixed, it should be replaced with a minimal passing test.`);
          warn(`⚠️ Rejecting this fix and will retry with stronger instructions.`);
          // Mark as invalid to prevent writing
          throw new Error(`Fix rejected: Too many tests removed (${testLoss} tests, ${lossPercent}% loss). LLM should fix tests, not delete them.`);
        } else if (originalTestCount > 0 && fixedTestCount < originalTestCount * 0.9) {
          warn(`⚠️ Warning: Fixed test file has ${fixedTestCount} tests (down from ${originalTestCount}) and ${fixedDescribeCount} describe blocks (down from ${originalDescribeCount}). Tests may have been removed.`);
          warn(`⚠️ If tests were removed, they should have been replaced with minimal passing tests instead.`);
        }
        
        if (!config.codeStyle?.formatGeneratedCode) {
          // If formatting was disabled, still try import consolidation
          // Even if formatting is disabled, try to consolidate imports to prevent duplicates
          try {
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

        // Validate fixed file before writing (CRITICAL: validation happens BEFORE writing)
        let validation = await validateTestFile(testFile, formattedCode, projectRoot, privateProperties);
        
        // If missing imports detected, fix them automatically
        if (validation.missingImports && validation.missingImports.length > 0) {
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
            e.includes('brace') || e.includes('parenthes') || e.includes('bracket') ||
            e.includes('truncated') || e.includes('incomplete')
          );
          
          if (syntaxErrors.length > 0) {
            // Syntax errors are recoverable - store them and retry in next iteration
            // Include line numbers in validation errors for better LLM guidance
            const syntaxErrorsWithLines = validation.errors.filter(e => 
              e.includes('Unclosed') || e.includes('Syntax') || e.includes('syntax') || 
              e.includes('brace') || e.includes('parenthes') || e.includes('bracket') ||
              e.includes('line') || e.includes('column') || e.includes('truncated') || e.includes('incomplete')
            );
            
            // Increment syntax error attempt counter
            const fileDataWithErrors = currentTestFiles.get(testFile);
            let syntaxErrorAttemptsForFile = 0;
            let lastValidContent: string | undefined = undefined;
            
            if (fileDataWithErrors) {
              const currentSyntaxAttempts = fileDataWithErrors && '_syntaxErrorAttempts' in fileDataWithErrors
                ? ((fileDataWithErrors as { _syntaxErrorAttempts?: number })._syntaxErrorAttempts || 0)
                : 0;
              syntaxErrorAttemptsForFile = currentSyntaxAttempts + 1;
              
              const fileDataWithValidationErrors = {
                ...fileDataWithErrors,
                _validationErrors: syntaxErrorsWithLines, // Store syntax errors with line numbers
                _syntaxErrorAttempts: syntaxErrorAttemptsForFile,
              } as typeof fileDataWithErrors & { _validationErrors: string[]; _syntaxErrorAttempts: number };
              currentTestFiles.set(testFile, fileDataWithValidationErrors);
              
              // Get last valid content if available
              if ('_lastValidContent' in fileDataWithErrors) {
                lastValidContent = (fileDataWithErrors as { _lastValidContent?: string })._lastValidContent;
              }
            } else {
              syntaxErrorAttemptsForFile = 1;
            }
            
            // After 3 syntax error attempts, revert to last valid version if available
            // Check if we have a different valid version to revert to (not the same as current failed attempt)
            if (syntaxErrorAttemptsForFile >= MAX_SYNTAX_ERROR_ATTEMPTS && lastValidContent && fileDataWithErrors) {
              // Only revert if the last valid content is different from what we just tried (formattedCode)
              // This ensures we're reverting to a truly different version
              if (lastValidContent !== formattedCode) {
                warn(`Too many syntax error attempts (${syntaxErrorAttemptsForFile}) for ${testFile}, reverting to last valid version`);
        currentTestFiles.set(testFile, {
                  content: lastValidContent,
                  targets: fileDataWithErrors.targets,
        });
                // Revert file on disk
        const fullPath = join(projectRoot, testFile);
                await fs.writeFile(fullPath, lastValidContent, 'utf-8');
                info(`Reverted ${testFile} to last valid version`);
                // Mark that we made a change (revert) so the loop continues
                // On final attempts, we'll still try to fix the actual test failures
                fixedAny = true;
                // Continue to next file, but keep the loop going so we can try again on final attempts
                continue;
              } else {
                // Last valid is the same as current failed attempt - can't revert, just stop trying this file
                warn(`Too many syntax error attempts (${syntaxErrorAttemptsForFile}) for ${testFile}, but no valid version to revert to. Will skip this file for now.`);
                // Don't mark fixedAny - this file can't be fixed, but continue loop for other files
                continue;
              }
            }
            
            warn(`Syntax errors detected (attempt ${syntaxErrorAttemptsForFile}) for ${testFile}, will retry with syntax fixes`);
            // Mark that we're still working on fixes (don't stop the loop)
            fixedAny = true; // Keep the loop going
          } else {
            // Non-syntax errors (type errors, etc.) - may be harder to fix automatically
            // Still mark as working to keep loop going, but don't store errors
            warn(`Non-syntax validation errors for ${testFile}, will retry in next attempt`);
            fixedAny = true;
          }
          // CRITICAL: Do not write invalid files - skip writing and continue loop
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
          // Save as last valid content BEFORE updating
          cleanedData._lastValidContent = fileDataToClean.content;
          // Update content with validated code
          cleanedData.content = formattedCode;
          currentTestFiles.set(testFile, cleanedData);
          
          // Add to fixes to apply (will be written atomically with others)
          fixesToApply.push({
            testFile,
            formattedCode,
            fileData: cleanedData,
          });
        } else {
          // No existing file data, create new with last valid content
          const newFileData = {
          content: formattedCode,
            targets: currentTestFiles.get(testFile)?.targets || [],
          } as { content: string; targets: string[]; _lastValidContent?: string };
          (newFileData as { _lastValidContent?: string })._lastValidContent = formattedCode;
          currentTestFiles.set(testFile, newFileData);
          
          // Add to fixes to apply
          fixesToApply.push({
            testFile,
            formattedCode,
            fileData: newFileData,
          });
        }

        fixedAny = true;
        info(`✓ Fixed test file: ${testFile} (validated, will write with other fixes)`);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        warn(`Failed to fix test file ${testFile}: ${errorMessage}`);
        
        // If fix was rejected due to test removal, mark that we need stronger instructions
        if (errorMessage.includes('Too many tests removed')) {
          // Store a flag to strengthen instructions on next attempt
          const fileData = currentTestFiles.get(testFile);
          if (fileData) {
            (fileData as { _testRemovalRejected?: boolean })._testRemovalRejected = true;
            currentTestFiles.set(testFile, fileData);
          }
          // Mark as "working" so the loop continues to retry with stronger instructions
          // We want to retry, not stop the loop
          fixedAny = true; // This allows the loop to continue
          warn(`Will retry fix with stronger instructions to prevent test removal`);
        }
      }
    }
    
    // Write all validated fixes atomically (all at once, before tests run again)
    // This ensures tests never run against incomplete/corrupted files
    if (fixesToApply.length > 0) {
      info(`Writing ${fixesToApply.length} validated fix(es) to disk...`);
      for (const { testFile, formattedCode } of fixesToApply) {
        try {
          const fullPath = join(projectRoot, testFile);
          const tempPath = fullPath + '.tmp';
          
          // Write to temp file first
          await fs.writeFile(tempPath, formattedCode, 'utf-8');
          
          // Move to final location (atomic)
          await fs.rename(tempPath, fullPath);
          
          debug(`✓ Wrote validated fix: ${testFile}`);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          warn(`Failed to write fix for ${testFile}: ${errorMessage}`);
        }
      }
      info(`All ${fixesToApply.length} fix(es) written to disk`);
      
      // Type check all fixed files before running tests again
      // This ensures all type errors are fixed before tests run
      if (fixesToApply.length > 0) {
        info('Type checking all fixed files before running tests...');
        
        let typeErrorsFixed = true;
        let typeCheckAttempts = 0;
        const maxTypeCheckAttempts = MAX_TYPE_CHECK_ATTEMPTS_FIX_LOOP;
        
        while (typeErrorsFixed && typeCheckAttempts < maxTypeCheckAttempts) {
          typeCheckAttempts++;
          typeErrorsFixed = false;
          const filesToFix: Array<{ path: string; missingImports?: string[] }> = [];
          
          // Type check all fixed files
          for (const { testFile } of fixesToApply) {
            const fullPath = join(projectRoot, testFile);
            if (!existsSync(fullPath)) {
              continue;
            }
            
            const validation = await validateTypeScript(fullPath, projectRoot);
            
            if (!validation.valid && validation.errors.length > 0) {
              // Check if these are type errors (not syntax errors - those should be caught earlier)
              const typeErrors = validation.errors.filter((e: string) => 
                !e.includes('Unclosed') && 
                !e.includes('Syntax') && 
                !e.includes('syntax') &&
                !e.includes('brace') &&
                !e.includes('parenthes') &&
                !e.includes('bracket')
              );
              
              if (typeErrors.length > 0 || validation.missingImports) {
                filesToFix.push({
                  path: testFile,
                  missingImports: validation.missingImports,
                });
              }
            }
          }
          
          // Fix type errors in all files
          if (filesToFix.length > 0) {
            info(`Found type errors in ${filesToFix.length} file(s), fixing...`);
            typeErrorsFixed = true;
            
            for (const { path: testPath, missingImports } of filesToFix) {
              if (missingImports && missingImports.length > 0) {
                const fullPath = join(projectRoot, testPath);
                const content = readFileSync(fullPath, 'utf-8');
                const isVitest = content.includes("from 'vitest'") || content.includes('from "vitest"');
                const framework = isVitest ? 'vitest' : 'jest';
                const fixedContent = fixMissingImports(content, missingImports, framework);
                
                // Write fixed content
                const tempPath = fullPath + '.tmp';
                await fs.writeFile(tempPath, fixedContent, 'utf-8');
                await fs.rename(tempPath, fullPath);
                
                // Update in-memory test files
                const fileData = currentTestFiles.get(testPath);
                if (fileData) {
                  fileData.content = fixedContent;
                }
                
                info(`✓ Fixed type errors in ${testPath}`);
              }
            }
          } else {
            typeErrorsFixed = false;
          }
        }
        
        if (typeCheckAttempts >= maxTypeCheckAttempts && typeErrorsFixed) {
          warn(`Type checking reached maximum attempts (${maxTypeCheckAttempts}). Proceeding with remaining type errors.`);
        } else if (!typeErrorsFixed) {
          debug('All fixed files pass type checking');
        }
      }
    }

    // Only stop if we're not on the final attempt and no fixes were applied
    // On final attempts, we should still try even if previous attempts failed
    const isFinalAttempt = attempt + 1 >= maxFixAttempts;
    if (!fixedAny && !isFinalAttempt) {
      warn('No fixes could be applied, stopping fix attempts');
      break;
    } else if (!fixedAny && isFinalAttempt) {
      // Final attempt - still try even if no fixes were applied in this iteration
      // This allows us to attempt fixes even after reverts
      warn('No fixes applied in this iteration, but continuing to final attempt');
      fixedAny = true; // Force continue to final attempt
    }

    attempt++;
    
    // Add delay between fix attempts to avoid rate limits
    // Use requestDelay from config, with minimum 1s to avoid hammering the API
    if (attempt < maxFixAttempts && !isInfinite) {
      const delay = Math.max(config.requestDelay || 1000, 1000);
      if (delay > 0) {
        // Waiting before next fix attempt to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  if (!isInfinite && attempt >= maxFixAttempts) {
    const finalResults = await testRunner.runTests({
      testFiles: testFilePaths,
      framework,
      packageManager,
      projectRoot,
      coverage: false,
    });
    const finalFailures = finalResults.reduce((sum, r) => sum + (r.success ? 0 : r.failed), 0);
    
    if (finalFailures > 0) {
      error(`❌ Reached maximum fix attempts (${maxFixAttempts}) with ${finalFailures} test(s) still failing`);
      error(`The final attempt should have made all tests pass. This indicates a critical issue.`);
    } else {
      info(`✓ Reached maximum fix attempts (${maxFixAttempts}) - all tests are now passing`);
    }
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

