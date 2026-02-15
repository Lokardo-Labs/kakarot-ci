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

🚨🚨🚨 CRITICAL SYNTAX REQUIREMENT - READ THIS FIRST 🚨🚨🚨
YOUR CODE MUST BE SYNTAX-COMPLETE. INCOMPLETE CODE WILL BE REJECTED.

BEFORE RETURNING CODE, VERIFY:
1. ✅ Every opening brace { has a matching closing brace }
2. ✅ Every opening parenthesis ( has a matching closing parenthesis )
3. ✅ Every opening bracket [ has a matching closing bracket ]
4. ✅ Every function call is complete (no truncated calls)
5. ✅ Every string literal is closed (matching quotes)
6. ✅ Every template literal is closed (matching backticks)
7. ✅ Every arrow function => has a complete body
8. ✅ Every describe() and it() block is complete

VALIDATION CHECKLIST:
- Count opening braces: { count must equal } count
- Count opening parentheses: ( count must equal ) count  
- Count opening brackets: [ count must equal ] count
- No incomplete expressions (e.g., "expect(value" without closing parenthesis)
- No truncated function calls (e.g., "it('test" without closing quote and parenthesis)

IF YOUR CODE HAS UNCLOSED BRACES, PARENTHESES, OR BRACKETS, IT WILL BE REJECTED.
RETURN ONLY COMPLETE, SYNTAX-VALID CODE. INCOMPLETE CODE IS WORSE THAN NO CODE.

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
   - CRITICAL: NEVER access private properties directly - this will cause TypeScript compilation errors
   - If a property is marked 'private' in the class, you CANNOT access it: instance.privateProp = value (WRONG)
   - If a property is marked 'private', you CANNOT read it: const value = instance.privateProp (WRONG)
   - Test through public methods only - use constructor parameters or public setters/getters
   - Example of WRONG: dataProcessor.cache = new Map() or dataProcessor.maxCacheSize = 3
   - Example of CORRECT: const processor = new DataProcessor(3) or processor.setCacheSize(3) if such methods exist
   - If you need to test private state, test it indirectly through public methods that use that state
13. Fake timers (for debounce, throttle, setTimeout, setInterval):
   - If the function uses setTimeout, setInterval, debounce, or throttle, you MUST use fake timers
   - For Vitest: import { vi } from 'vitest' and use vi.useFakeTimers() in beforeEach
   - For Jest: use jest.useFakeTimers() in beforeEach
   - Always restore real timers in afterEach
   - CRITICAL: For async operations with timers, you MUST use the async timer API:
     ${framework === 'vitest' ? 
       '- Use vi.advanceTimersByTimeAsync(ms) for async operations - await it BEFORE awaiting the promise' :
       '- Use jest.advanceTimersByTimeAsync(ms) for async operations - await it BEFORE awaiting the promise'}
   - For sync operations, use ${framework === 'jest' ? 'jest.advanceTimersByTime(ms)' : 'vi.advanceTimersByTime(ms)'}
   - Example setup:
     beforeEach(() => {
       ${framework === 'jest' ? 'jest.useFakeTimers();' : 'vi.useFakeTimers();'}
     });
     afterEach(() => {
       ${framework === 'jest' ? 'jest.useRealTimers();' : 'vi.useRealTimers();'}
     });
   - Example for async with timers (CORRECT):
     const promise = retryWithBackoff(operation, 2, 100);
     await ${framework === 'jest' ? 'jest.advanceTimersByTimeAsync(100)' : 'vi.advanceTimersByTimeAsync(100)'};
     const result = await promise;
   - Example for sync with timers:
     debouncedFunc();
     ${framework === 'jest' ? 'jest.advanceTimersByTime(100)' : 'vi.advanceTimersByTime(100)'};
     expect(func).toHaveBeenCalled();
14. Test isolation:
   - Each test should be independent and not rely on other tests
   - Use beforeEach/afterEach for setup/teardown when needed
   - Don't share mutable state between tests
15. Avoid duplicates:
   - Check existing test file structure to avoid duplicate describe blocks
   - If a test suite already exists (e.g., describe('DataProcessor')), add to it rather than creating a new one
   - Consolidate related tests into the same describe block
   - Only create ONE describe block per class/function - merge tests into existing blocks
   - If you see multiple describe('ClassName') blocks, consolidate them into one
16. Use descriptive test names that explain what is being tested
17. Follow the existing test file structure if one exists
18. TypeScript Type Safety (CRITICAL):
   - All generated code MUST pass TypeScript type checking without errors
   - Use proper type annotations when needed (e.g., const items: (number | null | undefined)[] = [...])
   - When working with union types (e.g., number | null | undefined), ensure type guards or type assertions are used correctly
   - For generic functions like deepMerge, use proper type assertions when merging objects with different shapes:
     - Example: const source = { b: 2 } as Partial<typeof target & { b: number }>;
     - Example: const result = deepMerge(target as typeof target & { b?: number }, source);
   - When calling functions with union type parameters, ensure the function signature matches:
     - If validator expects (item: number | null | undefined): item is number, ensure transformer handles the same types
   - NEVER generate code that will fail TypeScript compilation
   - If you're unsure about types, use type assertions (as Type) or type guards to ensure type safety
   - Test code must be type-safe: all variables, function parameters, and return types must be correctly typed
   - When using mock functions, ensure their types match the expected function signatures
   - For array operations with mixed types, explicitly type the array: const items: (Type1 | Type2)[] = [...]
   - Avoid unnecessary complex type casts. Prefer simple patterns (e.g., setTimeout(() => resolve(undefined), 0)) over multi-layer 'as unknown as' casts
