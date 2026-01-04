/**
 * Validate generated test files for completeness and correctness
 */

import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { warn } from './logger.js';

const execAsync = promisify(exec);

export interface FileValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  missingImports?: string[]; // Missing imports detected from type checking
}

/**
 * Check if code is syntactically complete (balanced braces, complete statements)
 */
export function checkSyntaxCompleteness(code: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Track line numbers for better error reporting
  let currentLine = 1;
  let currentColumn = 0;
  
  // Track positions of unclosed braces/parentheses for line number reporting
  const unclosedBraces: Array<{ line: number; column: number }> = [];
  const unclosedParens: Array<{ line: number; column: number }> = [];
  const unclosedBrackets: Array<{ line: number; column: number }> = [];
  
  // Check for balanced braces
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let stringChar = '';
  let inComment = false;
  let commentType: 'line' | 'block' | null = null;
  
  for (let i = 0; i < code.length; i++) {
    const currentChar = code[i];
    const nextChar = code[i + 1];
    
    // Track line numbers
    if (currentChar === '\n') {
      currentLine++;
      currentColumn = 0;
    } else {
      currentColumn++;
    }
    
    // Handle strings
    if (!inComment && (currentChar === '"' || currentChar === "'" || currentChar === '`')) {
      if (!inString) {
        inString = true;
        stringChar = currentChar;
      } else if (currentChar === stringChar && code[i - 1] !== '\\') {
        inString = false;
        stringChar = '';
      }
      continue;
    }
    
    if (inString) continue;
    
    // Handle comments
    if (currentChar === '/' && nextChar === '/') {
      inComment = true;
      commentType = 'line';
      i++; // Skip next char
      continue;
    }
    if (currentChar === '/' && nextChar === '*') {
      inComment = true;
      commentType = 'block';
      i++; // Skip next char
      continue;
    }
    if (inComment && commentType === 'line' && currentChar === '\n') {
      inComment = false;
      commentType = null;
      continue;
    }
    if (inComment && commentType === 'block' && currentChar === '*' && nextChar === '/') {
      inComment = false;
      commentType = null;
      i++; // Skip next char
      continue;
    }
    
    if (inComment) continue;
    
    // Count braces and track positions
    if (currentChar === '{') {
      braceDepth++;
      unclosedBraces.push({ line: currentLine, column: currentColumn });
    }
    if (currentChar === '}') {
      braceDepth--;
      if (unclosedBraces.length > 0) {
        unclosedBraces.pop();
      }
    }
    if (currentChar === '(') {
      parenDepth++;
      unclosedParens.push({ line: currentLine, column: currentColumn });
    }
    if (currentChar === ')') {
      parenDepth--;
      if (unclosedParens.length > 0) {
        unclosedParens.pop();
      }
    }
    if (currentChar === '[') {
      bracketDepth++;
      unclosedBrackets.push({ line: currentLine, column: currentColumn });
    }
    if (currentChar === ']') {
      bracketDepth--;
      if (unclosedBrackets.length > 0) {
        unclosedBrackets.pop();
      }
    }
  }
  
  if (braceDepth > 0) {
    const locations = unclosedBraces.slice(-braceDepth).map(loc => `line ${loc.line}, column ${loc.column}`).join(', ');
    errors.push(`Unclosed braces: ${braceDepth} opening brace(s) without closing (at ${locations})`);
  }
  if (braceDepth < 0) {
    errors.push(`Extra closing braces: ${Math.abs(braceDepth)} closing brace(s) without opening`);
  }
  if (parenDepth > 0) {
    const locations = unclosedParens.slice(-parenDepth).map(loc => `line ${loc.line}, column ${loc.column}`).join(', ');
    errors.push(`Unclosed parentheses: ${parenDepth} opening paren(s) without closing (at ${locations})`);
  }
  if (parenDepth < 0) {
    errors.push(`Extra closing parentheses: ${Math.abs(parenDepth)} closing paren(s) without opening`);
  }
  if (bracketDepth > 0) {
    const locations = unclosedBrackets.slice(-bracketDepth).map(loc => `line ${loc.line}, column ${loc.column}`).join(', ');
    errors.push(`Unclosed brackets: ${bracketDepth} opening bracket(s) without closing (at ${locations})`);
  }
  if (bracketDepth < 0) {
    errors.push(`Extra closing brackets: ${Math.abs(bracketDepth)} closing bracket(s) without opening`);
  }
  
  // Check for incomplete statements at end (file truncation)
  const trimmed = code.trim();
  if (trimmed.length > 0) {
    const lines = trimmed.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    // Get last meaningful line (skip closing braces/brackets)
    let lastMeaningfulLine = '';
    let lastLineNumber = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      // Skip lines that are just closing braces/brackets
      if (!line.match(/^[})\]]+[;,]?\s*$/)) {
        lastMeaningfulLine = line;
        lastLineNumber = i + 1; // 1-indexed
        break;
      }
    }
    
    if (lastMeaningfulLine) {
      // Check for incomplete expressions (ends with operator, dot, etc.)
      if (lastMeaningfulLine.match(/[+\-*/=<>!&|]\s*$/) && 
          !lastMeaningfulLine.endsWith(';') && 
          !lastMeaningfulLine.endsWith(',') &&
          !lastMeaningfulLine.endsWith('++') &&
          !lastMeaningfulLine.endsWith('--')) {
        errors.push(`File appears truncated at line ${lastLineNumber}: "${lastMeaningfulLine.substring(0, 50)}..." - expression ends with operator but no operand`);
      }
    
      // Check for incomplete function calls (has opening paren but no closing)
      const openParens = (lastMeaningfulLine.match(/\(/g) || []).length;
      const closeParens = (lastMeaningfulLine.match(/\)/g) || []).length;
      if (openParens > closeParens) {
        errors.push(`File appears truncated at line ${lastLineNumber}: "${lastMeaningfulLine.substring(0, 50)}..." - function call is incomplete (missing closing parenthesis)`);
      }
      
      // Check for incomplete property access (ends with dot)
      if (lastMeaningfulLine.endsWith('.')) {
        errors.push(`File appears truncated at line ${lastLineNumber}: "${lastMeaningfulLine.substring(0, 50)}..." - property access is incomplete (ends with dot)`);
      }
      
      // Check for incomplete assignments (ends with identifier after =)
      // This catches cases like "const result = deep" where "deep" is incomplete
      if (lastMeaningfulLine.includes('=') && !lastMeaningfulLine.endsWith(';') && !lastMeaningfulLine.endsWith(',')) {
        const afterEquals = lastMeaningfulLine.split('=').pop()?.trim() || '';
        // If after = is just a word (not a function call, not a number, not a string)
        if (afterEquals.match(/^\w+\s*$/) && !afterEquals.match(/^(true|false|null|undefined)$/)) {
          errors.push(`File appears truncated at line ${lastLineNumber}: "${lastMeaningfulLine.substring(0, 50)}..." - assignment expression is incomplete`);
        }
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate file using TypeScript compiler (if available)
 */
export async function validateTypeScript(
  filePath: string,
  projectRoot: string
): Promise<{ valid: boolean; errors: string[]; missingImports?: string[] }> {
  const errors: string[] = [];
  const missingImports: string[] = [];
  
  try {
    // Use project's tsconfig.json if available, otherwise use default settings
    const { existsSync } = await import('fs');
    const { join } = await import('path');
    const tsconfigPath = join(projectRoot, 'tsconfig.json');
    const hasTsConfig = existsSync(tsconfigPath);
    
    // Build command - use project config if available
    const command = hasTsConfig
      ? `npx tsc --noEmit --project "${tsconfigPath}" "${filePath}"`
      : `npx tsc --noEmit --skipLibCheck --esModuleInterop "${filePath}"`;
    
    try {
      const { stderr } = await execAsync(command, {
        cwd: projectRoot,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
      
      if (stderr && stderr.trim().length > 0) {
        // TypeScript errors are in stderr
        const errorLines = stderr.split('\n').filter(line => 
          line.includes('error TS') || line.includes('error:')
        );
        
        if (errorLines.length > 0) {
          // Extract key errors and detect missing imports
          const keyErrors = errorLines.slice(0, 10).map(line => {
            // Extract error message (after error code)
            const match = line.match(/error (TS\d+|:)\s*(.+)/);
            return match ? match[2].trim() : line.trim();
          });
          
          // Detect missing imports from "Cannot find name" errors
          for (const errorLine of errorLines) {
            // Match: "error TS2304: Cannot find name 'beforeEach'."
            const missingNameMatch = errorLine.match(/Cannot find name ['"]([^'"]+)['"]/);
            if (missingNameMatch) {
              const missingName = missingNameMatch[1];
              // Check if it's a common test framework function that should be imported
              const testFrameworkFunctions = ['describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'vi', 'jest'];
              if (testFrameworkFunctions.includes(missingName)) {
                missingImports.push(missingName);
              }
            }
          }
          
          errors.push(...keyErrors);
          if (errorLines.length > 10) {
            errors.push(`... and ${errorLines.length - 10} more error(s)`);
          }
        }
      }
    } catch (execErr: unknown) {
      // TypeScript compiler returns non-zero on errors, which throws
      if (execErr && typeof execErr === 'object' && 'stderr' in execErr) {
        const stderr = (execErr as { stderr: string }).stderr;
        if (stderr) {
          const errorLines = stderr.split('\n').filter(line => 
            line.includes('error TS') || line.includes('error:')
          );
          
          if (errorLines.length > 0) {
            const keyErrors = errorLines.slice(0, 10).map(line => {
              const match = line.match(/error (TS\d+|:)\s*(.+)/);
              return match ? match[2].trim() : line.trim();
            });
            
            // Detect missing imports
            for (const errorLine of errorLines) {
              const missingNameMatch = errorLine.match(/Cannot find name ['"]([^'"]+)['"]/);
              if (missingNameMatch) {
                const missingName = missingNameMatch[1];
                const testFrameworkFunctions = ['describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'vi', 'jest'];
                if (testFrameworkFunctions.includes(missingName)) {
                  missingImports.push(missingName);
                }
              }
            }
            
            errors.push(...keyErrors);
            if (errorLines.length > 10) {
              errors.push(`... and ${errorLines.length - 10} more error(s)`);
            }
          }
        }
      } else {
        // If TypeScript isn't available or other error, check if we can still validate
        // Only allow validation to pass if we're certain TypeScript isn't installed
        // Otherwise, treat as validation failure to be safe
        const errorMsg = execErr instanceof Error ? execErr.message : String(execErr);
        if (errorMsg.includes('command not found') || errorMsg.includes('ENOENT')) {
          // TypeScript compiler not found - this is acceptable, just warn
          warn(`TypeScript compiler not found. Skipping type validation. Install TypeScript to enable type checking.`);
          return { valid: true, errors: [], missingImports: [] };
        } else {
          // Other error - could be a real validation issue, fail validation
          warn(`TypeScript validation failed: ${errorMsg}`);
          return { valid: false, errors: [`TypeScript validation error: ${errorMsg}`], missingImports: [] };
        }
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    // Only allow validation to pass if TypeScript isn't installed
    if (errorMsg.includes('command not found') || errorMsg.includes('ENOENT')) {
      warn(`TypeScript compiler not found. Skipping type validation.`);
      return { valid: true, errors: [], missingImports: [] };
    } else {
      warn(`Could not run TypeScript validation: ${errorMsg}`);
      return { valid: false, errors: [`TypeScript validation error: ${errorMsg}`], missingImports: [] };
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    missingImports: missingImports.length > 0 ? [...new Set(missingImports)] : undefined,
  };
}

/**
 * Validate a generated test file for completeness and correctness
 */
export async function validateTestFile(
  filePath: string,
  content: string,
  projectRoot: string,
  privateProperties?: string[]
): Promise<FileValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // 1. Check syntax completeness
  const syntaxCheck = checkSyntaxCompleteness(content);
  if (!syntaxCheck.valid) {
    errors.push(...syntaxCheck.errors.map(e => `Syntax: ${e}`));
  }
  
  // 2. Check for private property access
  if (privateProperties && privateProperties.length > 0) {
    for (const prop of privateProperties) {
      // Match patterns like: instance.cache, dataProcessor.maxCacheSize, this.cache
      const privateAccessPattern = new RegExp(
        `(?:\\w+\\.|this\\.)${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[=;]`,
        'g'
      );
      
      if (privateAccessPattern.test(content)) {
        errors.push(`Private property access: Attempting to access private property '${prop}' directly`);
      }
    }
  }
  
  // 2.5. Check for framework syntax mismatches (detect framework from file path or content)
  // This is a simple check - if we see jest.* in a vitest file or vice versa, flag it
  const hasJestSyntax = /jest\.(Mock|fn|mock|spyOn)/.test(content);
  const hasVitestSyntax = /vi\.(Mock|fn|mock|spyOn)/.test(content);
  const isVitestFile = filePath.includes('vitest') || content.includes("from 'vitest'") || content.includes('from "vitest"');
  const isJestFile = filePath.includes('jest') || content.includes("from 'jest'") || content.includes('from "jest"');
  
  if (isVitestFile && hasJestSyntax) {
    errors.push(`Framework syntax error: Found Jest syntax (jest.Mock, jest.fn, etc.) in Vitest test file. Use vi.Mock, vi.fn() instead.`);
  }
  if (isJestFile && hasVitestSyntax) {
    errors.push(`Framework syntax error: Found Vitest syntax (vi.Mock, vi.fn, etc.) in Jest test file. Use jest.Mock, jest.fn() instead.`);
  }
  
  // 3. TypeScript validation (if available)
  // Write to temp file first for validation
  const tempPath = filePath + '.tmp';
  let missingImports: string[] | undefined = undefined;
  try {
    const fs = await import('fs/promises');
    await fs.writeFile(join(projectRoot, tempPath), content, 'utf-8');
    
    const tsCheck = await validateTypeScript(tempPath, projectRoot);
    if (!tsCheck.valid) {
      errors.push(...tsCheck.errors.map(e => `Type error: ${e}`));
      if (tsCheck.missingImports && tsCheck.missingImports.length > 0) {
        missingImports = tsCheck.missingImports;
        // Add specific error about missing imports
        errors.push(`Missing imports: ${missingImports.join(', ')}. These should be imported from the test framework.`);
      }
    }
    
    // Clean up temp file
    try {
      await fs.unlink(join(projectRoot, tempPath));
    } catch {
      // Ignore cleanup errors
    }
  } catch (err) {
    warn(`Could not validate file with TypeScript: ${err instanceof Error ? err.message : String(err)}`);
    // Don't fail validation if we can't write temp file
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    missingImports, // Include missing imports in result for automatic fixing
  };
}

