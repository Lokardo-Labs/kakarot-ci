import { readFileSync } from 'fs';
import { cosmiconfig } from 'cosmiconfig';
import { findUp } from 'find-up';
import { KakarotConfigSchema, type KakarotConfig, type PartialKakarotConfig, type LLMProvider, type TestFramework } from '../types/config.js';
import { error, info } from './logger.js';

/**
 * Find the project root by locating package.json
 */
export async function findProjectRoot(startPath?: string): Promise<string> {
  const packageJsonPath = await findUp('package.json', {
    cwd: startPath ?? process.cwd(),
  });
  
  if (packageJsonPath) {
    const { dirname } = await import('path');
    return dirname(packageJsonPath);
  }
  
  return startPath ?? process.cwd();
}

/** Default model per provider — used when the user doesn't specify one */
export const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: 'gpt-5',
  anthropic: 'claude-opus-4-6',
  google: 'gemini-3.1-pro-preview',
};

/**
 * Infer LLM provider and a sensible default model from the API key prefix.
 * Returns null if the key format is unrecognised.
 */
export function detectProviderFromApiKey(apiKey: string): { provider: LLMProvider; model: string } | null {
  if (apiKey.startsWith('sk-ant-')) {
    return { provider: 'anthropic', model: DEFAULT_MODELS.anthropic };
  }
  if (apiKey.startsWith('sk-')) {
    return { provider: 'openai', model: DEFAULT_MODELS.openai };
  }
  if (apiKey.startsWith('AIza')) {
    return { provider: 'google', model: DEFAULT_MODELS.google };
  }
  return null;
}

/**
 * Auto-detect the test framework by inspecting package.json dependencies.
 * Prefers vitest over jest when both are present.
 */
export async function detectTestFramework(startPath?: string): Promise<TestFramework | null> {
  const packageJsonPath = await findUp('package.json', {
    cwd: startPath ?? process.cwd(),
  });
  if (!packageJsonPath) return null;

  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (allDeps['vitest']) return 'vitest';
    if (allDeps['jest']) return 'jest';
  } catch {
    // Ignore parse errors
  }
  return null;
}

/**
 * Load and validate Kakarot configuration
 */
export async function loadConfig(): Promise<KakarotConfig> {
  const explorer = cosmiconfig('kakarot', {
    searchPlaces: [
      'kakarot.config.js',
      '.kakarot-ci.config.js',
      '.kakarot-ci.config.json',
      'package.json',
    ],
  });

  try {
    const result = await explorer.search();
    
    let config: PartialKakarotConfig = {};
    
    if (result?.config) {
      config = result.config as PartialKakarotConfig;
    }
    
    // Also check package.json for kakarotCi field
    if (!result || result.filepath?.endsWith('package.json')) {
      const packageJsonPath = await findUp('package.json');
      if (packageJsonPath) {
        const { readFileSync } = await import('fs');
        try {
          const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { kakarotCi?: PartialKakarotConfig };
          if (pkg.kakarotCi) {
            config = { ...config, ...pkg.kakarotCi };
          }
        } catch {
          // Ignore package.json parse errors
        }
      }
    }
    
    // Merge environment variables
    if (process.env.KAKAROT_API_KEY) {
      config.apiKey = process.env.KAKAROT_API_KEY;
    }
    
    if (!config.githubToken && process.env.GITHUB_TOKEN) {
      config.githubToken = process.env.GITHUB_TOKEN;
    }
    
    // Merge provider and model from env (allow override from config file)
    if (process.env.PROVIDER) {
      config.provider = process.env.PROVIDER as 'openai' | 'anthropic' | 'google';
    }
    
    if (process.env.MODEL) {
      config.model = process.env.MODEL;
    }

    // --- Zero-config auto-detection ---

    // Auto-detect provider + default model from API key prefix
    if (config.apiKey && !config.provider) {
      const detected = detectProviderFromApiKey(config.apiKey);
      if (detected) {
        config.provider = detected.provider;
        if (!config.model) {
          config.model = detected.model;
        }
        info(`Auto-detected provider: ${detected.provider} (from API key prefix)`);
      }
    }

    // Fill default model when provider is known but model is not
    if (config.provider && !config.model) {
      config.model = DEFAULT_MODELS[config.provider];
      info(`Using default model for ${config.provider}: ${config.model}`);
    }

    // Default maxTokens to 64k if not explicitly set
    if (!config.maxTokens) {
      config.maxTokens = 64000;
    }

    // Auto-detect test framework from package.json dependencies
    if (!config.framework) {
      const detectedFramework = await detectTestFramework();
      if (detectedFramework) {
        config.framework = detectedFramework;
        info(`Auto-detected test framework: ${detectedFramework} (from package.json)`);
      }
    }
    
    return KakarotConfigSchema.parse(config);
  } catch (err) {
    if (err instanceof Error && err.message.includes('apiKey')) {
      error(
        'Missing required apiKey. Provide it via:\n' +
        '  - Config file (kakarot.config.js, .kakarot-ci.config.js/json, or package.json)\n' +
        '  - Environment variable: KAKAROT_API_KEY'
      );
    }
    if (err instanceof Error && err.message.includes('framework')) {
      error(
        'Could not detect test framework. Provide it via:\n' +
        '  - Config file: framework: "jest" or "vitest"\n' +
        '  - Or install jest/vitest as a dependency so it can be auto-detected'
      );
    }
    throw err;
  }
}
