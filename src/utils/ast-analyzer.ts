import * as ts from 'typescript';
import type { ChangedRange, TestTarget } from '../types/diff.js';
import { debug } from './logger.js';

interface FunctionNode {
  name: string;
  type: 'function' | 'method' | 'arrow-function' | 'class-method';
  start: number;
  end: number;
  node: ts.Node;
  className?: string; // If this is a class method, which class does it belong to?
  isPrivate?: boolean; // Is this method/property private?
}

interface ClassInfo {
  name: string;
  start: number;
  end: number;
  privateProperties: string[];
  privateMethods: string[];
  exported: boolean;
}

/**
 * Extract class information from TypeScript source code
 */
function extractClasses(sourceFile: ts.SourceFile): ClassInfo[] {
  const classes: ClassInfo[] = [];
  
  function visit(node: ts.Node) {
    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      const isExported = node.modifiers?.some(m => 
        m.kind === ts.SyntaxKind.ExportKeyword
      ) ?? false;
      
      const privateProperties: string[] = [];
      const privateMethods: string[] = [];
      
      // Extract private members
      for (const member of node.members) {
        if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
          const isPrivate = member.modifiers?.some(m => 
            m.kind === ts.SyntaxKind.PrivateKeyword
          ) ?? false;
          if (isPrivate) {
            privateProperties.push(member.name.text);
          }
        }
        if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
          const isPrivate = member.modifiers?.some(m => 
            m.kind === ts.SyntaxKind.PrivateKeyword
          ) ?? false;
          if (isPrivate) {
            privateMethods.push(member.name.text);
          }
        }
      }
      
      classes.push({
        name: className,
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        privateProperties,
        privateMethods,
        exported: isExported,
      });
    }
    
    ts.forEachChild(node, visit);
  }
  
  visit(sourceFile);
  return classes;
}

/**
 * Find which class a method belongs to
 */
function findClassForMethod(
  methodStart: number,
  classes: ClassInfo[]
): ClassInfo | undefined {
  return classes.find(c => methodStart >= c.start && methodStart <= c.end);
}

/**
 * Extract functions/methods from TypeScript source code
 */
function extractFunctions(sourceFile: ts.SourceFile, classes: ClassInfo[]): FunctionNode[] {
  const functions: FunctionNode[] = [];
  
  function visit(node: ts.Node) {
    // Function declarations (including export default)
    if (ts.isFunctionDeclaration(node)) {
      // Check if it's exported (export function foo() {} or export default function foo() {})
      const isExported = node.modifiers?.some(m => 
        m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword
      );
      
      if (node.name) {
        functions.push({
          name: node.name.text,
          type: 'function',
          start: node.getStart(sourceFile),
          end: node.getEnd(),
          node,
        });
      } else if (isExported) {
        // Anonymous export default function: export default function () {}
        functions.push({
          name: 'default',
          type: 'function',
          start: node.getStart(sourceFile),
          end: node.getEnd(),
          node,
        });
      }
    }
    
    // Export default with function expressions: export default (function foo() {})
    // Note: FunctionDeclarations with export default are handled above via modifiers
    if (ts.isExportAssignment(node) && node.isExportEquals === false && ts.isFunctionExpression(node.expression)) {
      const func = node.expression;
      const name = func.name ? func.name.text : 'default';
      functions.push({
        name,
        type: 'function',
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        node,
      });
    }
    
    // Method declarations (class methods)
    if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      const methodStart = node.getStart(sourceFile);
      const classInfo = findClassForMethod(methodStart, classes);
      const isPrivate = node.modifiers?.some(m => 
        m.kind === ts.SyntaxKind.PrivateKeyword
      ) ?? false;
      
      functions.push({
        name: node.name.text,
        type: 'class-method',
        start: methodStart,
        end: node.getEnd(),
        node,
        className: classInfo?.name,
        isPrivate,
      });
    }
    
    // Variable statements: const foo = function() {} or const foo = function bar() {}
    // Only include if exported (export const foo = ...) or if it's a class method
    if (ts.isVariableStatement(node)) {
      const isExported = node.modifiers?.some(m => 
        m.kind === ts.SyntaxKind.ExportKeyword
      );
      
      // Only extract exported variable functions, or if we're in a class context
      if (isExported) {
        for (const declaration of node.declarationList.declarations) {
          if (declaration.initializer) {
            // Arrow functions
            if (ts.isArrowFunction(declaration.initializer)) {
              if (ts.isIdentifier(declaration.name)) {
                functions.push({
                  name: declaration.name.text,
                  type: 'arrow-function',
                  start: declaration.getStart(sourceFile),
                  end: declaration.getEnd(),
                  node: declaration,
                });
              }
            }
            // Named function expressions: const foo = function bar() {}
            else if (ts.isFunctionExpression(declaration.initializer)) {
              const funcExpr = declaration.initializer;
              // Use the function name if it has one, otherwise use the variable name
              const name = funcExpr.name
                ? funcExpr.name.text
                : ts.isIdentifier(declaration.name)
                ? declaration.name.text
                : 'anonymous';
              
              if (name !== 'anonymous') {
                functions.push({
                  name,
                  type: 'function',
                  start: declaration.getStart(sourceFile),
                  end: declaration.getEnd(),
                  node: declaration,
                });
              }
            }
          }
        }
      }
    }
    
    // Object method shorthand
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      if (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer)) {
        functions.push({
          name: node.name.text,
          type: 'method',
          start: node.getStart(sourceFile),
          end: node.getEnd(),
          node,
        });
      }
    }
    
    ts.forEachChild(node, visit);
  }
  
  visit(sourceFile);
  return functions;
}

