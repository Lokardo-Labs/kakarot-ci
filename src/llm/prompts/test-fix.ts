/**
 * Test fix prompt builder for fix loop
 */

import type { LLMMessage } from '../../types/llm.js';
import type { TestFixContext } from '../../types/llm.js';

export function buildTestFixPrompt(context: TestFixContext): LLMMessage[] {
  const { 
    testCode, 
    errorMessage, 
    testOutput, 
    originalCode, 
    framework, 
    attempt, 
    maxAttempts,
    testFilePath,
    functionNames,
    failingTests,
    sourceFilePath
  } = context;

  const systemPrompt = buildSystemPrompt(framework, attempt, maxAttempts);
  const userPrompt = buildUserPrompt(
    testCode, 
    errorMessage, 
    testOutput, 
    originalCode, 
    framework, 
    attempt,
    testFilePath,
    functionNames,
    failingTests,
    sourceFilePath
  );

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

function buildSystemPrompt(framework: 'jest' | 'vitest', attempt: number, maxAttempts: number): string {
  const frameworkName = framework === 'jest' ? 'Jest' : 'Vitest';
  const importStatement = framework === 'jest' 
    ? "import { describe, it, expect } from 'jest';" 
    : "import { describe, it, expect } from 'vitest';";

  return `You are an expert ${frameworkName} test debugger. Your task is to fix failing unit tests.

FRAMEWORK RESTRICTION: You MUST use ${frameworkName} ONLY. This tool ONLY supports Jest and Vitest. Do NOT use any other test framework syntax.

Context:
- This is fix attempt ${attempt} of ${maxAttempts}
- The test code failed to run or produced incorrect results
- You need to analyze the error and fix the test code

CRITICAL: Tests must match the ACTUAL behavior of the code being tested, not assumed behavior.

CRITICAL SYNTAX: Use ONLY ${frameworkName} syntax:
- Import: ${importStatement}
- Use describe() and it() as direct function calls
- NEVER use test.describe() or test.xxx() - those are NOT ${frameworkName} syntax

Requirements:
1. Analyze the original function code to understand its ACTUAL runtime behavior
2. Fix the test code to match what the function actually does, not what it "should" do
3. Only expect errors/exceptions if the function code actually throws them
4. Match JavaScript/TypeScript runtime semantics:
   - Arithmetic operations do NOT throw errors; they return NaN or Infinity
   - Division by zero returns Infinity (not an error)
   - Modulo by zero returns NaN (not an error)
   - Bitwise operations convert values to 32-bit integers
   - TypeScript types are compile-time only; runtime behavior follows JavaScript rules
5. For async functions:
   - Ensure tests properly await async calls
   - Use resolves/rejects matchers appropriately
   - Test both success and error cases for async functions
6. For functions with dependencies:
   - Ensure mocks are properly set up
   - Verify import paths match the source file
   - Reset mocks if needed for test isolation
7. For error testing:
   - Only expect errors if the function actually throws them
   - Match actual error types and messages
   - Use appropriate matchers (toThrow, rejects, etc.)
8. Maintain the original test intent where possible, but prioritize correctness
9. Use proper ${frameworkName} syntax
10. Ensure all imports and dependencies are correct
11. Fix any syntax errors, type errors, or logical errors

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
  attempt: number,
  testFilePath?: string,
  functionNames?: string[],
  failingTests?: Array<{ testName: string; message: string; stack?: string }>,
  sourceFilePath?: string
): string {
  let prompt = `The following ${framework} test is failing. Fix it:\n\n`;

  // Add file context
  if (sourceFilePath) {
    prompt += `Source file: ${sourceFilePath}\n`;
  }
  if (testFilePath) {
    prompt += `Test file: ${testFilePath}\n`;
  }
  if (functionNames && functionNames.length > 0) {
    prompt += `Functions being tested: ${functionNames.join(', ')}\n`;
  }
  prompt += '\n';

  // Add original function code with better formatting
  prompt += `Original function code:\n\`\`\`typescript\n${originalCode}\n\`\`\`\n\n`;

  // Add failing test code
  prompt += `Failing test code:\n\`\`\`typescript\n${testCode}\n\`\`\`\n\n`;

  // Add detailed error information
  if (failingTests && failingTests.length > 0) {
    prompt += `Failing test cases:\n`;
    for (const failingTest of failingTests) {
      prompt += `- ${failingTest.testName}: ${failingTest.message}\n`;
      if (failingTest.stack) {
        prompt += `  Stack: ${failingTest.stack.split('\n')[0]}\n`;
      }
    }
    prompt += '\n';
  }

  prompt += `Error message:\n\`\`\`\n${errorMessage}\n\`\`\`\n\n`;

  if (testOutput) {
    prompt += `Test output:\n\`\`\`\n${testOutput}\n\`\`\`\n\n`;
  }

  if (attempt > 1) {
    prompt += `Note: This is fix attempt ${attempt} of ${framework === 'jest' ? 'Jest' : 'Vitest'}. Previous attempts failed. Please analyze the error more carefully and ensure:\n`;
    prompt += `- The test matches the ACTUAL runtime behavior of the function\n`;
    prompt += `- All imports and dependencies are correct\n`;
    prompt += `- Mocks are properly configured if needed\n`;
    prompt += `- Async operations are properly handled\n`;
    prompt += `- Error expectations match what the function actually throws\n\n`;
  }

  prompt += `Fix the test code to resolve the error. Return ONLY the corrected test code, no explanations.`;

  return prompt;
}

