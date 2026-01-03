/**
 * Main test generator that orchestrates LLM calls and parsing
 */

import type { KakarotConfig } from '../types/config.js';
import type { TestGenerationContext, TestGenerationResult, TestFixContext } from '../types/llm.js';
import { createLLMProvider } from './factory.js';
import { buildTestGenerationPrompt } from './prompts/test-generation.js';
import { buildTestScaffoldPrompt } from './prompts/test-scaffold.js';
import { buildTestFixPrompt } from './prompts/test-fix.js';
import { parseTestCode, validateTestCodeStructure, validateTestCodeForPrivateAccess } from './parser.js';
import { optimizeFixContext } from '../utils/context-optimizer.js';
import { info, warn, error, debug } from '../utils/logger.js';

export class TestGenerator {
  private provider: ReturnType<typeof createLLMProvider>;
  private config: Pick<KakarotConfig, 'maxFixAttempts' | 'temperature' | 'fixTemperature' | 'customPrompts' | 'model'>;
  private modelContextLimit: number;

  constructor(
    config: Pick<
      KakarotConfig,
      'apiKey' | 'provider' | 'model' | 'maxTokens' | 'maxFixAttempts' | 'temperature' | 'fixTemperature' | 'customPrompts' | 'maxRetries'
    >
  ) {
    this.provider = createLLMProvider(config);
    this.config = {
      maxFixAttempts: config.maxFixAttempts,
      temperature: config.temperature,
      fixTemperature: config.fixTemperature,
      customPrompts: config.customPrompts,
      model: config.model,
    };
    // Get model context limit (default to 8K for gpt-4, 128K for newer models)
    this.modelContextLimit = this.getModelContextLimit(config.model);
  }

  /**
   * Get context limit for a model (in tokens)
   */
  private getModelContextLimit(model?: string): number {
    if (!model) return 8000; // Default to 8K
    
    // Common model context limits
    if (model.includes('gpt-4-turbo') || model.includes('gpt-4o') || model.includes('gpt-4-1106')) {
      return 128000;
    }
    if (model.includes('gpt-4-32k')) {
      return 32768;
    }
    if (model.includes('gpt-4')) {
      return 8192; // Standard gpt-4
    }
    if (model.includes('gpt-3.5-turbo-16k')) {
      return 16384;
    }
    if (model.includes('gpt-3.5')) {
      return 4096;
    }
    if (model.includes('claude-3-opus') || model.includes('claude-3-sonnet') || model.includes('claude-3-5')) {
      return 200000;
    }
    if (model.includes('claude-3-haiku')) {
      return 200000;
    }
    if (model.includes('claude-2')) {
      return 100000;
    }
    if (model.includes('gemini-pro') || model.includes('gemini-1.5')) {
      return 1000000; // Gemini has very large context
    }
    
    return 8000; // Default fallback
  }

