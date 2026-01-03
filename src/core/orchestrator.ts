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
    // Check if we should skip commit for failing tests
    const shouldSkipCommit = summary.testsFailed > 0 && config.skipCommitOnFailure;
    
    if (shouldSkipCommit) {
      warn(`Skipping commit due to ${summary.testsFailed} failing test(s). Set skipCommitOnFailure: false to commit anyway.`);
    } else {
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
function buildCommitMessage(
  config: KakarotConfig,
  summary: TestGenerationSummary,
  prNumber?: number
): string {
  if (config.commitMessageTemplate) {
    // Replace template variables
    return config.commitMessageTemplate
      .replace('{{testsGenerated}}', String(summary.testsGenerated))
      .replace('{{targetsProcessed}}', String(summary.targetsProcessed))
      .replace('{{testFilesCount}}', String(summary.testFiles.length))
      .replace('{{prNumber}}', prNumber ? String(prNumber) : '')
      .replace('{{testsFailed}}', String(summary.testsFailed));
  }
  
  // Default commit message
  const baseMessage = prNumber 
    ? `test: add unit tests for PR #${prNumber}`
    : `test: add unit tests`;
  
  return `${baseMessage}\n\nGenerated ${summary.testsGenerated} test(s) for ${summary.targetsProcessed} function(s)`;
}

async function commitTests(
  githubClient: GitHubClient,
  pr: PullRequest,
  testFiles: Array<{ path: string; content: string }>,
  config: KakarotConfig,
  summary: TestGenerationSummary
): Promise<void> {
  info(`Committing ${testFiles.length} test file(s)`);

  try {
    const commitMessage = buildCommitMessage(config, summary, pr.number);
    
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
        message: commitMessage,
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
      try {
        // Get latest PR to ensure we have the most recent SHA
        const latestPR = await githubClient.getPullRequest(pr.number);
        
      await githubClient.commitFiles({
        files: testFiles.map(file => ({
          path: file.path,
          content: file.content,
        })),
        message: commitMessage,
        branch: pr.head.ref,
          baseSha: latestPR.head.sha, // Use latest SHA to avoid conflicts
      });

      success(`Committed ${testFiles.length} test file(s) to ${pr.head.ref}`);
      } catch (commitErr: unknown) {
        // Check if it's a conflict error
        const isConflict = commitErr && typeof commitErr === 'object' && 
          ('status' in commitErr && commitErr.status === 409) ||
          (commitErr instanceof Error && (
            commitErr.message.includes('409') ||
            commitErr.message.includes('conflict') ||
            commitErr.message.includes('reference is not up to date')
          ));
        
        if (isConflict) {
          warn('Commit failed due to branch conflict. The PR branch has moved ahead.');
          warn('This usually means the PR was updated while tests were being generated.');
          warn('You may need to run Kakarot CI again, or manually merge the latest changes.');
          throw new Error('Commit conflict: PR branch has moved ahead. Please retry after syncing with the base branch.');
        }
        throw commitErr;
      }
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
      
      // Add coverage badges
      const cov = summary.coverageReport.total;
      const linesPercent = cov.lines.percentage.toFixed(1);
      const branchesPercent = cov.branches.percentage.toFixed(1);
      const functionsPercent = cov.functions.percentage.toFixed(1);
      const statementsPercent = cov.statements.percentage.toFixed(1);
      
      const badgeColor = (percent: number) => {
        if (percent >= 80) return 'brightgreen';
        if (percent >= 60) return 'green';
        if (percent >= 40) return 'yellow';
        if (percent >= 20) return 'orange';
        return 'red';
      };
      
      const linesBadge = `![Lines Coverage](https://img.shields.io/badge/lines-${linesPercent}%25-${badgeColor(cov.lines.percentage)}?style=flat-square)`;
      const branchesBadge = `![Branches Coverage](https://img.shields.io/badge/branches-${branchesPercent}%25-${badgeColor(cov.branches.percentage)}?style=flat-square)`;
      const functionsBadge = `![Functions Coverage](https://img.shields.io/badge/functions-${functionsPercent}%25-${badgeColor(cov.functions.percentage)}?style=flat-square)`;
      const statementsBadge = `![Statements Coverage](https://img.shields.io/badge/statements-${statementsPercent}%25-${badgeColor(cov.statements.percentage)}?style=flat-square)`;
      
      comment += `\n\n## 📊 Coverage Summary\n\n`;
      comment += `${linesBadge} ${branchesBadge} ${functionsBadge} ${statementsBadge}\n\n`;
      comment += `${coverageSummary}`;
    } catch (err) {
      warn(`Failed to generate coverage summary: ${err instanceof Error ? err.message : String(err)}`);
      
      // Fallback to basic coverage metrics
      const cov = summary.coverageReport.total;
      const linesPercent = cov.lines.percentage.toFixed(1);
      const branchesPercent = cov.branches.percentage.toFixed(1);
      const functionsPercent = cov.functions.percentage.toFixed(1);
      const statementsPercent = cov.statements.percentage.toFixed(1);
      
      // Coverage badges using shields.io
      const badgeColor = (percent: number) => {
        if (percent >= 80) return 'brightgreen';
        if (percent >= 60) return 'green';
        if (percent >= 40) return 'yellow';
        if (percent >= 20) return 'orange';
        return 'red';
      };
      
      const linesBadge = `![Lines Coverage](https://img.shields.io/badge/lines-${linesPercent}%25-${badgeColor(cov.lines.percentage)}?style=flat-square)`;
      const branchesBadge = `![Branches Coverage](https://img.shields.io/badge/branches-${branchesPercent}%25-${badgeColor(cov.branches.percentage)}?style=flat-square)`;
      const functionsBadge = `![Functions Coverage](https://img.shields.io/badge/functions-${functionsPercent}%25-${badgeColor(cov.functions.percentage)}?style=flat-square)`;
      const statementsBadge = `![Statements Coverage](https://img.shields.io/badge/statements-${statementsPercent}%25-${badgeColor(cov.statements.percentage)}?style=flat-square)`;
      
      comment += `\n\n## 📊 Coverage Summary\n\n`;
      comment += `${linesBadge} ${branchesBadge} ${functionsBadge} ${statementsBadge}\n\n`;
      comment += `- **Lines:** ${linesPercent}% (${cov.lines.covered}/${cov.lines.total})\n` +
        `- **Branches:** ${branchesPercent}% (${cov.branches.covered}/${cov.branches.total})\n` +
        `- **Functions:** ${functionsPercent}% (${cov.functions.covered}/${cov.functions.total})\n` +
        `- **Statements:** ${statementsPercent}% (${cov.statements.covered}/${cov.statements.total})`;
      
      // Add coverage delta if available
      if (summary.coverageDelta) {
        const delta = summary.coverageDelta;
        const deltaLines = delta.lines > 0 ? `+${delta.lines.toFixed(1)}` : delta.lines.toFixed(1);
        const deltaBranches = delta.branches > 0 ? `+${delta.branches.toFixed(1)}` : delta.branches.toFixed(1);
        const deltaFunctions = delta.functions > 0 ? `+${delta.functions.toFixed(1)}` : delta.functions.toFixed(1);
        const deltaStatements = delta.statements > 0 ? `+${delta.statements.toFixed(1)}` : delta.statements.toFixed(1);
        
        comment += `\n\n**Coverage Changes:**\n`;
        comment += `- Lines: ${deltaLines}% | Branches: ${deltaBranches}% | Functions: ${deltaFunctions}% | Statements: ${deltaStatements}%`;
      }
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

