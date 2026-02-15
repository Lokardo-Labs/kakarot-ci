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
  options?: ScaffoldPromptOptions,
  testFilePath?: string,
  importPath?: string
): Promise<LLMMessage[]> {
  const systemPrompt = options?.customSystemPrompt 
    ? await loadCustomPrompt(options.customSystemPrompt, buildSystemPrompt(framework))
    : buildSystemPrompt(framework);
  
  const baseUserPrompt = buildUserPrompt(target, framework, existingTestFile, testFilePath, importPath);
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
  const importStatement = framework === 'jest' 
    ? "import { describe, it } from 'jest';" 
    : "import { describe, it } from 'vitest';";
  
  return `You are a test scaffolding assistant. Your task is to generate minimal test file structure with placeholder tests for TypeScript/JavaScript functions.

FRAMEWORK RESTRICTION: You MUST use ${frameworkName} ONLY. This tool ONLY supports Jest and Vitest. Do NOT use any other test framework syntax.

Framework: ${frameworkName}

CRITICAL SYNTAX REQUIREMENTS:
- For ${frameworkName}, use: ${importStatement}
- Use describe() and it() functions directly as standalone functions
- ${frameworkName} syntax: describe('FunctionName', () => { it('test case', () => { ... }); });
- NEVER use test.describe() or test.xxx() - this is NOT ${frameworkName} syntax
- NEVER use test() as a method call on an object (e.g., test.describe, test.it)
- ONLY use: describe() and it() as direct function calls
${framework === 'vitest' ? '- For Vitest: Use vi.Mock, vi.fn(), vi.mock(), vi.spyOn() - NEVER use jest.Mock or jest.fn()' : '- For Jest: Use jest.Mock, jest.fn(), jest.mock(), jest.spyOn() - NEVER use vi.Mock or vi.fn()'}

Requirements:
1. Generate ONLY the basic test structure, not full implementations
2. Use ${frameworkName} syntax and best practices
3. Include proper imports: ${importStatement}
4. Create describe blocks for the function
5. Create it blocks with TODO comments describing what should be tested
6. Do NOT write actual test implementations
7. Do NOT write assertions or test logic
8. Focus on structure and organization
9. Follow the existing test file structure if one exists

Output format:
- Return ONLY the test code, no explanations or markdown code blocks
- The code should be ready to use as a scaffold for manual test writing
- Use TODO comments to indicate what tests need to be written

${frameworkName} example structure:
${importStatement}

describe('FunctionName', () => {
  it('should handle normal case', () => {
    // TODO: implement test
  });

  it('should handle edge case', () => {
    // TODO: implement test
  });
});`;
}

