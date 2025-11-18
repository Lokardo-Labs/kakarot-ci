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

Requirements:
1. Generate complete, runnable ${frameworkName} test code
2. Use ${frameworkName} syntax and best practices
3. Test edge cases, error conditions, and normal operation
4. Use descriptive test names that explain what is being tested
5. Include proper setup/teardown if needed
6. Mock external dependencies appropriately
7. Test both success and failure scenarios
8. Follow the existing test file structure if one exists

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

  prompt += `Generate comprehensive unit tests for ${target.functionName}. Include:\n`;
  prompt += `- Tests for normal operation with various inputs\n`;
  prompt += `- Tests for edge cases (null, undefined, empty arrays, etc.)\n`;
  prompt += `- Tests for error conditions if applicable\n`;
  prompt += `- Tests for boundary conditions\n`;
  prompt += `- Proper mocking of dependencies if needed\n\n`;

  prompt += `Return ONLY the test code, no explanations or markdown formatting.`;

  return prompt;
}

