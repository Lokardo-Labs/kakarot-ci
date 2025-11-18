/**
 * Test fix prompt builder for fix loop
 */

import type { LLMMessage } from '../../types/llm.js';
import type { TestFixContext } from '../../types/llm.js';

export function buildTestFixPrompt(context: TestFixContext): LLMMessage[] {
  const { testCode, errorMessage, testOutput, originalCode, framework, attempt, maxAttempts } = context;

  const systemPrompt = buildSystemPrompt(framework, attempt, maxAttempts);
  const userPrompt = buildUserPrompt(testCode, errorMessage, testOutput, originalCode, framework, attempt);

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

function buildSystemPrompt(framework: 'jest' | 'vitest', attempt: number, maxAttempts: number): string {
  const frameworkName = framework === 'jest' ? 'Jest' : 'Vitest';

  return `You are an expert ${frameworkName} test debugger. Your task is to fix failing unit tests.

Context:
- This is fix attempt ${attempt} of ${maxAttempts}
- The test code failed to run or produced incorrect results
- You need to analyze the error and fix the test code

Requirements:
1. Fix the test code to make it pass
2. Maintain the original test intent
3. Use proper ${frameworkName} syntax
4. Ensure all imports and dependencies are correct
5. Fix any syntax errors, type errors, or logical errors
6. If the original code being tested has issues, note that but focus on fixing the test

Output format:
- Return ONLY the fixed test code, no explanations or markdown code blocks
- The code should be complete and runnable
- Include all necessary imports`;
}

function buildUserPrompt(
  testCode: string,
  errorMessage: string,
  testOutput: string | undefined,
  originalCode: string,
  framework: 'jest' | 'vitest',
  attempt: number
): string {
  let prompt = `The following ${framework} test is failing. Fix it:\n\n`;

  prompt += `Original function code:\n\`\`\`typescript\n${originalCode}\n\`\`\`\n\n`;

  prompt += `Failing test code:\n\`\`\`typescript\n${testCode}\n\`\`\`\n\n`;

  prompt += `Error message:\n\`\`\`\n${errorMessage}\n\`\`\`\n\n`;

  if (testOutput) {
    prompt += `Test output:\n\`\`\`\n${testOutput}\n\`\`\`\n\n`;
  }

  if (attempt > 1) {
    prompt += `Note: This is fix attempt ${attempt}. Previous attempts failed. Please analyze the error more carefully.\n\n`;
  }

  prompt += `Fix the test code to resolve the error. Return ONLY the corrected test code, no explanations.`;

  return prompt;
}

