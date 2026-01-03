/**
 * Test generation prompt builder
 */

import type { LLMMessage } from '../../types/llm.js';
import type { TestGenerationContext } from '../../types/llm.js';

export function buildTestGenerationPrompt(context: TestGenerationContext): LLMMessage[] {
  const { target, framework, existingTestFile, relatedFunctions, testFilePath, importPath } = context;

  const systemPrompt = buildSystemPrompt(framework);
  const userPrompt = buildUserPrompt(target, framework, existingTestFile, relatedFunctions, testFilePath, importPath);

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

function buildSystemPrompt(framework: 'jest' | 'vitest'): string {
  const frameworkName = framework === 'jest' ? 'Jest' : 'Vitest';
  const importStatement = framework === 'jest' ? "import { describe, it, expect } from 'jest';" : "import { describe, it, expect } from 'vitest';";

  return `You are an expert ${frameworkName} test writer. Your task is to generate comprehensive unit tests for TypeScript/JavaScript functions.

FRAMEWORK RESTRICTION: You MUST use ${frameworkName} ONLY. This tool ONLY supports Jest and Vitest. Do NOT use any other test framework syntax.

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
   - Use the CORRECT import path from test file to source file (provided in the prompt)
   - Calculate relative paths correctly: from test directory to source file
   - Import types correctly (type imports for TypeScript types)
   - Mock dependencies at the module level, not the function level
   - NEVER import class methods as standalone functions - import the class and instantiate it
12. Class method handling:
   - If functionType is 'class-method', it is a METHOD, not a standalone function
   - Import the CLASS, not the method as a function
   - Instantiate the class: const instance = new ClassName()
   - Call methods on the instance: instance.methodName()
   - NEVER try to import methods directly: import { methodName } from './file' (WRONG for class methods)
   - NEVER access private properties directly - test through public methods only
   - If a property is private, do NOT try to set it directly (e.g., instance.privateProp = value)
   - Use constructor parameters or public methods to set up test state
13. Fake timers (for debounce, throttle, setTimeout, setInterval):
   - If the function uses setTimeout, setInterval, debounce, or throttle, you MUST use fake timers
   - For Vitest: import { vi } from 'vitest' and use vi.useFakeTimers() in beforeEach
   - For Jest: use jest.useFakeTimers() in beforeEach
   - Always restore real timers in afterEach
   - Use advanceTimersByTime() to advance time in tests
   - Example setup:
     beforeEach(() => {
       ${framework === 'jest' ? 'jest.useFakeTimers();' : 'vi.useFakeTimers();'}
     });
     afterEach(() => {
       ${framework === 'jest' ? 'jest.useRealTimers();' : 'vi.useRealTimers();'}
     });
14. Test isolation:
   - Each test should be independent and not rely on other tests
   - Use beforeEach/afterEach for setup/teardown when needed
   - Don't share mutable state between tests
15. Avoid duplicates:
   - Check existing test file structure to avoid duplicate describe blocks
   - If a test suite already exists, add to it rather than creating a new one
   - Consolidate related tests into the same describe block
16. Use descriptive test names that explain what is being tested
17. Follow the existing test file structure if one exists

Output format:
- Return ONLY the test code, no explanations or markdown code blocks
- The code should be ready to run in a ${frameworkName} environment
- Include necessary imports at the top
- Use proper TypeScript types if the source code uses TypeScript

${frameworkName} example structure (ONLY use this syntax):
${importStatement}

describe('FunctionName', () => {
  it('should handle normal case', () => {
    // test implementation
  });

  it('should handle edge case', () => {
    // test implementation
  });
});

CRITICAL: Use describe() and it() as direct function calls. NEVER use test.describe() or test.xxx() - those are NOT ${frameworkName} syntax.`;
}

function buildUserPrompt(
  target: TestGenerationContext['target'],
  framework: 'jest' | 'vitest',
  existingTestFile?: string,
  relatedFunctions?: Array<{ name: string; code: string }>,
  testFilePath?: string,
  importPath?: string
): string {
  let prompt = `Generate ${framework} unit tests for the following function:\n\n`;

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
    prompt += `WARNING: This is a PRIVATE method. You may not be able to test it directly.\n`;
  }
  
  if (target.classPrivateProperties && target.classPrivateProperties.length > 0) {
    prompt += `WARNING: The class has private properties: ${target.classPrivateProperties.join(', ')}\n`;
    prompt += `- DO NOT access these directly in tests (e.g., instance.privateProp = value)\n`;
    prompt += `- Test through public methods or constructor parameters only\n`;
  }
  
  prompt += '\n';

  prompt += `Function code:\n\`\`\`typescript\n${target.code}\n\`\`\`\n\n`;

  if (target.context) {
    prompt += `Context (surrounding code):\n\`\`\`typescript\n${target.context}\n\`\`\`\n\n`;
  }
  
  // Detect if fake timers are needed
  const needsFakeTimers = target.code.includes('setTimeout') || 
                          target.code.includes('setInterval') || 
                          target.code.includes('debounce') || 
                          target.code.includes('throttle') ||
                          (target.context && (
                            target.context.includes('setTimeout') || 
                            target.context.includes('setInterval') || 
                            target.context.includes('debounce') || 
                            target.context.includes('throttle')
                          ));
  
  if (needsFakeTimers) {
    prompt += `IMPORTANT: This function uses timers (setTimeout/setInterval/debounce/throttle).\n`;
    prompt += `You MUST set up fake timers in your tests:\n`;
    prompt += `- Import: ${framework === 'jest' ? "import { jest } from '@jest/globals';" : "import { vi } from 'vitest';"}\n`;
    prompt += `- beforeEach: ${framework === 'jest' ? 'jest.useFakeTimers();' : 'vi.useFakeTimers();'}\n`;
    prompt += `- afterEach: ${framework === 'jest' ? 'jest.useRealTimers();' : 'vi.useRealTimers();'}\n`;
    prompt += `- Advance time: ${framework === 'jest' ? 'jest.advanceTimersByTime(ms);' : 'vi.advanceTimersByTime(ms);'}\n\n`;
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
  if (target.functionType === 'class-method') {
    prompt += `- This is a CLASS METHOD - import the class, instantiate it, and call the method on the instance\n`;
    prompt += `- DO NOT import the method as a standalone function\n`;
    prompt += `- DO NOT access private properties directly\n`;
  }
  prompt += `- If the function is async, use async/await in tests and test both success and error cases\n`;
  prompt += `- If the function uses external dependencies (imports), mock them appropriately\n`;
  prompt += `- If the function modifies state, test the state changes\n`;
  prompt += `- Match actual return types and values, not assumed types\n`;
  prompt += `- TypeScript types are compile-time only; test runtime behavior\n`;
  prompt += `- JavaScript/TypeScript arithmetic and bitwise operations do NOT throw errors for invalid inputs. They return NaN, Infinity, or perform type coercion. Only test for errors if the function code explicitly throws them.\n`;
  if (importPath) {
    prompt += `- Use this EXACT import path: ${importPath}\n`;
  } else {
    prompt += `- Calculate the correct relative path from test file to source file\n`;
  }
  prompt += `- Check existing test file to avoid duplicate describe blocks\n`;
  prompt += `- If a describe block already exists for this function/class, add tests to it rather than creating a new one\n\n`;

  prompt += `Return ONLY the test code, no explanations or markdown formatting.`;

  return prompt;
}

