/**
 * Merge new test code with existing test files intelligently
 */

import { 
  createSourceFile, 
  ScriptTarget, 
  SyntaxKind,
  type Identifier,
  type ExpressionStatement,
  type CallExpression,
  type StringLiteral
} from 'typescript';
import { warn } from './logger.js';

export interface MergedTestFile {
  content: string;
  imports: Set<string>;
  describeBlocks: Map<string, string>; // Map of describe block names to their content
}

/**
 * Parse an existing test file to extract structure
 */
export function parseTestFile(content: string): MergedTestFile {
  try {
    const sourceFile = createSourceFile('test.ts', content, ScriptTarget.Latest, true);
    const imports = new Set<string>();
    const describeBlocks = new Map<string, string>();

    sourceFile.forEachChild((node) => {
      // Extract imports
      if (node.kind === SyntaxKind.ImportDeclaration) {
        const importText = node.getFullText(sourceFile).trim();
        imports.add(importText);
      }

      // Extract describe blocks
      if (node.kind === SyntaxKind.ExpressionStatement) {
        const exprStmt = node as ExpressionStatement;
        const expr = exprStmt.expression;
        if (expr && expr.kind === SyntaxKind.CallExpression) {
          const callExpr = expr as CallExpression;
          if (callExpr.expression && callExpr.expression.kind === SyntaxKind.Identifier) {
            const identifier = callExpr.expression as Identifier;
            if (identifier.text === 'describe') {
              // Get the first argument (describe block name)
              const firstArg = callExpr.arguments[0];
              if (firstArg && firstArg.kind === SyntaxKind.StringLiteral) {
                const stringLit = firstArg as StringLiteral;
                const describeName = stringLit.text;
                const describeContent = node.getFullText(sourceFile).trim();
                describeBlocks.set(describeName, describeContent);
              }
            }
          }
        }
      }
    });

    return { content, imports, describeBlocks };
  } catch (err) {
    warn(`Failed to parse test file: ${err instanceof Error ? err.message : String(err)}`);
    // Return empty structure if parsing fails
    return { content, imports: new Set(), describeBlocks: new Map() };
  }
}

/**
 * Extract imports from new test code
 */
export function extractImports(newCode: string): string[] {
  try {
    const sourceFile = createSourceFile('new-test.ts', newCode, ScriptTarget.Latest, true);
    const imports: string[] = [];

    sourceFile.forEachChild((node) => {
      if (node.kind === SyntaxKind.ImportDeclaration) {
        const importText = node.getFullText(sourceFile).trim();
        if (importText) {
          imports.push(importText);
        }
      }
    });

    return imports;
  } catch {
    return [];
  }
}

/**
 * Extract describe blocks from new test code
 */
export function extractDescribeBlocks(newCode: string): Map<string, string> {
  try {
    const sourceFile = createSourceFile('new-test.ts', newCode, ScriptTarget.Latest, true);
    const describeBlocks = new Map<string, string>();

    sourceFile.forEachChild((node) => {
      if (node.kind === SyntaxKind.ExpressionStatement) {
        const exprStmt = node as ExpressionStatement;
        const expr = exprStmt.expression;
        if (expr && expr.kind === SyntaxKind.CallExpression) {
          const callExpr = expr as CallExpression;
          if (callExpr.expression && callExpr.expression.kind === SyntaxKind.Identifier) {
            const identifier = callExpr.expression as Identifier;
            if (identifier.text === 'describe') {
              const firstArg = callExpr.arguments[0];
              if (firstArg && firstArg.kind === SyntaxKind.StringLiteral) {
                const stringLit = firstArg as StringLiteral;
                const describeName = stringLit.text;
                const describeContent = node.getFullText(sourceFile).trim();
                describeBlocks.set(describeName, describeContent);
              }
            }
          }
        }
      }
    });

    return describeBlocks;
  } catch {
    return new Map();
  }
}

/**
 * Extract non-import, non-describe code (setup, helpers, etc.)
 */
export function extractOtherCode(newCode: string): string {
  try {
    const sourceFile = createSourceFile('new-test.ts', newCode, ScriptTarget.Latest, true);
    const otherCode: string[] = [];

    sourceFile.forEachChild((node) => {
      const isImport = node.kind === SyntaxKind.ImportDeclaration;
      const isDescribe = node.kind === SyntaxKind.ExpressionStatement && 
        (node as ExpressionStatement).expression?.kind === SyntaxKind.CallExpression &&
        (node as ExpressionStatement).expression &&
        (node as ExpressionStatement).expression.kind === SyntaxKind.CallExpression &&
        ((node as ExpressionStatement).expression as CallExpression).expression?.kind === SyntaxKind.Identifier &&
        (((node as ExpressionStatement).expression as CallExpression).expression as Identifier).text === 'describe';

      if (!isImport && !isDescribe) {
        const code = node.getFullText(sourceFile).trim();
        if (code) {
          otherCode.push(code);
        }
      }
    });

    return otherCode.join('\n\n');
  } catch {
    return '';
  }
}

