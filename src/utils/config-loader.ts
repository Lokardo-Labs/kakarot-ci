import { cosmiconfig } from 'cosmiconfig';
import { findUp } from 'find-up';
import { KakarotConfigSchema, type KakarotConfig, type PartialKakarotConfig } from '../types/config.js';
import { error } from './logger.js';

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
    if (!config.apiKey && process.env.KAKAROT_API_KEY) {
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
    
    return KakarotConfigSchema.parse(config);
  } catch (err) {
    if (err instanceof Error && err.message.includes('apiKey')) {
      error(
        'Missing required apiKey. Provide it via:\n' +
        '  - Config file (kakarot.config.js, .kakarot-ci.config.js/json, or package.json)\n' +
        '  - Environment variable: KAKAROT_API_KEY'
      );
    }
    throw err;
  }
}
