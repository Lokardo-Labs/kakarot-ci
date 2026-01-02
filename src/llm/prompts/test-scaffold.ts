/**
 * Test scaffold prompt builder
 */

import type { LLMMessage } from '../../types/llm.js';
import type { TestGenerationContext } from '../../types/llm.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { findProjectRoot } from '../../utils/config-loader.js';

export interface ScaffoldPromptOptions {
  customSystemPrompt?: string;
  customUserPrompt?: string;
}

export async function buildTestScaffoldPrompt(
  target: TestGenerationContext['target'],
  framework: 'jest' | 'vitest',
  existingTestFile?: string,
  options?: ScaffoldPromptOptions
): Promise<LLMMessage[]> {
  const systemPrompt = options?.customSystemPrompt 
    ? await loadCustomPrompt(options.customSystemPrompt, buildSystemPrompt(framework))
    : buildSystemPrompt(framework);
  
  const baseUserPrompt = buildUserPrompt(target, framework, existingTestFile);
  const userPrompt = options?.customUserPrompt
    ? await loadCustomPrompt(options.customUserPrompt, baseUserPrompt)
    : baseUserPrompt;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

function buildSystemPrompt(framework: 'jest' | 'vitest'): string {
  const frameworkName = framework === 'jest' ? 'Jest' : 'Vitest';
  
  return `You are a test scaffolding assistant. Your task is to generate minimal test file structure with placeholder tests for TypeScript/JavaScript functions.

Framework: ${frameworkName}

Requirements:
1. Generate ONLY the basic test structure, not full implementations
2. Use ${frameworkName} syntax and best practices
3. Include proper imports
4. Create describe blocks for the function
5. Create it blocks with TODO comments describing what should be tested
6. Do NOT write actual test implementations
7. Do NOT write assertions or test logic
8. Focus on structure and organization
9. Follow the existing test file structure if one exists

Output format:
- Return ONLY the test code, no explanations or markdown code blocks
- The code should be ready to use as a scaffold for manual test writing
- Use TODO comments to indicate what tests need to be written`;
}

function buildUserPrompt(
  target: TestGenerationContext['target'],
  framework: 'jest' | 'vitest',
  existingTestFile?: string
): string {
  let prompt = `Generate a test scaffold for the following function:\n\n`;

  prompt += `File: ${target.filePath}\n`;
  prompt += `Function: ${target.functionName}\n`;
  prompt += `Type: ${target.functionType}\n\n`;

  prompt += `Function code:\n\`\`\`typescript\n${target.code}\n\`\`\`\n\n`;

  if (target.context) {
    prompt += `Context (surrounding code):\n\`\`\`typescript\n${target.context}\n\`\`\`\n\n`;
  }

  if (existingTestFile) {
    prompt += `Existing test file structure (follow this pattern):\n\`\`\`typescript\n${existingTestFile}\n\`\`\`\n\n`;
    prompt += `Note: Add new test scaffold to this file, maintaining the existing structure and style.\n\n`;
  }

  prompt += `Generate a minimal test scaffold with:\n`;
  prompt += `- Proper imports for ${framework}\n`;
  prompt += `- describe block for ${target.functionName}\n`;
  prompt += `- it blocks with TODO comments for test cases (e.g., "it('should handle normal case', () => { // TODO: implement test });")\n`;
  prompt += `- No actual test implementations\n`;
  prompt += `- Clear TODO comments indicating what each test should verify\n\n`;

  return prompt;
}

/**
 * Load custom prompt from file or use default
 */
async function loadCustomPrompt(
  customPath: string,
  defaultPrompt: string
): Promise<string> {
  const projectRoot = await findProjectRoot();
  const fullPath = join(projectRoot, customPath);
  
  if (existsSync(fullPath)) {
    try {
      return readFileSync(fullPath, 'utf-8');
    } catch (err) {
      console.warn(`Failed to load custom prompt from ${customPath}: ${err instanceof Error ? err.message : String(err)}`);
      return defaultPrompt;
    }
  }
  
  // If path doesn't exist, treat it as inline prompt text
  return customPath;
}