/**
 * Get line number from character position
 * 
 * Note: For performance, consider caching line start positions if called
 * repeatedly on the same source. TypeScript's SourceFile.getLineAndCharacterOfPosition
 * could be used as an alternative.
 */
function getLineNumber(source: string, position: number): number {
  return source.substring(0, position).split('\n').length;
}

/**
 * Check if a function overlaps with changed ranges
 * 
 * Note: Only uses 'addition' ranges for overlap detection. Deletion ranges
 * use OLD file line numbers and don't map to the new file, so they're
 * excluded from overlap checks (but kept in metadata).
 */
function functionOverlapsChanges(
  func: FunctionNode,
  changedRanges: ChangedRange[],
  source: string
): boolean {
  const funcStartLine = getLineNumber(source, func.start);
  const funcEndLine = getLineNumber(source, func.end);
  
  // Only check addition ranges - deletions use old file line numbers
  const additionRanges = changedRanges.filter(r => r.type === 'addition');
  
  for (const range of additionRanges) {
    // Check if changed range overlaps with function
    if (
      (range.start >= funcStartLine && range.start <= funcEndLine) ||
      (range.end >= funcStartLine && range.end <= funcEndLine) ||
      (range.start <= funcStartLine && range.end >= funcEndLine)
    ) {
      return true;
    }
  }
  
  return false;
}

/**
 * Extract code snippet for a function
 */
function extractCodeSnippet(source: string, func: FunctionNode): string {
  return source.substring(func.start, func.end);
}

/**
 * Extract minimal context around a function (previous function + next few lines)
 */
function extractContext(source: string, func: FunctionNode, allFunctions: FunctionNode[]): string {
  const funcStartLine = getLineNumber(source, func.start);
  const funcEndLine = getLineNumber(source, func.end);
  
  // Find previous function
  const previousFunc = allFunctions
    .filter(f => getLineNumber(source, f.end) < funcStartLine)
    .sort((a, b) => getLineNumber(source, b.end) - getLineNumber(source, a.end))[0];
  
  const contextStart = previousFunc
    ? getLineNumber(source, previousFunc.start)
    : Math.max(1, funcStartLine - 10);
  
  const lines = source.split('\n');
  const contextLines = lines.slice(contextStart - 1, funcEndLine + 5);
  
  return contextLines.join('\n');
}

/**
 * Detect existing test file for a source file by actually checking the repository
 */
