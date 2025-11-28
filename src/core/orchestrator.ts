/**
 * Main orchestration function for Kakarot CI
 * Processes pull requests and generates tests
 */

import type { KakarotConfig } from '../types/config.js';
import type { PullRequest } from '../types/github.js';
import { GitHubClient } from '../github/client.js';
import { loadConfig } from '../utils/config-loader.js';
import { initLogger, info, error, warn, success, progress, debug } from '../utils/logger.js';
import { extractTestTargets } from '../utils/test-target-extractor.js';
import { TestGenerator } from '../llm/test-generator.js';
import { getTestFilePath } from '../utils/test-file-path.js';
import { detectPackageManager } from '../utils/package-manager-detector.js';
import { createTestRunner } from '../utils/test-runner/factory.js';
import { writeTestFiles } from '../utils/test-file-writer.js';
import { findProjectRoot } from '../utils/config-loader.js';
import { readCoverageReport } from '../utils/coverage-reader.js';
import { buildCoverageSummaryPrompt } from '../llm/prompts/coverage-summary.js';
import type { TestResult } from '../types/test-runner.js';
import type { CoverageReport } from '../types/coverage.js';

export interface PullRequestContext {
  prNumber: number;
  owner: string;
  repo: string;
  githubToken: string;
}

export interface TestGenerationSummary {
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
  testResults?: TestResult[];
}

/**
 * Main orchestration function to process a pull request and generate tests
 */
