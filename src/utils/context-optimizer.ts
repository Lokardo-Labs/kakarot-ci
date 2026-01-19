/**
 * Context optimizer for LLM requests
 * Truncates and optimizes content to fit within token limits
 */

/**
 * Extract key error message from full error output
 */
export function extractKeyErrorMessage(errorMessage: string, maxLength: number = 500): string {
  // Remove stack traces and keep only the core error message
  const lines = errorMessage.split('\n');
  const keyLines: string[] = [];
  
  for (const line of lines) {
    // Skip stack trace lines (usually contain file paths, line numbers, or "at" patterns)
    if (line.includes('at ') && (line.includes('.ts:') || line.includes('.js:'))) {
      continue;
    }
    // Skip internal framework stack traces
    if (line.trim().startsWith('at ') || line.includes('node_modules')) {
      continue;
    }
    
    keyLines.push(line);
    
    // Stop if we've collected enough
    if (keyLines.join('\n').length >= maxLength) {
      break;
    }
  }
  
  let result = keyLines.join('\n').trim();
  
  // If still too long, truncate
  if (result.length > maxLength) {
    result = result.substring(0, maxLength - 50) + '\n... (truncated)';
  }
  
  return result || errorMessage.substring(0, maxLength);
}

/**
 * Extract relevant code sections from a file
 * Only includes the functions/classes that are actually being tested
 */
export function extractRelevantCode(
  fullCode: string,
  functionNames: string[],
  maxLength: number = 2000
): string {
  if (fullCode.length <= maxLength) {
    return fullCode;
  }
  
  // If we have function names, try to extract just those functions
  if (functionNames.length > 0) {
    const extracted: string[] = [];
    
    for (const funcName of functionNames) {
      // Try to find the function definition
      // Escape special regex characters in function name
      const escapedFuncName = funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const funcRegex = new RegExp(
        `(export\\s+)?(async\\s+)?(function\\s+${escapedFuncName}|const\\s+${escapedFuncName}\\s*=|${escapedFuncName}\\s*[:=]\\s*(async\\s+)?function|class\\s+${escapedFuncName})[\\s\\S]*?(?=\\n(export\\s+)?(async\\s+)?(function|const|class|interface|type|\\}|$))`,
        'm'
      );
      
      const match = fullCode.match(funcRegex);
      if (match) {
        extracted.push(match[0]);
      }
    }
    
    if (extracted.length > 0) {
      const result = extracted.join('\n\n');
      if (result.length <= maxLength) {
        return result;
      }
    }
  }
  
  // Fallback: truncate from the beginning, keeping the end (usually more important)
  if (fullCode.length > maxLength) {
    const truncated = fullCode.substring(fullCode.length - maxLength + 100);
    return '// ... (code truncated, showing end of file)\n' + truncated;
  }
  
  return fullCode;
}

/**
 * Extract only failing test cases from full test file
 */
export function extractFailingTests(
  fullTestCode: string,
  failingTestNames: string[],
  maxLength: number = 2000
): string {
  if (fullTestCode.length <= maxLength) {
    return fullTestCode;
  }
  
  // Try to extract only the failing test cases
  if (failingTestNames.length > 0) {
    const extracted: string[] = [];
    const lines = fullTestCode.split('\n');
    let inRelevantTest = false;
    let currentTest: string[] = [];
    let depth = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check if this line starts a relevant test
      const isRelevantTest = failingTestNames.some(name => 
        line.includes(`it('${name}`) || 
        line.includes(`it("${name}`) ||
        line.includes(`test('${name}`) ||
        line.includes(`test("${name}`)
      );
      
      if (isRelevantTest) {
        inRelevantTest = true;
        currentTest = [line];
        depth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        continue;
      }
      
      if (inRelevantTest) {
        currentTest.push(line);
        depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        
        // If we've closed all braces, we've finished this test
        if (depth <= 0 && line.trim().endsWith(')') || line.trim().endsWith(');')) {
          extracted.push(currentTest.join('\n'));
          currentTest = [];
          inRelevantTest = false;
          depth = 0;
        }
      }
    }
    
    if (extracted.length > 0) {
      // Include imports and describe block if possible
      const imports = fullTestCode.match(/^import[\s\S]*?from[\s\S]*?;?\n/gm) || [];
      const describeBlock = fullTestCode.match(/describe\([\s\S]*?\{/)?.[0] || '';
      
      const result = [
        ...imports,
        describeBlock,
        ...extracted,
      ].join('\n');
      
      if (result.length <= maxLength) {
        return result;
      }
    }
  }
  
  // Fallback: truncate
  if (fullTestCode.length > maxLength) {
    return fullTestCode.substring(0, maxLength - 100) + '\n// ... (truncated)';
  }
  
  return fullTestCode;
}

/**
 * Optimize test fix context to fit within token limits
 */
export interface OptimizedFixContext {
  originalCode: string;
  testCode: string;
  errorMessage: string;
  testOutput?: string;
  failingTests?: Array<{ testName: string; message: string; stack?: string }>;
}

export function optimizeFixContext(
  context: {
    originalCode: string;
    testCode: string;
    errorMessage: string;
    testOutput?: string;
    failingTests?: Array<{ testName: string; message: string; stack?: string }>;
    functionNames?: string[];
  },
  maxTokens: number = 4000
): OptimizedFixContext {
  // Rough estimate: 1 token ≈ 4 characters
  const maxChars = maxTokens * 4;
  
  // Allocate space for different parts
  const errorMaxChars = 500; // Error messages
  const codeMaxChars = Math.floor((maxChars - errorMaxChars - 500) / 2); // Split between original and test code
  
  // CRITICAL: For the fix loop, we MUST send the COMPLETE test file
  // The model needs to see ALL tests to return ALL tests
  // Only truncate the original source code, never the test file
  const optimized: OptimizedFixContext = {
    originalCode: extractRelevantCode(
      context.originalCode,
      context.functionNames || [],
      codeMaxChars
    ),
    // ALWAYS send the complete test file - the model needs to return the complete file
    // If we only send failing tests, the model will only return failing tests
    testCode: context.testCode,
    errorMessage: extractKeyErrorMessage(context.errorMessage, errorMaxChars),
  };
  
  // Optimize test output if present (usually duplicate of errorMessage)
  if (context.testOutput && context.testOutput !== context.errorMessage) {
    optimized.testOutput = extractKeyErrorMessage(context.testOutput, 300);
  }
  
  // Optimize failing tests (extract key messages only)
  if (context.failingTests && context.failingTests.length > 0) {
    optimized.failingTests = context.failingTests.map(f => ({
      testName: f.testName,
      message: extractKeyErrorMessage(f.message, 200),
      // Don't include stack traces - they're too long
      stack: undefined,
    }));
  }
  
  return optimized;
}