  /**
   * Generate test code for a test target
   */
  async generateTest(context: TestGenerationContext): Promise<TestGenerationResult> {
    const { target, framework } = context;

    info(`Generating ${framework} tests for ${target.functionName} in ${target.filePath}`);

    try {
      const messages = buildTestGenerationPrompt(context);
      debug(`Sending test generation request to LLM for ${target.functionName}`);

      const response = await this.provider.generate(messages, {
        temperature: this.config.temperature ?? 0.2, // Lower temperature for more consistent test generation
        maxTokens: 4000,
      });

      const testCode = parseTestCode(response.content);
      const validation = validateTestCodeStructure(testCode, framework);

      if (!validation.valid) {
        warn(`Test code validation warnings for ${target.functionName}: ${validation.errors.join(', ')}`);
        // Continue anyway, as some issues might be false positives
      }

      // Additional validation for private property access - fail generation if detected
      if (target.classPrivateProperties && target.classPrivateProperties.length > 0) {
        const privateValidation = validateTestCodeForPrivateAccess(testCode, target.classPrivateProperties);
        if (!privateValidation.valid) {
          const errorMessage = `Private property access detected for ${target.functionName}: ${privateValidation.errors.join('; ')}. Tests must not access private properties directly.`;
          error(errorMessage);
          throw new Error(errorMessage);
        }
      }

      debug(`Successfully generated test code for ${target.functionName}`);

      return {
        testCode,
        explanation: response.content !== testCode ? 'Code extracted from LLM response' : undefined,
        usage: response.usage,
      };
    } catch (err) {
      error(`Failed to generate test for ${target.functionName}: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  /**
   * Fix a failing test by generating a corrected version
   */
  async fixTest(context: TestFixContext): Promise<TestGenerationResult> {
    const { framework, attempt } = context;

    info(`Fixing test (attempt ${attempt}/${this.config.maxFixAttempts})`);

    try {
      // Optimize context to fit within model limits
      // Reserve space for system prompt (~500 tokens) and completion (4000 tokens)
      const availableTokens = this.modelContextLimit - 4000 - 500;
      const optimized = optimizeFixContext(
        {
          originalCode: context.originalCode,
          testCode: context.testCode,
          errorMessage: context.errorMessage,
          testOutput: context.testOutput,
          failingTests: context.failingTests,
          functionNames: context.functionNames,
        },
        availableTokens
      );

      // Build prompt with optimized context
      const optimizedContext: TestFixContext = {
        ...context,
        ...optimized,
      };
      
      const messages = buildTestFixPrompt(optimizedContext);
      debug(`Sending test fix request to LLM (attempt ${attempt}, model limit: ${this.modelContextLimit} tokens)`);

      const response = await this.provider.generate(messages, {
        temperature: this.config.fixTemperature ?? 0.1, // Very low temperature for fix attempts
        maxTokens: 4000,
      });

      const fixedCode = parseTestCode(response.content);
      const validation = validateTestCodeStructure(fixedCode, framework);

      if (!validation.valid) {
        warn(`Fixed test code validation warnings: ${validation.errors.join(', ')}`);
      }

      debug(`Successfully generated fixed test code (attempt ${attempt})`);

      return {
        testCode: fixedCode,
        explanation: `Fixed test code (attempt ${attempt})`,
        usage: response.usage,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      
      // Check if it's a context length error
      if (errorMessage.includes('context_length_exceeded') || errorMessage.includes('maximum context length')) {
        error(`Cannot fix test: Context too large even after optimization`);
        error(`  Model '${this.config.model || 'unknown'}' has ${this.modelContextLimit} token limit`);
        error(`  Suggestion: Use a model with larger context window (e.g., gpt-4-turbo, gpt-4o, claude-3-opus)`);
        throw new Error(`Context length exceeded: Model limit is ${this.modelContextLimit} tokens. Use a model with larger context window.`);
      }
      
      error(`Failed to fix test (attempt ${attempt}): ${errorMessage}`);
      throw err;
    }
  }

  /**
   * Generate test scaffold (minimal structure) for a test target
   */
  async generateTestScaffold(
    target: TestGenerationContext['target'],
    existingTestFile?: string,
    framework: 'jest' | 'vitest' = 'jest',
    testFilePath?: string,
    importPath?: string
  ): Promise<TestGenerationResult> {
    info(`Generating ${framework} test scaffold for ${target.functionName} in ${target.filePath}`);

    try {
      const messages = await buildTestScaffoldPrompt(
        target, 
        framework, 
        existingTestFile,
        {
          customSystemPrompt: this.config.customPrompts?.testScaffoldSystem || this.config.customPrompts?.testScaffold,
          customUserPrompt: this.config.customPrompts?.testScaffoldUser || this.config.customPrompts?.testScaffold,
        },
        testFilePath,
        importPath
      );
      debug(`Sending test scaffold request to LLM for ${target.functionName}`);

      const response = await this.provider.generate(messages, {
        temperature: 0.1,
        maxTokens: 2000,
      });

      const testCode = parseTestCode(response.content);
      const validation = validateTestCodeStructure(testCode, framework);

      if (!validation.valid) {
        const errorMessage = `Test scaffold validation failed for ${target.functionName}: ${validation.errors.join('; ')}`;
        error(errorMessage);
        throw new Error(errorMessage);
      }

      debug(`Successfully generated test scaffold for ${target.functionName}`);

      return {
        testCode,
        explanation: 'Test scaffold generated',
        usage: response.usage,
      };
    } catch (err) {
      error(`Failed to generate test scaffold for ${target.functionName}: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  /**
   * Generate a human-readable coverage summary
   */
  async generateCoverageSummary(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): Promise<string> {
    try {
      const response = await this.provider.generate(messages, {
        temperature: 0.3,
        maxTokens: 500,
      });
      return response.content;
    } catch (err) {
      error(`Failed to generate coverage summary: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
}

