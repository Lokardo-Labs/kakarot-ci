/**
 * Consolidate imports from the same module
 */

import { 
  createSourceFile, 
  ScriptTarget, 
  SyntaxKind,
  type ImportDeclaration,
  type NamedImports,
  type ImportSpecifier,
  type NamespaceImport,
  type StringLiteral
} from 'typescript';

export interface ConsolidatedImport {
  source: string;
  defaultImport?: string;
  namedImports: Set<string>;
  namespaceImport?: string;
}

/**
 * Parse an import statement and extract its components
 */
function parseImport(importText: string): ConsolidatedImport | null {
  try {
    const sourceFile = createSourceFile('import.ts', importText, ScriptTarget.Latest, true);
    let result: ConsolidatedImport | null = null;

    sourceFile.forEachChild((node) => {
      if (node.kind === SyntaxKind.ImportDeclaration) {
        const importDecl = node as ImportDeclaration;
        const moduleSpecifier = importDecl.moduleSpecifier;
        
        if (moduleSpecifier && moduleSpecifier.kind === SyntaxKind.StringLiteral) {
          const source = (moduleSpecifier as StringLiteral).text;
          const clause = importDecl.importClause;
          
          result = {
            source,
            namedImports: new Set<string>(),
          };
          
          if (clause) {
            // Default import
            if (clause.name) {
              result.defaultImport = clause.name.text;
            }
            
            // Named or namespace imports
            if (clause.namedBindings) {
              if (clause.namedBindings.kind === SyntaxKind.NamedImports) {
                const namedImports = clause.namedBindings as NamedImports;
                namedImports.elements.forEach((element: ImportSpecifier) => {
                  const importedName = element.propertyName?.text || element.name?.text;
                  if (importedName) {
                    result!.namedImports.add(importedName);
                  }
                });
              } else if (clause.namedBindings.kind === SyntaxKind.NamespaceImport) {
                const namespaceImport = clause.namedBindings as NamespaceImport;
                result.namespaceImport = namespaceImport.name.text;
              }
            }
          }
        }
      }
    });

    return result;
  } catch {
    return null;
  }
}

/**
 * Format a consolidated import back to a string
 */
function formatImport(importData: ConsolidatedImport): string {
  const parts: string[] = [];
  
  // Default import
  if (importData.defaultImport) {
    parts.push(importData.defaultImport);
  }
  
  // Named imports
  if (importData.namedImports.size > 0) {
    const sortedNames = Array.from(importData.namedImports).sort();
    parts.push(`{ ${sortedNames.join(', ')} }`);
  }
  
  // Namespace import
  if (importData.namespaceImport) {
    parts.push(`* as ${importData.namespaceImport}`);
  }
  
  if (parts.length === 0) {
    return `import '${importData.source}';`;
  }
  
  return `import ${parts.join(', ')} from '${importData.source}';`;
}

/**
 * Consolidate multiple import statements, merging imports from the same module
 */
export function consolidateImports(importStatements: string[]): string[] {
  const importsBySource = new Map<string, ConsolidatedImport>();
  
  for (const importText of importStatements) {
    const parsed = parseImport(importText.trim());
    if (!parsed) {
      // If we can't parse it, keep it as-is
      continue;
    }
    
    const existing = importsBySource.get(parsed.source);
    if (existing) {
      // Merge with existing import from same source
      if (parsed.defaultImport && !existing.defaultImport) {
        existing.defaultImport = parsed.defaultImport;
      }
      if (parsed.namespaceImport && !existing.namespaceImport) {
        existing.namespaceImport = parsed.namespaceImport;
      }
      // Merge named imports
      parsed.namedImports.forEach(name => existing.namedImports.add(name));
    } else {
      // New import from this source
      importsBySource.set(parsed.source, parsed);
    }
  }
  
  // Convert back to import statements and sort
  const consolidated = Array.from(importsBySource.values())
    .map(formatImport)
    .sort();
  
  return consolidated;
}

