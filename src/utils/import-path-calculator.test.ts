import { describe, it, expect } from 'vitest';
import { calculateImportPath, getBaseName } from './import-path-calculator.js';

describe('import-path-calculator', () => {
  describe('calculateImportPath', () => {
    it('should calculate relative path from test directory to source file', () => {
      const testPath = '__tests__/utils.test.ts';
      const sourcePath = 'src/utils/dataProcessor.ts';
      
      const result = calculateImportPath(testPath, sourcePath);
      
      expect(result).toBe('../src/utils/dataProcessor');
    });

    it('should handle co-located test files', () => {
      const testPath = 'src/utils/dataProcessor.test.ts';
      const sourcePath = 'src/utils/dataProcessor.ts';
      
      const result = calculateImportPath(testPath, sourcePath);
      
      expect(result).toBe('./dataProcessor');
    });

    it('should handle nested test directories', () => {
      const testPath = '__tests__/utils/dataProcessor.test.ts';
      const sourcePath = 'src/utils/dataProcessor.ts';
      
      const result = calculateImportPath(testPath, sourcePath);
      
      expect(result).toBe('../../src/utils/dataProcessor');
    });

    it('should handle same directory with different names', () => {
      const testPath = '__tests__/helper.test.ts';
      const sourcePath = 'src/utils/helper.ts';
      
      const result = calculateImportPath(testPath, sourcePath);
      
      expect(result).toBe('../src/utils/helper');
    });

    it('should ensure path starts with ./ or ../', () => {
      const testPath = '__tests__/test.ts';
      const sourcePath = 'src/file.ts';
      
      const result = calculateImportPath(testPath, sourcePath);
      
      expect(result).toMatch(/^\.\.?\//);
    });

    it('should remove file extensions', () => {
      const testPath = '__tests__/test.ts';
      const sourcePath = 'src/file.ts';
      
      const result = calculateImportPath(testPath, sourcePath);
      
      expect(result).not.toMatch(/\.ts$/);
      expect(result).not.toMatch(/\.js$/);
    });

    it('should handle TypeScript and JavaScript extensions', () => {
      expect(calculateImportPath('__tests__/test.ts', 'src/file.ts')).not.toMatch(/\.ts$/);
      expect(calculateImportPath('__tests__/test.js', 'src/file.js')).not.toMatch(/\.js$/);
      expect(calculateImportPath('__tests__/test.ts', 'src/file.tsx')).not.toMatch(/\.tsx$/);
    });
  });

  describe('getBaseName', () => {
    it('should extract base name without extension', () => {
      expect(getBaseName('src/utils/dataProcessor.ts')).toBe('dataProcessor');
      expect(getBaseName('src/utils/helper.js')).toBe('helper');
      expect(getBaseName('src/components/Button.tsx')).toBe('Button');
    });

    it('should handle files without extensions', () => {
      expect(getBaseName('src/utils/file')).toBe('file');
    });

    it('should handle paths with no directory', () => {
      expect(getBaseName('file.ts')).toBe('file');
    });
  });
});

