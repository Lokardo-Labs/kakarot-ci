/**
 * Main test generator that orchestrates LLM calls and parsing
 */

import type { KakarotConfig } from '../types/config.js';
import type { TestGenerationContext, TestGenerationResult, TestFixContext } from '../types/llm.js';
import { createLLMProvider } from './factory.js';
import { buildTestGenerationPrompt } from './prompts/test-generation.js';
import { buildTestScaffoldPrompt } from './prompts/test-scaffold.js';
import { buildTestFixPrompt } from './prompts/test-fix.js';
import { parseTestCode, validateTestCodeStructure } from './parser.js';
import { info, warn, error, debug } from '../utils/logger.js';

export class TestGenerator {
  private provider: ReturnType<typeof createLLMProvider>;
  private config: Pick<KakarotConfig, 'maxFixAttempts' | 'temperature' | 'fixTemperature' | 'customPrompts'>;

  constructor(
    config: Pick<
      KakarotConfig,
      'apiKey' | 'provider' | 'model' | 'maxTokens' | 'maxFixAttempts' | 'temperature' | 'fixTemperature' | 'customPrompts'
    >
  ) {
    this.provider = createLLMProvider(config);
    this.config = {
      maxFixAttempts: config.maxFixAttempts,
      temperature: config.temperature,
      fixTemperature: config.fixTemperature,
      customPrompts: config.customPrompts,
    };
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
      const messages = buildTestFixPrompt(context);
      debug(`Sending test fix request to LLM (attempt ${attempt})`);

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
      error(`Failed to fix test (attempt ${attempt}): ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  /**
   * Generate test scaffold (minimal structure) for a test target
   */
  async generateTestScaffold(
    target: TestGenerationContext['target'],
    existingTestFile?: string,
    framework: 'jest' | 'vitest' = 'jest'
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
        }
      );
      debug(`Sending test scaffold request to LLM for ${target.functionName}`);

      const response = await this.provider.generate(messages, {
        temperature: 0.1,
        maxTokens: 2000,
      });

      const testCode = parseTestCode(response.content);
      const validation = validateTestCodeStructure(testCode, framework);

      if (!validation.valid) {
        warn(`Test scaffold validation warnings for ${target.functionName}: ${validation.errors.join(', ')}`);
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

