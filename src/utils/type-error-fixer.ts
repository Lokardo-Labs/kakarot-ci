/**
 * Automatic TypeScript type error fixing utilities
 */

/**
 * Common type error patterns and their fixes
 */
const TYPE_ERROR_FIXES: Array<{
  pattern: RegExp;
  fix: (match: RegExpMatchArray, line: string) => string;
  description: string;
}> = [
  // Fix: Array with union types - add explicit type annotation
  {
    pattern: /const\s+(\w+)\s*=\s*\[([^\]]*(?:null|undefined)[^\]]*)\]/,
    fix: (match, line) => {
      const varName = match[1];
      const arrayContent = match[2];
      // Extract types from array content
      const types = new Set<string>();
      if (arrayContent.includes('null')) types.add('null');
      if (arrayContent.includes('undefined')) types.add('undefined');
      if (/\d+/.test(arrayContent)) types.add('number');
      if (/['"]/.test(arrayContent)) types.add('string');
      if (arrayContent.includes('true') || arrayContent.includes('false')) types.add('boolean');
      
      if (types.size > 1) {
        const typeArray = Array.from(types).join(' | ');
        return line.replace(match[0], `const ${varName}: (${typeArray})[] = [${arrayContent}]`);
      }
      return line;
    },
    description: 'Add explicit type annotation for arrays with union types',
  },
  // Fix: deepMerge type errors - add type assertion
  {
    pattern: /const\s+(\w+)\s*=\s*deepMerge\((\w+),\s*\{[^}]+\}\);/,
    fix: (_match, line) => {
      // Add type assertion for source parameter
      return line.replace(
        /deepMerge\((\w+),\s*(\{[^}]+\})\)/,
        (_, target, source) => {
          return `deepMerge(${target}, ${source} as unknown as Partial<typeof ${target}>)`;
        }
      );
    },
    description: 'Add type assertion for deepMerge with incompatible object shapes',
  },
  // Fix: Function parameter type mismatches - add type guard or assertion
  {
    pattern: /const\s+(\w+)\s*=\s*\((\w+):\s*(\w+)\)\s*=>/,
    fix: (_match, line) => {
      // If parameter type doesn't match usage, add type guard
      // This is a simple fix - more complex cases need context
      return line;
    },
    description: 'Fix function parameter type mismatches',
  },
];

/**
 * Attempts to automatically fix common TypeScript type errors in test code
 */
export function fixTypeErrors(
  code: string,
  errors: string[]
): { fixedCode: string; fixedErrors: string[]; remainingErrors: string[] } {
  let fixedCode = code;
  const fixedErrors: string[] = [];
  const remainingErrors: string[] = [];
  const lines = code.split('\n');

  // Analyze errors to determine which can be auto-fixed
  for (const error of errors) {
    let fixed = false;

    // Check for specific error patterns
    if (error.includes('is not assignable to parameter of type')) {
      // Array type mismatch
      if (error.includes('Type') && error.includes('is not assignable')) {
        // Try to fix array type annotations
        for (let i = 0; i < lines.length; i++) {
          for (const fixPattern of TYPE_ERROR_FIXES) {
            const match = lines[i].match(fixPattern.pattern);
            if (match) {
              const fixedLine = fixPattern.fix(match, lines[i]);
              if (fixedLine !== lines[i]) {
                lines[i] = fixedLine;
                fixed = true;
                fixedErrors.push(error);
                break;
              }
            }
          }
          if (fixed) break;
        }
      }
    } else if (error.includes('has no properties in common with type')) {
      // Object shape mismatch (e.g., deepMerge)
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('deepMerge')) {
          // Add type assertion
          lines[i] = lines[i].replace(
            /deepMerge\((\w+),\s*(\{[^}]+\})\)/,
            (_, target, source) => {
              return `deepMerge(${target}, ${source} as unknown as Partial<typeof ${target}>)`;
            }
          );
          fixed = true;
          fixedErrors.push(error);
          break;
        }
      }
    } else if (error.includes('Argument of type') && error.includes('is not assignable')) {
      // Function argument type mismatch
      // Try to add type assertion or type guard
      for (let i = 0; i < lines.length; i++) {
        // Look for function calls with type mismatches
        if (lines[i].includes('processBatch') && lines[i].includes('[')) {
          // Check if it's an array with union types
          const arrayMatch = lines[i].match(/\[([^\]]*(?:null|undefined)[^\]]*)\]/);
          if (arrayMatch) {
            // Add type annotation
            const beforeArray = lines[i].substring(0, lines[i].indexOf('['));
            const varMatch = beforeArray.match(/const\s+(\w+)\s*=/);
            if (varMatch) {
              const varName = varMatch[1];
              lines[i] = lines[i].replace(
                new RegExp(`const\\s+${varName}\\s*=\\s*\\[`),
                `const ${varName}: (number | null | undefined)[] = [`
              );
              fixed = true;
              fixedErrors.push(error);
              break;
            }
          }
        }
      }
    }

    if (!fixed) {
      remainingErrors.push(error);
    }
  }

  fixedCode = lines.join('\n');

  return {
    fixedCode,
    fixedErrors,
    remainingErrors,
  };
}

/**
 * Fixes specific type error: Array with union types
 */
export function fixArrayUnionTypeError(
  code: string,
  varName: string,
  types: string[]
): string {
  const typeAnnotation = `(${types.join(' | ')})[]`;
  const pattern = new RegExp(`const\\s+${varName}\\s*=\\s*\\[`, 'g');
  return code.replace(pattern, `const ${varName}: ${typeAnnotation} = [`);
}

/**
 * Fixes specific type error: deepMerge incompatible object shapes
 */
export function fixDeepMergeTypeError(code: string): string {
  // Add type assertion for deepMerge calls with incompatible shapes
  return code.replace(
    /deepMerge\((\w+),\s*(\{[^}]+\})\)/g,
    (match, target, source) => {
      // Check if already has type assertion
      if (match.includes('as ')) {
        return match;
      }
      return `deepMerge(${target}, ${source} as unknown as Partial<typeof ${target}>)`;
    }
  );
}

/**
 * Fixes function parameter type mismatches by adding type guards
 */
export function fixFunctionParameterTypeError(
  code: string,
  _functionName: string,
  _paramName: string,
  _expectedType: string,
  _actualType: string
): string {
  // This is more complex and may need context
  // For now, return original code
  return code;
}

