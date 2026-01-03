/**
 * Parse LLM output to extract test code
 */

import { warn } from '../utils/logger.js';

/**
 * Extract test code from LLM response
 * Handles markdown code blocks, plain code, and other formats
 */
export function parseTestCode(response: string): string {
  // Remove markdown code blocks if present
  let code = response.trim();

  // Check for markdown code blocks (```typescript, ```ts, ```javascript, ```js, or just ```)
  const codeBlockRegex = /^```(?:typescript|ts|javascript|js)?\s*\n([\s\S]*?)\n```$/;
  const match = code.match(codeBlockRegex);

  if (match) {
    code = match[1].trim();
  } else {
    // Check for inline code blocks
    const inlineCodeRegex = /```([\s\S]*?)```/g;
    const inlineMatches = Array.from(code.matchAll(inlineCodeRegex));
    if (inlineMatches.length > 0) {
      // Use the largest code block
      code = inlineMatches.reduce((largest, match) => {
        return match[1].length > largest.length ? match[1] : largest;
      }, '');
      code = code.trim();
    }
  }

  // Remove any leading/trailing explanation text
  // Look for common patterns like "Here's the test:", "Test code:", etc.
  const explanationPatterns = [
    /^Here'?s?\s+(?:the\s+)?(?:test\s+)?code:?\s*/i,
    /^Test\s+code:?\s*/i,
    /^Generated\s+test:?\s*/i,
    /^Here\s+is\s+the\s+test:?\s*/i,
  ];

  for (const pattern of explanationPatterns) {
    if (pattern.test(code)) {
      code = code.replace(pattern, '').trim();
      // If there's still explanation after the code, try to extract just the code
      const codeBlockMatch = code.match(/```[\s\S]*?```/);
      if (codeBlockMatch) {
        code = codeBlockMatch[0];
        code = code.replace(/^```(?:typescript|ts|javascript|js)?\s*\n?/, '').replace(/\n?```$/, '').trim();
      }
    }
  }

  // Final cleanup: remove any remaining markdown formatting
  code = code.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();

  if (!code) {
    warn('Failed to extract test code from LLM response');
    return response; // Return original if we can't parse
  }

  return code;
}

/**
 * Validate that the parsed code looks like valid test code
 */
export function validateTestCodeStructure(code: string, framework: 'jest' | 'vitest'): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check for basic test structure
  if (!code.includes('describe') && !code.includes('it(') && !code.includes('test(')) {
    errors.push('Missing test structure (describe/it/test)');
  }

  // Check for Playwright-style syntax (incorrect for Jest/Vitest)
  if (code.includes('test.describe') || code.match(/test\s*\.\s*describe/)) {
    errors.push('Invalid syntax: test.describe() is Playwright syntax, not ' + framework + '. Use describe() instead.');
  }
  
  // Check for incorrect test() usage pattern (test.xxx is Playwright, not Vitest/Jest)
  if (code.match(/test\s*\.\s*\w+\s*\(/)) {
    errors.push('Invalid syntax: test.xxx() is Playwright syntax, not ' + framework + '. Use describe() and it() instead.');
  }

  // Check for framework-specific imports
  if (framework === 'jest') {
    if (!code.includes("from 'jest'") && !code.includes('from "jest"') && !code.includes('require(')) {
      // Jest might use global functions, so this is just a warning
      if (!code.includes('describe') && !code.includes('it') && !code.includes('test')) {
        errors.push('Missing Jest test functions');
      }
    }
  } else if (framework === 'vitest') {
    // Vitest requires explicit import
    if (!code.includes("from 'vitest'") && !code.includes('from "vitest"')) {
      errors.push('Missing Vitest import: use "import { describe, it } from \'vitest\';"');
    }
    
    // Check for correct Vitest import pattern
    const hasCorrectImport = code.includes("import {") && code.includes("} from 'vitest'");
    const hasDescribeIt = code.includes('describe') || code.includes('it');
    
    // If using describe/it, must have proper import
    if (hasDescribeIt && !hasCorrectImport && !code.includes("from 'vitest'")) {
      errors.push('Vitest requires explicit import: "import { describe, it } from \'vitest\';"');
    }
    
    // Check for incorrect standalone test import (should be describe/it)
    if (code.match(/import\s*{\s*test\s*}\s*from\s*['"]vitest['"]/) && !code.includes('describe') && !code.includes('it')) {
      errors.push('Vitest scaffold should use describe() and it(), not standalone test(). Import: "import { describe, it } from \'vitest\';"');
    }
  }

  // Check for basic syntax (has some code, not just whitespace)
  if (code.trim().length < 20) {
    errors.push('Test code appears too short or empty');
  }

  // Check for common test patterns (but not Playwright-style)
  if (!code.match(/(describe|it|test)\s*\(/) && !code.match(/test\s*\.\s*describe/)) {
    errors.push('Missing test function calls (describe/it/test)');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