export async function runPullRequest(context: PullRequestContext): Promise<TestGenerationSummary> {
  // Load configuration
  const config = await loadConfig();
  
  // Initialize logger
  initLogger(config);
  
  info(`Processing PR #${context.prNumber} for ${context.owner}/${context.repo}`);

  // Initialize GitHub client
  const githubToken = context.githubToken || config.githubToken;
  if (!githubToken) {
    throw new Error('GitHub token is required. Provide it via config.githubToken or context.githubToken');
  }

  const githubClient = new GitHubClient({
    token: githubToken,
    owner: context.owner,
    repo: context.repo,
  });

  // Get PR details
  const pr = await githubClient.getPullRequest(context.prNumber);
  
  if (pr.state !== 'open') {
    warn(`PR #${context.prNumber} is ${pr.state}, skipping test generation`);
    return {
      targetsProcessed: 0,
      testsGenerated: 0,
      testsFailed: 0,
      testFiles: [],
      errors: [],
    };
  }

  info(`PR: ${pr.title} (${pr.head.ref} -> ${pr.base.ref})`);

  // Get PR files
  const prFiles = await githubClient.listPullRequestFiles(context.prNumber);
  
  if (prFiles.length === 0) {
    info('No files changed in this PR');
    return {
      targetsProcessed: 0,
      testsGenerated: 0,
      testsFailed: 0,
      testFiles: [],
      errors: [],
    };
  }

  info(`Found ${prFiles.length} file(s) changed in PR`);

  // Extract test targets
  const prHeadRef = pr.head.sha;
  const targets = await extractTestTargets(
    prFiles,
    githubClient,
    prHeadRef,
    config
  );

  if (targets.length === 0) {
    info('No test targets found in changed files');
    return {
      targetsProcessed: 0,
      testsGenerated: 0,
      testsFailed: 0,
      testFiles: [],
      errors: [],
    };
  }

  // Limit targets based on config
  const limitedTargets = targets.slice(0, config.maxTestsPerPR);
  
  if (targets.length > limitedTargets.length) {
    warn(`Limiting to ${config.maxTestsPerPR} test targets (found ${targets.length})`);
  }

  info(`Found ${limitedTargets.length} test target(s)`);

  // Use configured test framework
  const framework = config.framework;
  info(`Using test framework: ${framework}`);

  // Initialize test generator
  const testGenerator = new TestGenerator({
    apiKey: config.apiKey,
    provider: config.provider,
    model: config.model,
    maxTokens: config.maxTokens,
    maxFixAttempts: config.maxFixAttempts,
    temperature: config.temperature,
    fixTemperature: config.fixTemperature,
  });

  // Generate tests for each target
  let testFiles = new Map<string, { content: string; targets: string[] }>();
  const errors: Array<{ target: string; error: string }> = [];
  let testsGenerated = 0;
  let testsFailed = 0;

  for (let i = 0; i < limitedTargets.length; i++) {
    const target = limitedTargets[i];
    progress(i + 1, limitedTargets.length, `Generating test for ${target.functionName}`);

    try {
      // Determine where the test file should be based on config
      const testFilePath = getTestFilePath(target, config);
      
      // Check if a test file exists at the config-determined path
      let existingTestFile: string | undefined;
      const testFileExists = await githubClient.fileExists(prHeadRef, testFilePath);
      
      if (testFileExists) {
        try {
          const fileContents = await githubClient.getFileContents(prHeadRef, testFilePath);
          existingTestFile = fileContents.content;
          debug(`Found existing test file at ${testFilePath}`);
        } catch (err) {
          debug(`Could not fetch existing test file ${testFilePath}: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        debug(`No existing test file at ${testFilePath}, will create new file`);
      }

      // Generate test
      const result = await testGenerator.generateTest({
        target: {
          filePath: target.filePath,
          functionName: target.functionName,
          functionType: target.functionType,
          code: target.code,
          context: target.context,
        },
        framework,
        existingTestFile,
      });

      // Group tests by file path
      if (!testFiles.has(testFilePath)) {
        // Use existing test file content as base if it exists at this path
        const baseContent = existingTestFile || '';
        testFiles.set(testFilePath, { content: baseContent, targets: [] });
      }

      const fileData = testFiles.get(testFilePath)!;
      
      // Append test content (with separator if base content exists)
      if (fileData.content) {
        fileData.content += '\n\n' + result.testCode;
      } else {
        fileData.content = result.testCode;
      }
      
      fileData.targets.push(target.functionName);
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

  // Write tests to disk and run them
  const projectRoot = await findProjectRoot();
  const packageManager = detectPackageManager(projectRoot);
  info(`Detected package manager: ${packageManager}`);

  if (testFiles.size > 0) {
    // Write test files to disk
    const writtenPaths = writeTestFiles(testFiles, projectRoot);
    info(`Wrote ${writtenPaths.length} test file(s) to disk`);

    // Run tests and fix failures
    const testRunner = createTestRunner(framework);
    const finalTestFiles = await runTestsAndFix(
      testRunner,
      testFiles,
      writtenPaths,
      framework,
      packageManager,
      projectRoot,
      testGenerator,
      config.maxFixAttempts
    );

    // Update testFiles with fixed versions
    testFiles = finalTestFiles;
  }

  // Initialize summary
  const summary: TestGenerationSummary = {
    targetsProcessed: limitedTargets.length,
    testsGenerated,
    testsFailed,
    testFiles: Array.from(testFiles.entries()).map(([path, data]) => ({
      path,
      targets: data.targets,
    })),
    errors,
  };

  // Run tests with coverage for final report (if tests were generated)
  if (testFiles.size > 0) {
    const testRunner = createTestRunner(framework);
    const writtenPaths = Array.from(testFiles.keys());
    
    info('Running tests with coverage...');
    const finalTestResults = await testRunner.runTests({
      testFiles: writtenPaths,
      framework,
      packageManager,
      projectRoot,
      coverage: true,
    });

    // Read coverage report
    const coverageReport = readCoverageReport(projectRoot, framework);
    if (coverageReport) {
      info(`Coverage collected: ${coverageReport.total.lines.percentage.toFixed(1)}% lines`);
      summary.coverageReport = coverageReport;
      summary.testResults = finalTestResults;
    } else {
      warn('Could not read coverage report');
    }
  }

  // Commit tests if enabled
  if (config.enableAutoCommit && testFiles.size > 0) {
    await commitTests(
      githubClient,
      pr,
      Array.from(testFiles.entries()).map(([path, data]) => ({
        path,
        content: data.content,
      })),
      config,
      summary
    );
  }

  // Post PR comment if enabled
  if (config.enablePRComments) {
    await postPRComment(githubClient, context.prNumber, summary, framework, testGenerator);
  }

  success(`Completed: ${testsGenerated} test(s) generated, ${testsFailed} failed`);

  return summary;
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
  maxFixAttempts: number
): Promise<Map<string, { content: string; targets: string[] }>> {
  const currentTestFiles = new Map(testFiles);
  let attempt = 0;

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
    for (const result of results) {
      if (!result.success && result.failures.length > 0) {
        failures.push({ testFile: result.testFile, result });
      }
    }

    info(`Found ${failures.length} failing test file(s), attempting fixes...`);

    // Fix each failing test file
    let fixedAny = false;
    for (const { testFile, result } of failures) {
      const testFileContent = currentTestFiles.get(testFile)?.content;
      if (!testFileContent) {
        warn(`Could not find content for test file: ${testFile}`);
        continue;
      }

      // Get the original source code for context (we need to find which target this test file corresponds to)
      // For now, we'll use the first failure's context
      const firstFailure = result.failures[0];
      if (!firstFailure) continue;

      try {
        // Build fix context - we need the original function code
        // This is a simplified version - in practice, we'd need to map test files back to targets
        const fixedResult = await testGenerator.fixTest({
          testCode: testFileContent,
          errorMessage: firstFailure.message,
          testOutput: firstFailure.stack,
          originalCode: '', // We'd need to pass this from the target
          framework,
          attempt: attempt + 1,
          maxAttempts: maxFixAttempts,
        });

        // Update the test file content
        currentTestFiles.set(testFile, {
          content: fixedResult.testCode,
          targets: currentTestFiles.get(testFile)?.targets || [],
        });

        // Write updated file to disk
        const { writeFileSync } = await import('fs');
        const { join } = await import('path');
        writeFileSync(join(projectRoot, testFile), fixedResult.testCode, 'utf-8');

        fixedAny = true;
        info(`✓ Fixed test file: ${testFile}`);
      } catch (err) {
        error(`Failed to fix test file ${testFile}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!fixedAny) {
      warn(`Could not fix any failing tests on attempt ${attempt + 1}`);
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
 * Commit generated tests to the repository
 */
async function commitTests(
  githubClient: GitHubClient,
  pr: PullRequest,
  testFiles: Array<{ path: string; content: string }>,
  config: KakarotConfig,
  summary: TestGenerationSummary
): Promise<void> {
  info(`Committing ${testFiles.length} test file(s)`);

  try {
    if (config.commitStrategy === 'branch-pr') {
      // Create a new branch and PR
      const branchName = `kakarot-ci/tests-pr-${pr.number}`;
      const baseSha = await githubClient.createBranch(branchName, pr.head.ref);

      // Commit to the new branch
      await githubClient.commitFiles({
        files: testFiles.map(file => ({
          path: file.path,
          content: file.content,
        })),
        message: `test: add unit tests for PR #${pr.number}\n\nGenerated ${summary.testsGenerated} test(s) for ${summary.targetsProcessed} function(s)`,
        branch: branchName,
        baseSha,
      });

      // Create PR
      const testPR = await githubClient.createPullRequest(
        `test: Add unit tests for PR #${pr.number}`,
        `This PR contains automatically generated unit tests for PR #${pr.number}.\n\n` +
        `- ${summary.testsGenerated} test(s) generated\n` +
        `- ${summary.targetsProcessed} function(s) tested\n` +
        `- ${testFiles.length} test file(s) created/updated`,
        branchName,
        pr.head.ref
      );

      success(`Created PR #${testPR.number} with generated tests`);
    } else {
      // Direct commit to PR branch
      await githubClient.commitFiles({
        files: testFiles.map(file => ({
          path: file.path,
          content: file.content,
        })),
        message: `test: add unit tests\n\nGenerated ${summary.testsGenerated} test(s) for ${summary.targetsProcessed} function(s)`,
        branch: pr.head.ref,
        baseSha: pr.head.sha,
      });

      success(`Committed ${testFiles.length} test file(s) to ${pr.head.ref}`);
    }
  } catch (err) {
    error(`Failed to commit tests: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

/**
 * Post a summary comment on the PR
 */
async function postPRComment(
  githubClient: GitHubClient,
  prNumber: number,
  summary: TestGenerationSummary,
  framework: 'jest' | 'vitest',
  testGenerator: TestGenerator
): Promise<void> {
  let comment = `## 🧪 Kakarot CI Test Generation Summary

**Framework:** ${framework}
**Targets Processed:** ${summary.targetsProcessed}
**Tests Generated:** ${summary.testsGenerated}
**Failures:** ${summary.testsFailed}

### Test Files
${summary.testFiles.length > 0 
  ? summary.testFiles.map(f => `- \`${f.path}\` (${f.targets.length} test(s))`).join('\n')
  : 'No test files generated'
}

${summary.errors.length > 0 
  ? `### Errors\n${summary.errors.map(e => `- \`${e.target}\`: ${e.error}`).join('\n')}`
  : ''
}`;

  // Add coverage summary if available
  if (summary.coverageReport && summary.testResults) {
    try {
      // Collect all function names that were tested
      const functionsTested = summary.testFiles.flatMap(f => f.targets);
      
      // Generate human-readable coverage summary via LLM
      const messages = buildCoverageSummaryPrompt(
        summary.coverageReport,
        summary.testResults,
        functionsTested
      );

      const coverageSummary = await testGenerator.generateCoverageSummary(messages);
      comment += `\n\n## 📊 Coverage Summary\n\n${coverageSummary}`;
    } catch (err) {
      warn(`Failed to generate coverage summary: ${err instanceof Error ? err.message : String(err)}`);
      
      // Fallback to basic coverage metrics
      const cov = summary.coverageReport.total;
      comment += `\n\n## 📊 Coverage Summary\n\n` +
        `- **Lines:** ${cov.lines.percentage.toFixed(1)}% (${cov.lines.covered}/${cov.lines.total})\n` +
        `- **Branches:** ${cov.branches.percentage.toFixed(1)}% (${cov.branches.covered}/${cov.branches.total})\n` +
        `- **Functions:** ${cov.functions.percentage.toFixed(1)}% (${cov.functions.covered}/${cov.functions.total})\n` +
        `- **Statements:** ${cov.statements.percentage.toFixed(1)}% (${cov.statements.covered}/${cov.statements.total})`;
    }
  }

  comment += `\n\n---\n*Generated by [Kakarot CI](https://github.com/kakarot-ci)*`;

  try {
    await githubClient.commentPR(prNumber, comment);
    info('Posted PR comment with test generation summary');
  } catch (err) {
    warn(`Failed to post PR comment: ${err instanceof Error ? err.message : String(err)}`);
  }
}