function buildUserPrompt(
  target: TestGenerationContext['target'],
  framework: 'jest' | 'vitest',
  existingTestFile?: string,
  testFilePath?: string,
  importPath?: string
): string {
  let prompt = `Generate a test scaffold for the following function:\n\n`;

  prompt += `Source file: ${target.filePath}\n`;
  if (testFilePath) {
    prompt += `Test file: ${testFilePath}\n`;
  }
  if (importPath) {
    prompt += `IMPORT PATH (use this exact path): ${importPath}\n`;
  }
  prompt += `Function: ${target.functionName}\n`;
  prompt += `Type: ${target.functionType}\n`;
  
  if (target.className) {
    prompt += `Class: ${target.className}\n`;
    prompt += `This is a CLASS METHOD, not a standalone function.\n`;
    prompt += `- Import the CLASS: import { ${target.className} } from '${importPath || './source'}'\n`;
    prompt += `- Instantiate: const instance = new ${target.className}()\n`;
    prompt += `- Call method: instance.${target.functionName}()\n`;
    prompt += `- DO NOT import the method as a function\n`;
  }
  
  if (target.isPrivate) {
    prompt += `WARNING: This is a PRIVATE method.\n`;
  }
  
  if (target.classPrivateProperties && target.classPrivateProperties.length > 0) {
    prompt += `\n⚠️ CRITICAL: The class has PRIVATE properties: ${target.classPrivateProperties.join(', ')}\n`;
    prompt += `These properties are marked 'private' in TypeScript and CANNOT be accessed in tests.\n`;
    prompt += `\nDO NOT DO THIS (will cause TypeScript errors):\n`;
    prompt += `  instance.${target.classPrivateProperties[0]} = value;  // ❌ WRONG - private property\n`;
    prompt += `\nDO THIS INSTEAD:\n`;
    prompt += `  - Use constructor parameters: const instance = new ${target.className}(value);\n`;
    prompt += `  - Use public methods if available\n`;
    prompt += `  - Only test what is accessible through the public API\n\n`;
  }
  
  prompt += '\n';

  prompt += `Function code:\n\`\`\`typescript\n${target.code}\n\`\`\`\n\n`;

  if (target.context) {
    prompt += `Context (surrounding code):\n\`\`\`typescript\n${target.context}\n\`\`\`\n\n`;
  }

  // Detect React component (.tsx files with React imports)
  const isReactComponent = target.filePath.endsWith('.tsx') || 
                           target.code.includes('import React') ||
                           target.code.includes('from \'react\'') ||
                           target.code.includes('from "react"') ||
                           (target.context && (
                             target.context.includes('import React') ||
                             target.context.includes('from \'react\'') ||
                             target.context.includes('from "react"')
                           ));

  if (isReactComponent) {
    prompt += `IMPORTANT: This is a React component. The scaffold MUST include:\n`;
    prompt += `- import '@testing-library/jest-dom' at the top (for DOM matchers like toBeInTheDocument, toHaveAttribute)\n`;
    prompt += `- import { render, screen, fireEvent, act } from '@testing-library/react'\n`;
    prompt += `- TODO comments for: initial render state, user interactions, conditional rendering (loading/empty/error states)\n\n`;
  }

  if (existingTestFile) {
    prompt += `Existing test file structure (follow this pattern):\n\`\`\`typescript\n${existingTestFile}\n\`\`\`\n\n`;
    prompt += `Note: Add new test scaffold to this file, maintaining the existing structure and style.\n\n`;
  }

  const importExample = framework === 'jest' 
    ? "import { describe, it } from 'jest';" 
    : "import { describe, it } from 'vitest';";

  prompt += `Generate a minimal test scaffold with:\n`;
  if (importPath) {
    prompt += `- Import path: ${importPath} (use this exact path)\n`;
  } else {
    prompt += `- Calculate correct relative path from test file to source file\n`;
  }
  if (target.functionType === 'class-method') {
    prompt += `- Import the CLASS, not the method\n`;
    prompt += `- Create instance in setup: const instance = new ${target.className}()\n`;
  }
  prompt += `- Import statement: ${importExample}\n`;
  prompt += `- Use describe() and it() functions directly (NOT test.describe() or test())\n`;
  if (target.className) {
    prompt += `- describe block for ${target.className} class\n`;
    prompt += `- Nested describe block for ${target.functionName} method\n`;
  } else {
  prompt += `- describe block for ${target.functionName}\n`;
  }
  prompt += `- it blocks with TODO comments for test cases (e.g., "it('should handle normal case', () => { // TODO: implement test });")\n`;
  prompt += `- No actual test implementations\n`;
  prompt += `- Clear TODO comments indicating what each test should verify\n`;
  prompt += `- Check existing test file to avoid duplicate describe blocks\n\n`;
  prompt += `CRITICAL: This tool ONLY supports ${framework}. Use ONLY ${framework} syntax:\n`;
  prompt += `- Import: ${importExample}\n`;
  prompt += `- Use describe() and it() as direct function calls\n`;
  prompt += `- NEVER use test.describe() or test.xxx() - those are NOT ${framework} syntax\n`;
  prompt += `${framework === 'vitest' ? '- For Vitest: Use vi.Mock, vi.fn(), vi.mock(), vi.spyOn() - NEVER use jest.Mock or jest.fn()' : '- For Jest: Use jest.Mock, jest.fn(), jest.mock(), jest.spyOn() - NEVER use vi.Mock or vi.fn()'}\n`;
  prompt += `- ONLY supported frameworks: Jest and Vitest (you are using ${framework})\n\n`;

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

