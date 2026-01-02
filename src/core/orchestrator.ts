/**
 * Main orchestration function for Kakarot CI
 * Processes pull requests and generates tests
 */

import type { PullRequest } from '../types/github.js';
import type { KakarotConfig } from '../types/config.js';
import type { CoverageReport } from '../types/coverage.js';
import type { TestResult } from '../types/test-runner.js';
import { GitHubClient } from '../github/client.js';
import { loadConfig } from '../utils/config-loader.js';
import { initLogger, info, error, warn, success } from '../utils/logger.js';
import { extractTestTargets } from '../utils/test-target-extractor.js';
import { generateTestsFromTargets } from './test-generation-core.js';
import { buildCoverageSummaryPrompt } from '../llm/prompts/coverage-summary.js';
import { TestGenerator } from '../llm/test-generator.js';

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
  coverageDelta?: import('../types/coverage.js').CoverageDelta;
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

  // Use shared test generation logic
  const result = await generateTestsFromTargets({
    targets,
    config,
    mode: 'pr',
    getExistingTestFile: async (testFilePath: string) => {
      const testFileExists = await githubClient.fileExists(prHeadRef, testFilePath);
      if (testFileExists) {
        try {
          const fileContents = await githubClient.getFileContents(prHeadRef, testFilePath);
          return fileContents.content;
        } catch {
          return undefined;
        }
      }
      return undefined;
    },
  });

  // Convert to summary format
  const summary: TestGenerationSummary = {
    targetsProcessed: result.targetsProcessed,
    testsGenerated: result.testsGenerated,
    testsFailed: result.testsFailed,
    testFiles: result.testFiles,
    errors: result.errors,
    coverageReport: result.coverageReport,
    coverageDelta: result.coverageDelta,
    testResults: result.testResults,
  };

  const testFiles = result.finalTestFiles;

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
    const framework = config.framework;
    const testGenerator = new TestGenerator(config);
    await postPRComment(githubClient, context.prNumber, summary, framework, testGenerator);
  }

  return summary;
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
      // Create a new branch and PR with unique timestamp
      const timestamp = Date.now();
      const branchName = `kakarot-ci/tests-pr-${pr.number}-${timestamp}`;
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
        functionsTested,
        summary.coverageDelta
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

