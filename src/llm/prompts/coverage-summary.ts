import type { LLMMessage } from '../../types/llm.js';
import type { CoverageReport, CoverageDelta } from '../../types/coverage.js';
import type { TestResult } from '../../types/test-runner.js';

/**
 * Build prompt for generating human-readable coverage summary
 */
export function buildCoverageSummaryPrompt(
  coverageReport: CoverageReport,
  testResults: TestResult[],
  functionsTested: string[],
  coverageDelta?: CoverageDelta
): LLMMessage[] {
  const systemPrompt = `You are a technical writer specializing in test coverage reports. Your task is to generate a clear, concise, and actionable summary of test coverage metrics.

Requirements:
1. Use clear, professional language
2. Highlight key metrics (lines, branches, functions, statements)
3. Mention which functions were tested
4. If coverage delta is provided, explain the change
5. Provide actionable insights or recommendations
6. Format as markdown suitable for GitHub PR comments
7. Keep it concise (2-3 paragraphs max)`;

  const totalTests = testResults.reduce((sum, r) => sum + r.total, 0);
  const passedTests = testResults.reduce((sum, r) => sum + r.passed, 0);
  const failedTests = testResults.reduce((sum, r) => sum + r.failed, 0);

  const userPrompt = `Generate a human-readable test coverage summary with the following information:

**Coverage Metrics:**
- Lines: ${coverageReport.total.lines.percentage.toFixed(1)}% (${coverageReport.total.lines.covered}/${coverageReport.total.lines.total})
- Branches: ${coverageReport.total.branches.percentage.toFixed(1)}% (${coverageReport.total.branches.covered}/${coverageReport.total.branches.total})
- Functions: ${coverageReport.total.functions.percentage.toFixed(1)}% (${coverageReport.total.functions.covered}/${coverageReport.total.functions.total})
- Statements: ${coverageReport.total.statements.percentage.toFixed(1)}% (${coverageReport.total.statements.covered}/${coverageReport.total.statements.total})

**Test Results:**
- Total tests: ${totalTests}
- Passed: ${passedTests}
- Failed: ${failedTests}

**Functions Tested:**
${functionsTested.length > 0 ? functionsTested.map(f => `- ${f}`).join('\n') : 'None'}

${coverageDelta ? `**Coverage Changes:**
- Lines: ${coverageDelta.lines > 0 ? '+' : ''}${coverageDelta.lines.toFixed(1)}%
- Branches: ${coverageDelta.branches > 0 ? '+' : ''}${coverageDelta.branches.toFixed(1)}%
- Functions: ${coverageDelta.functions > 0 ? '+' : ''}${coverageDelta.functions.toFixed(1)}%
- Statements: ${coverageDelta.statements > 0 ? '+' : ''}${coverageDelta.statements.toFixed(1)}%
` : ''}

Generate a concise, professional summary that explains what was tested and the coverage achieved.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

