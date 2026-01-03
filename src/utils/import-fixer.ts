/**
 * Automatically fix missing imports in test files
 */

import { 
  createSourceFile, 
  ScriptTarget, 
  SyntaxKind,
  type ImportDeclaration,
  type NamedImports,
  type ImportSpecifier,
} from 'typescript';
import { consolidateImports } from './import-consolidator.js';

/**
 * Detect which test framework is being used based on imports
 */
function detectTestFramework(content: string): 'vitest' | 'jest' | undefined {
  if (content.includes("from 'vitest'") || content.includes('from "vitest"')) {
    return 'vitest';
  }
  if (content.includes("from 'jest'") || content.includes('from "jest"')) {
    return 'jest';
  }
  return undefined;
}

/**
 * Add missing imports to the test file
 */
export function addMissingImports(
  content: string,
  missingImports: string[],
  framework?: 'vitest' | 'jest'
): string {
  if (missingImports.length === 0) {
    return content;
  }

  // Detect framework if not provided
  const detectedFramework = framework || detectTestFramework(content);
  if (!detectedFramework) {
    // Can't determine framework, return original
    return content;
  }

  const frameworkModule = detectedFramework === 'vitest' ? 'vitest' : '@jest/globals';
  
  // Find existing import from test framework
  const importRegex = new RegExp(`import\\s+.*?from\\s+['"]${frameworkModule}['"];?`, 'g');
  const existingImports = content.match(importRegex) || [];
  
  // Parse existing imports to get current imports
  const existingNamedImports = new Set<string>();
  for (const importStmt of existingImports) {
    try {
      const sourceFile = createSourceFile('test.ts', importStmt, ScriptTarget.Latest, true);
      sourceFile.forEachChild((node) => {
        if (node.kind === SyntaxKind.ImportDeclaration) {
          const importDecl = node as ImportDeclaration;
          const clause = importDecl.importClause;
          
          if (clause?.namedBindings && clause.namedBindings.kind === SyntaxKind.NamedImports) {
            const namedImports = clause.namedBindings as NamedImports;
            namedImports.elements.forEach((element: ImportSpecifier) => {
              const importedName = element.propertyName?.text || element.name?.text;
              if (importedName) {
                existingNamedImports.add(importedName);
              }
            });
          }
        }
      });
    } catch {
      // If parsing fails, try regex fallback
      const namedMatch = importStmt.match(/\{\s*([^}]+)\s*\}/);
      if (namedMatch) {
        const names = namedMatch[1].split(',').map(n => n.trim());
        names.forEach(name => existingNamedImports.add(name));
      }
    }
  }

  // Add missing imports to the set
  missingImports.forEach(imp => existingNamedImports.add(imp));

  // Build new import statement
  const sortedImports = Array.from(existingNamedImports).sort();
  const newImportStmt = `import { ${sortedImports.join(', ')} } from '${frameworkModule}';`;

  if (existingImports.length > 0) {
    // Replace first existing import with consolidated one, remove others
    let replaced = false;
    let result = content.replace(importRegex, () => {
      if (!replaced) {
        replaced = true;
        return newImportStmt;
      }
      return ''; // Remove duplicate imports
    });
    // Clean up extra blank lines
    result = result.replace(/\n\n\n+/g, '\n\n');
    return result;
  } else {
    // No existing import, add at the top
    const lines = content.split('\n');
    let insertIndex = 0;
    
    // Find first non-comment, non-empty line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.startsWith('//') && !line.startsWith('/*')) {
        insertIndex = i;
        break;
      }
    }
    
    lines.splice(insertIndex, 0, newImportStmt);
    return lines.join('\n');
  }
}

/**
 * Fix missing imports in test file content
 */
export function fixMissingImports(
  content: string,
  missingImports: string[],
  framework?: 'vitest' | 'jest'
): string {
  if (missingImports.length === 0) {
    return content;
  }

  // Add missing imports
  let fixed = addMissingImports(content, missingImports, framework);
  
  // Consolidate imports to ensure no duplicates
  try {
    const importRegex = /^import\s+.*?from\s+['"].*?['"];?$/gm;
    const imports = fixed.match(importRegex) || [];
    if (imports.length > 0) {
      const consolidated = consolidateImports(imports);
      const nonImportCode = fixed.replace(importRegex, '').trim();
      fixed = consolidated.join('\n') + '\n\n' + nonImportCode;
    }
  } catch {
    // If consolidation fails, return fixed content without consolidation
  }

  return fixed;
}

