import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { KakarotConfigSchema, type KakarotConfig, type PartialKakarotConfig } from '../types/config.js';
import { error } from './logger.js';

/**
 * Find the project root by walking up the directory tree until package.json is found
 */
function findProjectRoot(startPath?: string): string {
  const start = startPath ?? process.cwd();
  let current = start;
  let previous: string | null = null;

  // Walk up until we find package.json or hit filesystem root
  while (current !== previous) {
    if (existsSync(join(current, 'package.json'))) {
      return current;
    }
    previous = current;
    current = dirname(current);
  }

  return start;
}

/**
 * Load config from kakarot.config.ts
 */
async function loadTypeScriptConfig(root: string): Promise<PartialKakarotConfig | null> {
  const configPath = join(root, 'kakarot.config.ts');
  
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    // Dynamic import for TypeScript config file
    // Note: This requires the file to be transpiled or use tsx/ts-node in runtime
    // For now, we'll attempt to import it directly
    const configModule = await import(configPath);
    return configModule.default || configModule.config || null;
  } catch (err) {
    error(`Failed to load kakarot.config.ts: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Load config from .kakarot-ci.config.js
 */
async function loadJavaScriptConfig(root: string): Promise<PartialKakarotConfig | null> {
  const configPath = join(root, '.kakarot-ci.config.js');
  
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const configModule = await import(configPath);
    return configModule.default || configModule.config || null;
  } catch (err) {
    error(`Failed to load .kakarot-ci.config.js: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Load config from .kakarot-ci.config.json
 */
function loadJsonConfig(root: string): PartialKakarotConfig | null {
  const configPath = join(root, '.kakarot-ci.config.json');
  
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as PartialKakarotConfig;
  } catch (err) {
    error(`Failed to load .kakarot-ci.config.json: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Load config from package.json → kakarotCi field
 */
function loadPackageJsonConfig(root: string): PartialKakarotConfig | null {
  const packagePath = join(root, 'package.json');
  
  if (!existsSync(packagePath)) {
    return null;
  }

  try {
    const content = readFileSync(packagePath, 'utf-8');
    const pkg = JSON.parse(content) as { kakarotCi?: PartialKakarotConfig };
    return pkg.kakarotCi || null;
  } catch (err) {
    error(`Failed to load package.json: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Load and validate Kakarot configuration
 */
export async function loadConfig(): Promise<KakarotConfig> {
  const projectRoot = findProjectRoot();
  let config: PartialKakarotConfig | null = null;

  config = await loadTypeScriptConfig(projectRoot);
  if (config) {
    return KakarotConfigSchema.parse(config);
  }

  config = await loadJavaScriptConfig(projectRoot);
  if (config) {
    return KakarotConfigSchema.parse(config);
  }

  config = loadJsonConfig(projectRoot);
  if (config) {
    return KakarotConfigSchema.parse(config);
  }

  config = loadPackageJsonConfig(projectRoot);
  if (config) {
    return KakarotConfigSchema.parse(config);
  }

  // No config found, return defaults
  return KakarotConfigSchema.parse({});
}