19. Promise rejection safety:
   - When testing functions that return promises expected to reject (e.g., timeouts, error cases), ALWAYS handle the rejection
   - Use await expect(promise).rejects.toThrow() to assert rejections
   - If a promise will reject but the test doesn't assert on it, attach .catch(() => {}) to prevent unhandled rejection crashes
   - NEVER leave a promise that will reject floating without a catch handler — this crashes test runners
   - Example (CORRECT): const promise = waitFor('test', 100).catch(() => {}); jest.advanceTimersByTime(100); await promise;
   - Example (WRONG): waitFor('test', 100); jest.advanceTimersByTime(100); // unhandled rejection!
20. Test coverage depth:
   - Test initial state: verify the component/object state BEFORE any interactions (e.g., assert default values, initial render output, empty inputs)
   - Include negative assertions: verify that side effects do NOT occur when conditions are not met (e.g., expect(mockFn).not.toHaveBeenCalled(), expect(element).not.toBeVisible())
   - For comparison operators (<, <=, >, >=, ===), test values at the EXACT boundary to distinguish between operators. If code uses 'n <= 1', test n=1 (boundary hit) AND n=2 (boundary miss). If code uses 'index < 0', test index=0 (boundary miss) AND index=-1 (boundary hit).
   - For React useEffect cleanup functions and timer-based code, include tests that verify cleanup behavior (timers cleared on unmount/re-render, subscriptions removed, pending operations cancelled)
   - For wrap-around, cycling, or iteration-based behavior, trace through state changes step by step. If state starts at -1, account for the extra iteration to reach 0. Verify your loop count matches the expected final state.

Output format:
- Return ONLY the test code, no explanations or markdown code blocks
- The code should be ready to run in a ${frameworkName} environment
- Include necessary imports at the top
- Use proper TypeScript types - ALL code MUST pass TypeScript type checking
- Ensure type safety: use type annotations, type guards, and type assertions as needed

🚨 FINAL SYNTAX CHECK BEFORE RETURNING:
1. Verify ALL braces, parentheses, and brackets are closed
2. Verify NO incomplete function calls or expressions
3. Verify ALL strings and template literals are closed
4. Count and match: { = }, ( = ), [ = ]
5. If ANY syntax is incomplete, DO NOT RETURN - fix it first

INCOMPLETE CODE WILL BE REJECTED. ONLY RETURN SYNTAX-COMPLETE CODE.

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

CRITICAL: Use describe() and it() as direct function calls. NEVER use test.describe() or test.xxx() - those are NOT ${frameworkName} syntax.
${framework === 'vitest' ? 'CRITICAL: For Vitest, use vi.Mock, vi.fn(), vi.mock(), vi.spyOn() - NEVER use jest.Mock or jest.fn()' : 'CRITICAL: For Jest, use jest.Mock, jest.fn(), jest.mock(), jest.spyOn() - NEVER use vi.Mock or vi.fn()'}`;
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
    prompt += `\n⚠️ CRITICAL: The class has PRIVATE properties: ${target.classPrivateProperties.join(', ')}\n`;
    prompt += `These properties are marked 'private' in TypeScript and CANNOT be accessed in tests.\n`;
    prompt += `\nDO NOT DO THIS (will cause TypeScript errors):\n`;
    prompt += `  instance.${target.classPrivateProperties[0]} = value;  // ❌ WRONG - private property\n`;
    prompt += `  const val = instance.${target.classPrivateProperties[0]};  // ❌ WRONG - private property\n`;
    prompt += `\nDO THIS INSTEAD:\n`;
    prompt += `  - Use constructor parameters: const instance = new ${target.className}(value);\n`;
    prompt += `  - Use public methods if available: instance.setProperty(value);\n`;
    prompt += `  - Test indirectly through public methods that use the private property\n`;
    prompt += `  - Only test what is accessible through the public API\n\n`;
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
    prompt += `IMPORTANT: This is a React component. You MUST follow these React testing rules:\n`;
    prompt += `- Use @testing-library/react for rendering and queries: import { render, screen, fireEvent, act } from '@testing-library/react'\n`;
    prompt += `- ALWAYS import @testing-library/jest-dom at the TOP of the test file for DOM matchers: import '@testing-library/jest-dom'\n`;
    prompt += `  This provides matchers like toBeInTheDocument(), toHaveAttribute(), toHaveTextContent(), toBeVisible(), etc.\n`;
    prompt += `  WITHOUT this import, those matchers will cause TypeScript errors.\n`;
    prompt += `- Render components using React.createElement() or JSX if the test file supports it\n`;
    prompt += `- Use screen.getByTestId(), screen.getByRole(), screen.getByText() for element queries\n`;
    prompt += `- Wrap state updates in act() when needed\n`;
    prompt += `- For components with debounced/delayed behavior, use fake timers and act() together\n`;
    prompt += `- Test initial render state BEFORE any interactions (default values, initial visibility, placeholder text)\n`;
    prompt += `- Test user interactions: clicks, keyboard events, input changes\n`;
    prompt += `- Test conditional rendering: loading states, empty states, error states\n\n`;
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
    prompt += `- CRITICAL: DO NOT access private properties directly - TypeScript will reject this at compile time\n`;
    if (target.classPrivateProperties && target.classPrivateProperties.length > 0) {
      prompt += `- The following properties are PRIVATE and cannot be accessed: ${target.classPrivateProperties.join(', ')}\n`;
      prompt += `- Instead of: instance.${target.classPrivateProperties[0]} = value\n`;
      prompt += `- Use: const instance = new ${target.className}(value) or public methods\n`;
    }
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

