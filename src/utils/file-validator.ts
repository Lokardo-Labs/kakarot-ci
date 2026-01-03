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
}

/**
 * Check if code is syntactically complete (balanced braces, complete statements)
 */
export function checkSyntaxCompleteness(code: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Check for balanced braces
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let stringChar = '';
  let inComment = false;
  let commentType: 'line' | 'block' | null = null;
  
  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    const nextChar = code[i + 1];
    
    // Handle strings
    if (!inComment && (char === '"' || char === "'" || char === '`')) {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar && code[i - 1] !== '\\') {
        inString = false;
        stringChar = '';
      }
      continue;
    }
    
    if (inString) continue;
    
    // Handle comments
    if (char === '/' && nextChar === '/') {
      inComment = true;
      commentType = 'line';
      i++; // Skip next char
      continue;
    }
    if (char === '/' && nextChar === '*') {
      inComment = true;
      commentType = 'block';
      i++; // Skip next char
      continue;
    }
    if (inComment && commentType === 'line' && char === '\n') {
      inComment = false;
      commentType = null;
      continue;
    }
    if (inComment && commentType === 'block' && char === '*' && nextChar === '/') {
      inComment = false;
      commentType = null;
      i++; // Skip next char
      continue;
    }
    
    if (inComment) continue;
    
    // Count braces
    if (char === '{') braceDepth++;
    if (char === '}') braceDepth--;
    if (char === '(') parenDepth++;
    if (char === ')') parenDepth--;
    if (char === '[') bracketDepth++;
    if (char === ']') bracketDepth--;
  }
  
  if (braceDepth > 0) {
    errors.push(`Unclosed braces: ${braceDepth} opening brace(s) without closing`);
  }
  if (braceDepth < 0) {
    errors.push(`Extra closing braces: ${Math.abs(braceDepth)} closing brace(s) without opening`);
  }
  if (parenDepth > 0) {
    errors.push(`Unclosed parentheses: ${parenDepth} opening paren(s) without closing`);
  }
  if (parenDepth < 0) {
    errors.push(`Extra closing parentheses: ${Math.abs(parenDepth)} closing paren(s) without opening`);
  }
  if (bracketDepth > 0) {
    errors.push(`Unclosed brackets: ${bracketDepth} opening bracket(s) without closing`);
  }
  if (bracketDepth < 0) {
    errors.push(`Extra closing brackets: ${Math.abs(bracketDepth)} closing bracket(s) without opening`);
  }
  
  // Check for incomplete statements at end
  const trimmed = code.trim();
  if (trimmed.length > 0) {
    const lines = trimmed.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    // Get last meaningful line (skip closing braces/brackets)
    let lastMeaningfulLine = '';
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      // Skip lines that are just closing braces/brackets
      if (!line.match(/^[})\]]+[;,]?\s*$/)) {
        lastMeaningfulLine = line;
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
        errors.push('File ends with incomplete expression (operator without operand)');
      }
    
      // Check for incomplete function calls (has opening paren but no closing)
      const openParens = (lastMeaningfulLine.match(/\(/g) || []).length;
      const closeParens = (lastMeaningfulLine.match(/\)/g) || []).length;
      if (openParens > closeParens) {
        errors.push('File ends with incomplete function call');
      }
      
      // Check for incomplete property access (ends with dot)
      if (lastMeaningfulLine.endsWith('.')) {
        errors.push('File ends with incomplete property access');
      }
      
      // Check for incomplete assignments (ends with identifier after =)
      // This catches cases like "const result = deep" where "deep" is incomplete
      if (lastMeaningfulLine.includes('=') && !lastMeaningfulLine.endsWith(';') && !lastMeaningfulLine.endsWith(',')) {
        const afterEquals = lastMeaningfulLine.split('=').pop()?.trim() || '';
        // If after = is just a word (not a function call, not a number, not a string)
        if (afterEquals.match(/^\w+\s*$/) && !afterEquals.match(/^(true|false|null|undefined)$/)) {
          errors.push('File ends with incomplete expression');
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
async function validateTypeScript(
  filePath: string,
  projectRoot: string
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  try {
    // Check if TypeScript is available
    const {  stderr } = await execAsync(
      `npx tsc --noEmit --skipLibCheck "${filePath}"`,
      {
        cwd: projectRoot,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      }
    );
    
    if (stderr && stderr.trim().length > 0) {
      // TypeScript errors are in stderr
      const errorLines = stderr.split('\n').filter(line => 
        line.includes('error TS') || line.includes('error:')
      );
      
      if (errorLines.length > 0) {
        // Extract key errors (limit to first 5 to avoid overwhelming)
        const keyErrors = errorLines.slice(0, 5).map(line => {
          // Extract error message (after error code)
          const match = line.match(/error (TS\d+|:)\s*(.+)/);
          return match ? match[2].trim() : line.trim();
        });
        
        errors.push(...keyErrors);
        if (errorLines.length > 5) {
          errors.push(`... and ${errorLines.length - 5} more error(s)`);
        }
      }
    }
  } catch (err: unknown) {
    // TypeScript compiler returns non-zero on errors, which throws
    if (err && typeof err === 'object' && 'stderr' in err) {
      const stderr = (err as { stderr: string }).stderr;
      if (stderr) {
        const errorLines = stderr.split('\n').filter(line => 
          line.includes('error TS') || line.includes('error:')
        );
        
        if (errorLines.length > 0) {
          const keyErrors = errorLines.slice(0, 5).map(line => {
            const match = line.match(/error (TS\d+|:)\s*(.+)/);
            return match ? match[2].trim() : line.trim();
          });
          
          errors.push(...keyErrors);
          if (errorLines.length > 5) {
            errors.push(`... and ${errorLines.length - 5} more error(s)`);
          }
        }
      }
    } else {
      // If TypeScript isn't available or other error, just warn
      warn(`Could not run TypeScript validation: ${err instanceof Error ? err.message : String(err)}`);
      return { valid: true, errors: [] }; // Don't fail if TypeScript isn't available
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
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
  try {
    const fs = await import('fs/promises');
    await fs.writeFile(join(projectRoot, tempPath), content, 'utf-8');
    
    const tsCheck = await validateTypeScript(tempPath, projectRoot);
    if (!tsCheck.valid) {
      errors.push(...tsCheck.errors.map(e => `Type error: ${e}`));
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
  };
}

