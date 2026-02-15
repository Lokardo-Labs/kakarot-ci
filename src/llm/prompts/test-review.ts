/**
 * Post-generation review prompt — catches strict-runtime issues that pass
 * Jest but crash under Stryker, strict Node.js, or fail TypeScript in
 * stricter compilation contexts.
 *
 * This is a lightweight LLM pass run after initial generation (and after
 * fix-loop iterations) to catch patterns the generator LLM missed.
 */

import type { LLMMessage } from '../../types/llm.js';

export interface TestReviewContext {
  /** Generated test code to review */
  testCode: string;
  /** Original source code being tested */
  sourceCode: string;
  /** Path to the source file (for context) */
  sourceFilePath: string;
  /** Test framework in use */
  framework: 'jest' | 'vitest';
}

const SYSTEM_PROMPT = `You are a strict test-code reviewer. Your ONLY job is to find and fix patterns in generated test code that will pass a standard test runner (Jest/Vitest) but CRASH or FAIL under stricter environments like mutation testing frameworks (StrykerJS) or Node.js with --unhandled-rejections=throw.

You receive:
1. The generated test file
2. The source code being tested

Return the CORRECTED test file. If no issues are found, return the test code UNCHANGED — do NOT add comments, reorganize, or "improve" anything.

RULES:
- Return ONLY the complete test file code — no markdown fences, no explanations, no commentary
- Do NOT add or remove tests
- Do NOT change test logic, assertions, or coverage
- Do NOT rename variables, reformat code, or reorganize imports
- ONLY fix the specific strict-runtime patterns listed below

PATTERNS TO FIX:

1. UNHANDLED PROMISE REJECTIONS (CRITICAL)
   Problem: A promise is created, timers are advanced, then \`await expect(promise).rejects.toThrow(...)\` is called.
   Between creation and the rejects assertion, the promise rejects and becomes "unhandled" — this crashes Stryker's child process.
   
   Bad:
     const promise = bus.waitFor('event', 1000);
     await jest.advanceTimersByTimeAsync(1000);
     await expect(promise).rejects.toThrow('timed out');
   
   Fix:
     const promise = bus.waitFor('event', 1000).catch((e: unknown) => e);
     jest.advanceTimersByTime(1000);
     const error = await promise;
     expect(error).toBeInstanceOf(Error);
     expect((error as Error).message).toContain('timed out');
   
   Key changes:
   - Immediately attach .catch() to capture the rejection
   - Use synchronous advanceTimersByTime (not async variant) since the catch prevents floating rejection
   - Await the caught value and assert on it directly

2. ASYNC MOCK RETURN TYPE MISMATCH
   Problem: jest.fn(async () => { return 'value'; }) returns Promise<string>, but the function signature expects () => void | Promise<void>.
   TypeScript strict mode rejects this, and Stryker runs the TS checker.
   
   Bad:
     const handler = jest.fn(async () => { return 'result'; });
     const handler = jest.fn(async () => 'result');
   
   Fix:
     const handler = jest.fn(async () => {});
   
   Only fix when the mock is used where a void-returning handler is expected.

3. FLOATING PROMISES WITHOUT ASSERTION
   Problem: A promise-returning call is made but never awaited and never asserted on.
   In strict mode this triggers unhandled-rejection if the promise rejects.
   
   Bad:
     bus.waitFor('event', 100);
     jest.advanceTimersByTime(100);
     expect(bus.listenerCount('event')).toBe(0);
   
   Fix:
     const promise = bus.waitFor('event', 100).catch(() => {});
     jest.advanceTimersByTime(100);
     await promise;
     expect(bus.listenerCount('event')).toBe(0);

4. MISSING AWAIT ON ASYNC CLEANUP
   Problem: Async operations in afterEach/beforeEach without await.
   Can cause test pollution and intermittent failures under parallel mutation runs.

If NONE of these patterns appear in the test code, return it EXACTLY as received.`;

export function buildTestReviewPrompt(context: TestReviewContext): LLMMessage[] {
  const { testCode, sourceCode, sourceFilePath, framework } = context;

  const userPrompt = `Review this ${framework} test file for strict-runtime issues.

Source file (${sourceFilePath}):
\`\`\`typescript
${sourceCode}
\`\`\`

Generated test code to review:
\`\`\`typescript
${testCode}
\`\`\`

Return the corrected test file. If no strict-runtime issues are found, return the test code exactly as-is.`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
}
