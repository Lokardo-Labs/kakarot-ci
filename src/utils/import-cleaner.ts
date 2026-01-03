/**
 * Remove unused imports from generated test code
 */

import { 
  createSourceFile, 
  ScriptTarget, 
  SyntaxKind, 
  type SourceFile,
  type ImportDeclaration,
  type NamedImports,
  type ImportSpecifier,
  type NamespaceImport,
  type Identifier,
  type Node as TSNode
} from 'typescript';
import { warn } from './logger.js';

/**
 * Remove unused imports from code
 */
export function removeUnusedImports(code: string): string {
  try {
    const sourceFile = createSourceFile(
      'test.ts',
      code,
      ScriptTarget.Latest,
      true
    );

    const lines = code.split('\n');
    const importsToRemove: number[] = [];

    // Check each import declaration
    sourceFile.forEachChild((node) => {
      if (node.kind === SyntaxKind.ImportDeclaration) {
        const importDecl = node as ImportDeclaration;
        let hasUsedImports = false;

        // Check default import
        if (importDecl.importClause?.name) {
          const defaultName = importDecl.importClause.name.text;
          if (isIdentifierUsed(sourceFile, defaultName, importDecl)) {
            hasUsedImports = true;
          }
        }

        // Check named imports
        if (importDecl.importClause?.namedBindings) {
          const bindings = importDecl.importClause.namedBindings;
          if (bindings.kind === SyntaxKind.NamedImports) {
            const namedImports = bindings as NamedImports;
            namedImports.elements.forEach((element: ImportSpecifier) => {
              const localName = element.name?.text;
              const importedName = element.propertyName?.text || localName;
              const nameToCheck = localName || importedName;
              
              if (nameToCheck && isIdentifierUsed(sourceFile, nameToCheck, importDecl)) {
                hasUsedImports = true;
              }
            });
          } else if (bindings.kind === SyntaxKind.NamespaceImport) {
            const namespaceImport = bindings as NamespaceImport;
            const namespaceName = namespaceImport.name.text;
            if (isIdentifierUsed(sourceFile, namespaceName, importDecl)) {
              hasUsedImports = true;
            }
          }
        }

        // If no imports are used, mark for removal
        if (!hasUsedImports) {
          const startLine = sourceFile.getLineAndCharacterOfPosition(importDecl.getStart()).line;
          const endLine = sourceFile.getLineAndCharacterOfPosition(importDecl.getEnd()).line;
          // Mark all lines in this import for removal
          for (let line = startLine; line <= endLine; line++) {
            importsToRemove.push(line);
          }
        }
      }
    });

    // Remove unused import lines (from bottom to top to preserve indices)
    const uniqueLines = [...new Set(importsToRemove)].sort((a, b) => b - a);
    for (const lineNum of uniqueLines) {
      lines.splice(lineNum, 1);
    }

    return lines.join('\n');
  } catch (err) {
    // If parsing fails, return original code
    warn(`Failed to remove unused imports: ${err instanceof Error ? err.message : String(err)}`);
    return code;
  }
}

/**
 * Check if an identifier is used in the source file (excluding the import declaration itself)
 */
function isIdentifierUsed(
  sourceFile: SourceFile,
  identifierName: string,
  excludeNode?: TSNode
): boolean {
  let found = false;

  function visit(node: TSNode): void {
    if (found) return;

    // Skip the node we're excluding (usually the import declaration)
    if (excludeNode && node === excludeNode) {
      return;
    }

    // Check if this is the identifier we're looking for
    if (node.kind === SyntaxKind.Identifier) {
      const identifier = node as Identifier;
      if (identifier.text === identifierName) {
        // Make sure it's not part of the import declaration
        if (!excludeNode || !isDescendantOf(identifier, excludeNode)) {
          found = true;
          return;
        }
      }
    }

    // Recursively visit children
    if (node.getChildCount && node.getChildCount() > 0) {
      node.getChildren().forEach(visit);
    }
  }

  sourceFile.forEachChild(visit);
  return found;
}

/**
 * Check if a node is a descendant of another node
 */
function isDescendantOf(node: TSNode, ancestor: TSNode): boolean {
  let current: TSNode | undefined = node.parent;
  while (current) {
    if (current === ancestor) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