/**
 * Merge new test code with existing test file
 */
export function mergeTestFiles(
  existingContent: string,
  newCode: string
): string {
  if (!existingContent.trim()) {
    return newCode;
  }

  const existing = parseTestFile(existingContent);
  const newImports = extractImports(newCode);
  const newDescribeBlocks = extractDescribeBlocks(newCode);
  const otherCode = extractOtherCode(newCode);

  // Merge imports - consolidate imports from the same source
  // Use a simpler approach: collect all imports, then let import-cleaner handle consolidation
  // For now, just deduplicate exact matches
  const allImportsSet = new Set<string>();
  existing.imports.forEach(imp => allImportsSet.add(imp.trim()));
  newImports.forEach(imp => allImportsSet.add(imp.trim()));
  
  // Convert to array for sorting
  const allImports = Array.from(allImportsSet);

  // Merge describe blocks
  const mergedDescribeBlocks = new Map<string, string>();
  
  // Add existing describe blocks
  existing.describeBlocks.forEach((content, name) => {
    mergedDescribeBlocks.set(name, content);
  });
  
  // Add or merge new describe blocks
  newDescribeBlocks.forEach((newContent, name) => {
    if (mergedDescribeBlocks.has(name)) {
      // Merge into existing describe block
      const existingContent = mergedDescribeBlocks.get(name)!;
      // Extract the body of the new describe block (everything after the opening)
      const newBody = extractDescribeBody(newContent);
      if (newBody) {
        // Insert new tests into existing describe block
        const merged = mergeDescribeBlock(existingContent, newBody);
        mergedDescribeBlocks.set(name, merged);
      }
    } else {
      // New describe block
      mergedDescribeBlocks.set(name, newContent);
    }
  });

  // Build merged file
  const lines: string[] = [];

  // Add imports at the top
  const sortedImports = Array.from(allImports).sort();
  sortedImports.forEach(imp => lines.push(imp));
  
  if (sortedImports.length > 0) {
    lines.push(''); // Blank line after imports
  }

  // Add other code (setup, helpers, etc.)
  if (otherCode) {
    lines.push(otherCode);
    lines.push(''); // Blank line
  }

  // Add describe blocks
  const sortedDescribeBlocks = Array.from(mergedDescribeBlocks.entries()).sort((a, b) => 
    a[0].localeCompare(b[0])
  );
  
  sortedDescribeBlocks.forEach(([, content]) => {
    lines.push(content);
    lines.push(''); // Blank line between describe blocks
  });

  return lines.join('\n').trim() + '\n';
}

/**
 * Extract the body of a describe block (everything inside)
 */
function extractDescribeBody(describeCode: string): string | null {
  try {
    const sourceFile = createSourceFile('test.ts', describeCode, ScriptTarget.Latest, true);
    let body: string | null = null;

    sourceFile.forEachChild((node) => {
      if (node.kind === SyntaxKind.ExpressionStatement) {
        const exprStmt = node as ExpressionStatement;
        const expr = exprStmt.expression;
        if (expr && expr.kind === SyntaxKind.CallExpression) {
          const callExpr = expr as CallExpression;
          if (callExpr.expression && callExpr.expression.kind === SyntaxKind.Identifier) {
            const identifier = callExpr.expression as Identifier;
            if (identifier.text === 'describe') {
              // Get the callback (second argument)
              const callback = callExpr.arguments[1];
              if (callback) {
                // Extract the body of the callback
                const callbackText = callback.getFullText(sourceFile);
                // Remove the outer arrow function or function wrapper
                if (callbackText.includes('=>')) {
                  const match = callbackText.match(/=>\s*\{([\s\S]*)\}/);
                  if (match) {
                    body = match[1].trim();
                  }
                } else if (callbackText.includes('function')) {
                  const match = callbackText.match(/function[^{]*\{([\s\S]*)\}/);
                  if (match) {
                    body = match[1].trim();
                  }
                }
              }
            }
          }
        }
      }
    });

    return body;
  } catch {
    return null;
  }
}

/**
 * Merge new test body into existing describe block
 */
function mergeDescribeBlock(existingDescribe: string, newBody: string): string {
  // Simple approach: append new body to existing describe block
  // Find the closing brace of the existing describe block
  const lastBraceIndex = existingDescribe.lastIndexOf('});');
  if (lastBraceIndex > 0) {
    // Insert new body before the closing
    const before = existingDescribe.substring(0, lastBraceIndex);
    const after = existingDescribe.substring(lastBraceIndex);
    return `${before}\n\n${newBody}\n${after}`;
  }
  
  // Fallback: just append
  return `${existingDescribe}\n\n${newBody}`;
}

/**
 * Check if a function/class already has tests in the file
 */
export function hasExistingTests(content: string, functionName: string, className?: string): boolean {
  const searchName = className || functionName;
  // Simple check: look for describe blocks with the name
  const describeRegex = new RegExp(`describe\\s*\\(\\s*['"]${searchName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'i');
  return describeRegex.test(content);
}

