/**
 * Types for LLM integration
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface LLMProvider {
  /**
   * Generate a response from the LLM
   */
  generate(messages: LLMMessage[], options?: LLMGenerateOptions): Promise<LLMResponse>;
}

export interface LLMGenerateOptions {
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

export interface TestGenerationContext {
  target: {
    filePath: string;
    functionName: string;
    functionType: 'function' | 'method' | 'arrow-function' | 'class-method';
    code: string;
    context: string;
    className?: string;
    isPrivate?: boolean;
    classPrivateProperties?: string[];
  };
  framework: 'jest' | 'vitest';
  existingTestFile?: string;
  testFilePath?: string;
  importPath?: string;
  relatedFunctions?: Array<{
    name: string;
    code: string;
  }>;
}

export interface TestGenerationResult {
  testCode: string;
  explanation?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface TestFixContext {
  testCode: string;
  errorMessage: string;
  testOutput?: string;
  originalCode: string;
  framework: 'jest' | 'vitest';
  attempt: number;
  maxAttempts: number;
  // Enhanced context
  testFilePath?: string;
  functionNames?: string[];
  failingTests?: Array<{
    testName: string;
    message: string;
    stack?: string;
  }>;
  sourceFilePath?: string;
}

