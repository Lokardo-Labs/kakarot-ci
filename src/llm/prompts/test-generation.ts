/**
 * Test generation prompt builder
 */

import type { LLMMessage } from '../../types/llm.js';
import type { TestGenerationContext } from '../../types/llm.js';

export function buildTestGenerationPrompt(context: TestGenerationContext): LLMMessage[] {
  const { target, framework, existingTestFile, relatedFunctions } = context;

  const systemPrompt = buildSystemPrompt(framework);
  const userPrompt = buildUserPrompt(target, framework, existingTestFile, relatedFunctions);

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

function buildSystemPrompt(framework: 'jest' | 'vitest'): string {
  const frameworkName = framework === 'jest' ? 'Jest' : 'Vitest';
  const importStatement = framework === 'jest' ? "import { describe, it, expect } from 'jest';" : "import { describe, it, expect } from 'vitest';";

  return `You are an expert ${frameworkName} test writer. Your task is to generate comprehensive unit tests for TypeScript/JavaScript functions.

CRITICAL: Test the ACTUAL behavior of the code, not assumed behavior.

Requirements:
1. Generate complete, runnable ${frameworkName} test code
2. Use ${frameworkName} syntax and best practices
3. Analyze the function code to determine its ACTUAL runtime behavior before writing tests
4. Test edge cases and normal operation based on what the code actually does
5. Only test for errors/exceptions if the code actually throws them (check for try/catch, throw statements, or validation logic)
6. Match JavaScript/TypeScript runtime semantics:
   - Arithmetic operations (+, -, *, /, %, **) do NOT throw errors for invalid inputs; they return NaN or Infinity
   - Division by zero returns Infinity (not an error)
   - Modulo by zero returns NaN (not an error)
   - Bitwise operations convert values to 32-bit integers
   - Operations with null/undefined may coerce to numbers or return NaN
   - TypeScript types are compile-time only; runtime behavior follows JavaScript rules
7. For async functions:
   - Use async/await or .then()/.catch() appropriately
   - Test both resolved and rejected promises
   - Use resolves and rejects matchers when appropriate
   - Await async function calls in tests
8. For functions with side effects or external dependencies:
   - Mock external dependencies (APIs, file system, databases, etc.)
   - Mock imported modules using ${framework === 'jest' ? 'jest.mock()' : 'vi.mock()'}
   - Reset mocks between tests to ensure test isolation
   - Verify mock calls if the function's behavior depends on them
9. For functions that modify state:
   - Test state before and after function calls
   - Reset state between tests if needed
   - Test state mutations, not just return values
10. For error testing:
   - Only test for errors if the function actually throws them
   - Match actual error types and messages (use toThrow() with specific error types/messages)
   - For async errors, use rejects matcher
11. Import handling:
   - Use the same import paths as the source file
   - Import types correctly (type imports for TypeScript types)
   - Mock dependencies at the module level, not the function level
12. Test isolation:
   - Each test should be independent and not rely on other tests
   - Use beforeEach/afterEach for setup/teardown when needed
   - Don't share mutable state between tests
13. Use descriptive test names that explain what is being tested
14. Follow the existing test file structure if one exists

Output format:
- Return ONLY the test code, no explanations or markdown code blocks
- The code should be ready to run in a ${frameworkName} environment
- Include necessary imports at the top
- Use proper TypeScript types if the source code uses TypeScript

${frameworkName} example structure:
${importStatement}

describe('FunctionName', () => {
  it('should handle normal case', () => {
    // test implementation
  });

  it('should handle edge case', () => {
    // test implementation
  });
});`;
}

function buildUserPrompt(
  target: TestGenerationContext['target'],
  framework: 'jest' | 'vitest',
  existingTestFile?: string,
  relatedFunctions?: Array<{ name: string; code: string }>
): string {
  let prompt = `Generate ${framework} unit tests for the following function:\n\n`;

  prompt += `File: ${target.filePath}\n`;
  prompt += `Function: ${target.functionName}\n`;
  prompt += `Type: ${target.functionType}\n\n`;

  prompt += `Function code:\n\`\`\`typescript\n${target.code}\n\`\`\`\n\n`;

  if (target.context) {
    prompt += `Context (surrounding code):\n\`\`\`typescript\n${target.context}\n\`\`\`\n\n`;
  }

  if (relatedFunctions && relatedFunctions.length > 0) {
    prompt += `Related functions (for context):\n`;
    relatedFunctions.forEach((fn) => {
      prompt += `\n${fn.name}:\n\`\`\`typescript\n${fn.code}\n\`\`\`\n`;
    });
    prompt += '\n';
  }

  if (existingTestFile) {
    prompt += `Existing test file structure (follow this pattern):\n\`\`\`typescript\n${existingTestFile}\n\`\`\`\n\n`;
    prompt += `Note: Add new tests to this file, maintaining the existing structure and style.\n\n`;
  }

  prompt += `Generate comprehensive unit tests for ${target.functionName}. IMPORTANT: Analyze the function code above to determine its ACTUAL behavior before writing tests.\n\n`;
  prompt += `Include:\n`;
  prompt += `- Tests for normal operation with various inputs\n`;
  prompt += `- Tests for edge cases based on what the code actually does (null, undefined, empty arrays, etc.)\n`;
  prompt += `- Tests for error conditions ONLY if the code actually throws errors (check for throw statements, validation, or error handling)\n`;
  prompt += `- Tests for boundary conditions\n`;
  prompt += `- Proper mocking of dependencies if needed\n\n`;
  prompt += `Key considerations:\n`;
  prompt += `- If the function is async, use async/await in tests and test both success and error cases\n`;
  prompt += `- If the function uses external dependencies (imports), mock them appropriately\n`;
  prompt += `- If the function modifies state, test the state changes\n`;
  prompt += `- Match actual return types and values, not assumed types\n`;
  prompt += `- TypeScript types are compile-time only; test runtime behavior\n`;
  prompt += `- JavaScript/TypeScript arithmetic and bitwise operations do NOT throw errors for invalid inputs. They return NaN, Infinity, or perform type coercion. Only test for errors if the function code explicitly throws them.\n`;
  prompt += `- Use the same import paths as the source file for consistency\n\n`;

  prompt += `Return ONLY the test code, no explanations or markdown formatting.`;

  return prompt;
}