async function detectTestFile(
  filePath: string,
  ref: string,
  githubClient: { fileExists: (ref: string, path: string) => Promise<boolean> },
  testDirectory: string
): Promise<string | undefined> {
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  const baseName = filePath.substring(filePath.lastIndexOf('/') + 1).replace(/\.(ts|tsx|js|jsx)$/, '');
  
  // Determine file extension and corresponding test patterns
  let ext: 'ts' | 'tsx' | 'js' | 'jsx';
  if (filePath.endsWith('.tsx')) ext = 'tsx';
  else if (filePath.endsWith('.jsx')) ext = 'jsx';
  else if (filePath.endsWith('.ts')) ext = 'ts';
  else ext = 'js';
  
  // Test file patterns to check (match source file type)
  const testPatterns = 
    ext === 'tsx' ? [`.test.tsx`, `.spec.tsx`, `.test.ts`, `.spec.ts`] :
    ext === 'jsx' ? [`.test.jsx`, `.spec.jsx`, `.test.js`, `.spec.js`] :
    ext === 'ts' ? [`.test.ts`, `.spec.ts`] :
    [`.test.js`, `.spec.js`];
  
  // Locations to check (in order of preference, deduplicated)
  const locations = [
    // Co-located in same directory
    ...testPatterns.map(pattern => `${dir}/${baseName}${pattern}`),
    // Co-located __tests__ directory
    ...testPatterns.map(pattern => `${dir}/__tests__/${baseName}${pattern}`),
    // Test directory at root
    ...testPatterns.map(pattern => `${testDirectory}/${baseName}${pattern}`),
    // Nested test directory matching source structure
    ...testPatterns.map(pattern => `${testDirectory}${dir}/${baseName}${pattern}`),
    // __tests__ at root
    ...testPatterns.map(pattern => `__tests__/${baseName}${pattern}`),
  ];
  
  // Check each location to see if file actually exists
  // If test file doesn't exist (404), that's fine - we'll create it
  for (const testPath of locations) {
    try {
      const exists = await githubClient.fileExists(ref, testPath);
      if (exists) {
        return testPath;
      }
    } catch (err) {
      // If fileExists throws an error (shouldn't happen for 404s, but handle gracefully)
      // Log and continue checking other locations
      debug(`Error checking test file ${testPath}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
  }
  
  // No existing test file found - we'll create a new one
  return undefined;
}

/**
 * Analyze TypeScript file and extract test targets
 * 
 * @param testAllExports - If true, test all exported functions/classes regardless of change overlap.
 *                         If false, only test functions that overlap with changed ranges.
 */
export async function analyzeFile(
  filePath: string,
  content: string,
  changedRanges: ChangedRange[],
  ref: string,
  githubClient: { fileExists: (ref: string, path: string) => Promise<boolean> },
  testDirectory: string,
  testAllExports?: boolean
): Promise<TestTarget[]> {
  // Default to false (only test changed functions) for backward compatibility
  const shouldTestAllExports = testAllExports ?? false;
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true
  );
  
  const classes = extractClasses(sourceFile);
  const functions = extractFunctions(sourceFile, classes);
  
  // Check for existing test file once per file (not per function)
  const existingTestFile = await detectTestFile(filePath, ref, githubClient, testDirectory);
  
  const targets: TestTarget[] = [];
  
  // If testAllExports is true, or if file is new (entire file is changed), test all exported functions
  const lineCount = content.split('\n').length;
  const isNewFile = changedRanges.length === 1 && 
    changedRanges[0].type === 'addition' && 
    changedRanges[0].start === 1 && 
    changedRanges[0].end >= lineCount * 0.9; // 90%+ of file is "changed"
  
  // Also test all if a large portion of the file changed (indicates major refactor)
  const largeChange = changedRanges.some(r => 
    r.type === 'addition' && (r.end - r.start) >= lineCount * 0.5
  );
  
  const shouldTestAll = shouldTestAllExports || isNewFile || largeChange;
  
  for (const func of functions) {
    // Test if: overlaps with changes OR we're testing all exports
    if (shouldTestAll || functionOverlapsChanges(func, changedRanges, content)) {
      const startLine = getLineNumber(content, func.start);
      const endLine = getLineNumber(content, func.end);
      
      const classInfo = func.className ? classes.find(c => c.name === func.className) : undefined;
      
      targets.push({
        filePath,
        functionName: func.name,
        functionType: func.type,
        startLine,
        endLine,
        code: extractCodeSnippet(content, func),
        context: extractContext(content, func, functions),
        existingTestFile,
        changedRanges: changedRanges.filter(
          r => r.start >= startLine && r.end <= endLine
        ),
        className: func.className,
        isPrivate: func.isPrivate,
        classPrivateProperties: classInfo?.privateProperties,
      });
      
      debug(`Found test target: ${func.name} (${func.type}) in ${filePath}${existingTestFile ? ` - existing test: ${existingTestFile}` : ''}`);
    }
  }
  
  return targets;
}

