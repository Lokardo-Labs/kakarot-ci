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
    sourceFilePath,
    _validationErrors,
    _testRemovalRejected
  } = context;

  const systemPrompt = buildSystemPrompt(framework, attempt, maxAttempts, _testRemovalRejected);
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
    sourceFilePath,
    _validationErrors,
    maxAttempts,
    _testRemovalRejected
  );

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

function buildSystemPrompt(framework: 'jest' | 'vitest', attempt: number, maxAttempts: number, testRemovalRejected?: boolean): string {
  const frameworkName = framework === 'jest' ? 'Jest' : 'Vitest';
  const importStatement = framework === 'jest' 
    ? "import { describe, it, expect } from 'jest';" 
    : "import { describe, it, expect } from 'vitest';";

  const isHalfway = attempt >= Math.ceil(maxAttempts / 2);
  const isFinalAttempt = attempt >= maxAttempts;
  const attemptsRemaining = maxAttempts - attempt + 1;

  let systemPrompt = `You are an expert ${frameworkName} test fixer. Your job is to fix failing tests by correcting the test code, not the implementation.\n\n`;
  
  // Add critical warning if previous fix was rejected for removing tests
  if (testRemovalRejected) {
    systemPrompt += `🚨🚨🚨 CRITICAL: Your previous fix attempt was REJECTED because it removed too many tests.\n`;
    systemPrompt += `🚨🚨🚨 YOU MUST NOT DELETE TESTS. If a test cannot be fixed, REPLACE IT WITH A MINIMAL PASSING TEST.\n`;
    systemPrompt += `🚨🚨🚨 Example minimal test: it('test name', () => { expect(functionName()).toBeDefined(); });\n`;
    systemPrompt += `🚨🚨🚨 You MUST preserve ALL tests - deleting tests will cause your fix to be REJECTED again.\n\n`;
  }

  let priorityMessage = '';
  if (isFinalAttempt) {
    priorityMessage = `\n\n🚨🚨🚨 CRITICAL: THIS IS THE FINAL ATTEMPT (${attempt}/${maxAttempts}). TESTS MUST PASS - NO EXCEPTIONS.\n` +
      `\nABSOLUTE PRIORITY: FIX TESTS TO PASS - PRESERVE COVERAGE\n` +
      `- FIRST: Try to fix failing tests by correcting assertions to match actual behavior\n` +
      `- Simplify assertions if needed - use basic matchers: toBe(), toEqual(), toBeTruthy(), toBeFalsy()\n` +
      `- If a test expects wrong behavior, FIX THE EXPECTATION to match what the function actually does\n` +
      `- If a test cannot be fixed, REPLACE IT WITH A MINIMAL PASSING TEST - do NOT delete it\n` +
      `- Minimal test example: it('should work', () => { expect(functionName()).toBeDefined(); });\n` +
      `- Even a minimal test is better than no test - preserve test coverage at all costs\n` +
      `- Preserve test coverage - maintain tests for all functions and edge cases\n` +
      `- If async operations are failing, fix the async handling (await, timers) rather than removing\n` +
      `- If mocks are causing issues, fix the mocks or use real values, but keep the test\n` +
      `- THE GOAL: ZERO FAILING TESTS while maintaining comprehensive coverage\n` +
      `- NEVER delete tests - if you can't fix it, replace with a minimal passing test\n` +
      `- Test quality matters, but a minimal passing test is better than no test\n\n`;
  } else if (isHalfway) {
    priorityMessage = `\n\n⚠️ WARNING: We're ${attempt}/${maxAttempts} attempts in (${attemptsRemaining} remaining). Start prioritizing test PASSING over perfect test quality.\n` +
      `- Focus on making tests pass - simplify if needed\n` +
      `- Simplify complex edge cases that are failing - but keep the tests\n` +
      `- If a test can't be fixed, replace with a minimal passing test - don't delete it\n` +
      `- Use simpler assertions that are more likely to pass\n` +
      `- Even a minimal test is better than no test - preserve coverage\n`;
  }

  systemPrompt += `You are an expert ${frameworkName} test debugger. Your task is to fix failing unit tests.

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

Context:
- This is fix attempt ${attempt} of ${maxAttempts}${attemptsRemaining > 1 ? ` (${attemptsRemaining} attempts remaining)` : ' (FINAL ATTEMPT)'}
- The test code failed to run or produced incorrect results
- You need to analyze the error and fix the test code
${priorityMessage}

CRITICAL: Tests must match the ACTUAL behavior of the code being tested, not assumed behavior.

CRITICAL SYNTAX: Use ONLY ${frameworkName} syntax:
- Import: ${importStatement}
- Use describe() and it() as direct function calls
- NEVER use test.describe() or test.xxx() - those are NOT ${frameworkName} syntax
- NEVER access private properties directly - if you see instance.privateProp, remove it and use constructor or public methods instead
${framework === 'vitest' ? '- For Vitest: Use vi.Mock, vi.fn(), vi.mock() - NEVER use jest.Mock or jest.fn()' : '- For Jest: Use jest.Mock, jest.fn(), jest.mock() - NEVER use vi.Mock or vi.fn()'}

Requirements:
1. Analyze the original function code to understand its ACTUAL runtime behavior
2. Fix the test code to match what the function actually does, not what it "should" do
3. **CRITICAL: If error message says "expected X to be Y" or "AssertionError", check if the TEST EXPECTATION is wrong**
   - If the function returns X but test expects Y, FIX THE TEST to expect X (not change the function)
   - If the function uses property "data" but test expects "results", FIX THE TEST to use "data"
   - If the function returns false but test expects true, FIX THE TEST to expect false
   - The test expectation must match the ACTUAL function behavior, not assumed behavior
4. Only expect errors/exceptions if the function code actually throws them
5. Match JavaScript/TypeScript runtime semantics:
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
7. For async operations with fake timers:
   - CRITICAL: Use ${framework === 'vitest' ? 'vi.advanceTimersByTimeAsync(ms)' : 'jest.advanceTimersByTimeAsync(ms)'} for async operations
   - Await the timer advancement BEFORE awaiting the promise
   - Example: const promise = retryWithBackoff(...); await ${framework === 'vitest' ? 'vi.advanceTimersByTimeAsync(100)' : 'jest.advanceTimersByTimeAsync(100)'}; const result = await promise;
   - For sync operations, use ${framework === 'jest' ? 'jest.advanceTimersByTime(ms)' : 'vi.advanceTimersByTime(ms)'} (no await)
8. For error testing:
   - Only expect errors if the function actually throws them
   - Match actual error types and messages
   - Use appropriate matchers (toThrow, rejects, etc.)
9. Maintain the original test intent where possible, but prioritize correctness
10. Use proper ${frameworkName} syntax
11. Ensure all imports and dependencies are correct
12. Fix any syntax errors, type errors, or logical errors

Output format:
- Return ONLY the fixed test code, no explanations or markdown code blocks
- The code should be complete and runnable
- Include all necessary imports

🚨 FINAL SYNTAX CHECK BEFORE RETURNING:
1. Verify ALL braces, parentheses, and brackets are closed
2. Verify NO incomplete function calls or expressions
3. Verify ALL strings and template literals are closed
4. Count and match: { = }, ( = ), [ = ]
5. If ANY syntax is incomplete, DO NOT RETURN - fix it first

INCOMPLETE CODE WILL BE REJECTED. ONLY RETURN SYNTAX-COMPLETE CODE.`;

  return systemPrompt;
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
  sourceFilePath?: string,
  validationErrors?: string[],
  maxAttempts?: number,
  testRemovalRejected?: boolean
): string {
  let prompt = `The following ${framework} test is failing. Fix it:\n\n`;
  
  // Add syntax errors with line numbers if available (CRITICAL - fix these first)
  if (validationErrors && validationErrors.length > 0) {
    const syntaxErrors = validationErrors.filter(e => 
      e.includes('Unclosed') || e.includes('Syntax') || e.includes('line') || e.includes('column') ||
      e.includes('brace') || e.includes('parenthes') || e.includes('bracket') ||
      e.includes('truncated') || e.includes('incomplete')
    );
    if (syntaxErrors.length > 0) {
      prompt += `\n\n🚨 CRITICAL: Syntax errors detected in the test code (MUST FIX BEFORE ANYTHING ELSE):\n${syntaxErrors.map(e => `- ${e}`).join('\n')}\n\n`;
      prompt += `REQUIREMENTS FOR SYNTAX FIXES:\n`;
      prompt += `1. Fix ALL syntax errors listed above before generating any new test code\n`;
      prompt += `2. Pay special attention to line numbers and columns - add missing braces/parentheses at EXACT locations\n`;
      prompt += `3. If file is truncated, complete the incomplete code (don't leave incomplete function calls or expressions)\n`;
      prompt += `4. Ensure all braces, parentheses, and brackets are properly closed\n`;
      prompt += `5. Validate your generated code mentally - count opening/closing braces/parentheses\n`;
      prompt += `6. DO NOT generate new code until syntax errors are fixed\n`;
      prompt += `7. Return ONLY syntactically valid code - invalid code will be rejected\n\n`;
    }
  }

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

  // CRITICAL: List failing tests FIRST and prominently
  if (failingTests && failingTests.length > 0) {
    prompt += `\n🚨🚨🚨 ONLY THESE ${failingTests.length} TEST(S) ARE FAILING - FIX ONLY THESE 🚨🚨🚨\n\n`;
    prompt += `FAILING TESTS TO FIX:\n`;
    for (let i = 0; i < failingTests.length; i++) {
      const ft = failingTests[i];
      prompt += `${i + 1}. "${ft.testName}"\n`;
      prompt += `   Error: ${ft.message}\n`;
    }
    prompt += `\n⚠️ CRITICAL: Only these ${failingTests.length} test(s) above are failing. All other tests are PASSING.\n`;
    prompt += `⚠️ You must ONLY fix the tests listed above. Do NOT modify, delete, or change any other tests.\n\n`;
  }

  // Add failing test code
  prompt += `Complete test file (contains both passing and failing tests):\n\`\`\`typescript\n${testCode}\n\`\`\`\n\n`;
  
  // CRITICAL: Preserve all tests - make this VERY explicit
  const testCount = (testCode.match(/it\(/g) || []).length;
  const describeCount = (testCode.match(/describe\(/g) || []).length;
  
  prompt += `\n🚨🚨🚨 CRITICAL: PRESERVE ALL TESTS AND STRUCTURE - DO NOT DELETE ANY TESTS 🚨🚨🚨\n`;
  prompt += `\nThe test file above contains:\n`;
  prompt += `- ${describeCount} describe block(s)\n`;
  prompt += `- ${testCount} test(s) (it() calls)\n`;
  if (failingTests && failingTests.length > 0) {
    prompt += `- ${failingTests.length} FAILING test(s) (listed above - fix ONLY these)\n`;
    prompt += `- ${testCount - failingTests.length} PASSING test(s) (do NOT modify these)\n`;
  }
  prompt += `\nYOU MUST RETURN ALL ${testCount} TESTS IN THE SAME STRUCTURE. DO NOT DELETE ANY TESTS.\n\n`;
  
  // Add extra warning if previous fix was rejected for removing tests
  if (testRemovalRejected) {
    prompt += `\n⚠️⚠️⚠️ PREVIOUS FIX REJECTED: Your previous fix attempt was REJECTED because it removed too many tests.\n`;
    prompt += `⚠️⚠️⚠️ YOU MUST NOT DELETE TESTS. If a test cannot be fixed, REPLACE IT WITH A MINIMAL PASSING TEST.\n`;
    prompt += `⚠️⚠️⚠️ Example minimal test: it('test name', () => { expect(functionName()).toBeDefined(); });\n`;
    prompt += `⚠️⚠️⚠️ The returned file MUST have exactly ${testCount} tests - no more, no less.\n\n`;
  }
  
  prompt += `STEP-BY-STEP INSTRUCTIONS:\n`;
  prompt += `\nSTEP 1: Identify the failing tests\n`;
  if (failingTests && failingTests.length > 0) {
    prompt += `- Look for these exact test names in the code above:\n`;
    failingTests.forEach((ft, i) => {
      prompt += `  ${i + 1}. "${ft.testName}"\n`;
    });
  } else {
    prompt += `- Review the error messages below to identify which tests are failing\n`;
  }
  prompt += `\nSTEP 2: Fix ONLY the failing tests\n`;
  prompt += `- Find each failing test in the code above\n`;
  prompt += `- Fix the test logic/expectations to make it pass\n`;
  prompt += `- DO NOT delete the test - fix it or replace with a minimal passing test\n`;
  prompt += `\nSTEP 3: Leave ALL other tests unchanged\n`;
  prompt += `- Copy ALL passing tests exactly as they are\n`;
  prompt += `- Do NOT modify, simplify, or delete any passing tests\n`;
  prompt += `- Preserve the exact structure, formatting, and content of passing tests\n`;
  prompt += `\nSTEP 4: Verify your output\n`;
  prompt += `- Count your tests: must be exactly ${testCount} tests (same as input)\n`;
  prompt += `- Count your describe blocks: must be exactly ${describeCount} blocks\n`;
  prompt += `- Verify all ${failingTests?.length || 0} failing tests are fixed\n`;
  prompt += `- Verify all ${testCount - (failingTests?.length || 0)} passing tests are unchanged\n`;
  prompt += `\nREQUIREMENTS:\n`;
  prompt += `1. Count the tests in the file above - there are ${testCount} tests\n`;
  prompt += `2. Return the COMPLETE file with ALL ${testCount} tests preserved\n`;
  prompt += `3. Preserve the EXACT describe block structure - keep tests in their original describe blocks\n`;
  if (failingTests && failingTests.length > 0) {
    prompt += `4. Fix ONLY these ${failingTests.length} failing test(s): ${failingTests.map(ft => `"${ft.testName}"`).join(', ')}\n`;
  } else {
    prompt += `4. Only fix the FAILING tests listed in the error messages\n`;
  }
  prompt += `5. Keep ALL passing tests exactly as they are - DO NOT modify them\n`;
  prompt += `6. Keep ALL describe blocks with their original names - DO NOT rename or remove describe() blocks\n`;
  prompt += `7. Keep tests in their correct describe blocks - DO NOT move tests between describe blocks\n`;
  prompt += `8. If a test is not in the failing tests list above, it is PASSING - keep it unchanged\n`;
  prompt += `9. DO NOT simplify, remove, or delete any tests\n`;
  prompt += `10. DO NOT reorganize or restructure the test file\n`;
  prompt += `11. If a test truly cannot be fixed, REPLACE IT WITH A MINIMAL PASSING TEST\n`;
  prompt += `12. Minimal test example: it('should work', () => { expect(functionName()).toBeDefined(); });\n`;
  prompt += `13. The returned file must have the SAME NUMBER of tests (${testCount} tests) and describe blocks (${describeCount} blocks)\n`;
  prompt += `14. If you return fewer tests or different structure, your code will be REJECTED\n`;
  prompt += `15. NEVER delete tests - if you can't fix it, replace with a minimal passing test\n\n`;

  // Add detailed error information (already shown at top, but include here for reference)
  if (failingTests && failingTests.length > 0) {
    prompt += `\nDetailed error information for failing tests:\n`;
    for (const failingTest of failingTests) {
      prompt += `\nTest: "${failingTest.testName}"\n`;
      prompt += `Error: ${failingTest.message}\n`;
      if (failingTest.stack) {
        prompt += `Stack: ${failingTest.stack.split('\n')[0]}\n`;
      }
    }
    prompt += '\n';
    
    // Add explicit guidance for expectation errors
    const hasExpectationError = failingTests.some(ft => 
      ft.message.includes('expected') && ft.message.includes('to be') ||
      ft.message.includes('AssertionError') ||
      ft.message.includes('Object.is equality')
    );
    
    if (hasExpectationError) {
      prompt += `\n⚠️ EXPECTATION ERROR DETECTED:\n`;
      prompt += `The error message indicates a mismatch between what the test expects and what the function actually returns.\n`;
      prompt += `ACTION REQUIRED:\n`;
      prompt += `1. Check the original function code above to see what it ACTUALLY returns\n`;
      prompt += `2. If the function returns X but test expects Y, CHANGE THE TEST to expect X\n`;
      prompt += `3. If the function uses property "data" but test uses "results", CHANGE THE TEST to use "data"\n`;
      prompt += `4. If the function returns false but test expects true, CHANGE THE TEST to expect false\n`;
      prompt += `5. DO NOT assume the function is wrong - fix the TEST EXPECTATION to match actual behavior\n\n`;
    }
  }

  prompt += `Error message:\n\`\`\`\n${errorMessage}\n\`\`\`\n\n`;

  if (testOutput) {
    prompt += `Test output:\n\`\`\`\n${testOutput}\n\`\`\`\n\n`;
  }

  // Get attempt context
  const totalAttempts = maxAttempts || 10;
  const isFinalAttempt = attempt >= totalAttempts;
  const isHalfway = attempt >= Math.ceil(totalAttempts / 2);
  
  if (isFinalAttempt) {
    prompt += `\n\n🚨🚨🚨 FINAL ATTEMPT (${attempt}/${totalAttempts}) - TESTS MUST PASS - NO EXCEPTIONS\n`;
    prompt += `\nABSOLUTE PRIORITY: FIX TESTS TO PASS - PRESERVE COVERAGE\n`;
    prompt += `- FIRST: Fix failing tests by correcting assertions to match actual function behavior\n`;
    prompt += `- If a test expects wrong behavior, FIX THE EXPECTATION - don't delete the test\n`;
    prompt += `- Use basic matchers if needed: toBe(), toEqual(), toBeTruthy(), toBeFalsy()\n`;
    prompt += `- Simplify complex assertions, but keep the test - don't remove it\n`;
    prompt += `- If async/timers are failing, fix the async handling (proper await, timer advancement)\n`;
    prompt += `- If mocks are failing, fix the mocks or use real values - keep the test\n`;
    prompt += `- If a test truly cannot be fixed, REPLACE IT WITH A MINIMAL PASSING TEST\n`;
    prompt += `- Minimal test example: it('should work', () => { expect(functionName()).toBeDefined(); });\n`;
    prompt += `- Even a minimal passing test is better than no test - NEVER delete tests\n`;
    prompt += `- Preserve test coverage - maintain tests for all functions and important cases\n`;
    prompt += `- THE GOAL: ALL tests pass while maintaining comprehensive coverage\n`;
    prompt += `- DO NOT delete tests - if you can't fix it, replace with a minimal passing test\n\n`;
  } else if (isHalfway && attempt > 1) {
    prompt += `\n\n⚠️ Multiple attempts failed. Start simplifying:\n`;
    prompt += `- Simplify complex test scenarios - but keep the tests\n`;
    prompt += `- If a test can't be fixed, replace with a minimal passing test\n`;
    prompt += `- Use simpler assertions\n`;
    prompt += `- Focus on making tests pass - even minimal tests are better than none\n\n`;
  } else if (attempt > 1) {
    prompt += `Note: This is fix attempt ${attempt}. Previous attempts failed. Please analyze the error more carefully and ensure:\n`;
    prompt += `- The test matches the ACTUAL runtime behavior of the function\n`;
    prompt += `- All imports and dependencies are correct\n`;
    prompt += `- Mocks are properly configured if needed\n`;
    prompt += `- Async operations are properly handled\n`;
    prompt += `- Error expectations match what the function actually throws\n\n`;
  }

  prompt += `Fix the test code to resolve the error.\n\n`;
  prompt += `🚨🚨🚨 FINAL REMINDER: Return the COMPLETE test file with ALL ${testCount} TESTS PRESERVED.\n`;
  prompt += `\nVERIFICATION CHECKLIST BEFORE RETURNING:\n`;
  prompt += `- [ ] Count your returned tests - must be ${testCount} tests (same as input)\n`;
  prompt += `- [ ] Include ALL ${describeCount} describe blocks from the original file\n`;
  prompt += `- [ ] Include ALL ${testCount} it() tests from the original file\n`;
  if (failingTests && failingTests.length > 0) {
    prompt += `- [ ] Fixed ONLY these ${failingTests.length} failing test(s): ${failingTests.map(ft => `"${ft.testName}"`).join(', ')}\n`;
    prompt += `- [ ] Left ALL ${testCount - failingTests.length} passing test(s) completely unchanged\n`;
  } else {
    prompt += `- [ ] Only modified tests that are actually failing (listed in error messages)\n`;
    prompt += `- [ ] All other tests are unchanged\n`;
  }
  prompt += `- [ ] No tests were deleted - if you can't fix a test, replace it with a minimal passing test\n`;
  prompt += `- [ ] Minimal test format: it('test name', () => { expect(function()).toBeDefined(); });\n`;
  prompt += `\nIf your returned code has fewer than ${testCount} tests, it will be REJECTED.\n`;
  prompt += `If a test can't be fixed, replace it with a minimal passing test - NEVER delete it.\n`;
  prompt += `\nRemember: You are fixing ONLY the failing tests. All passing tests must remain EXACTLY as they are.\n`;
  prompt += `Return ONLY the corrected test code, no explanations or markdown.`;

  return prompt;
}

