/**
 * Code standards detection and application
 * Supports ESLint, Prettier, Biome, and TypeScript config
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface CodeStyleConfig {
  eslint?: {
    configPath?: string;
    enabled: boolean;
  };
  prettier?: {
    configPath?: string;
    enabled: boolean;
  };
  biome?: {
    configPath?: string;
    enabled: boolean;
  };
  typescript?: {
    configPath?: string;
    enabled: boolean;
  };
}

/**
 * Detect code style configuration files in project
 */
export async function detectCodeStyle(projectRoot: string): Promise<CodeStyleConfig> {
  const config: CodeStyleConfig = {};

  // Detect ESLint
  const eslintConfigs = [
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.json',
    '.eslintrc.yaml',
    '.eslintrc.yml',
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
  ];
  
  for (const configFile of eslintConfigs) {
    const path = join(projectRoot, configFile);
    if (existsSync(path)) {
      config.eslint = { configPath: path, enabled: true };
      break;
    }
  }

  // Check package.json for ESLint config
  if (!config.eslint) {
    const packageJsonPath = join(projectRoot, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        if (packageJson.eslintConfig) {
          config.eslint = { enabled: true };
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  // Detect Prettier
  const prettierConfigs = [
    '.prettierrc',
    '.prettierrc.js',
    '.prettierrc.cjs',
    '.prettierrc.json',
    '.prettierrc.yaml',
    '.prettierrc.yml',
    'prettier.config.js',
    'prettier.config.cjs',
    'prettier.config.mjs',
  ];

  for (const configFile of prettierConfigs) {
    const path = join(projectRoot, configFile);
    if (existsSync(path)) {
      config.prettier = { configPath: path, enabled: true };
      break;
    }
  }

  // Check package.json for Prettier config
  if (!config.prettier) {
    const packageJsonPath = join(projectRoot, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        if (packageJson.prettier) {
          config.prettier = { enabled: true };
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  // Detect Biome
  const biomeConfigPath = join(projectRoot, 'biome.json');
  if (existsSync(biomeConfigPath)) {
    config.biome = { configPath: biomeConfigPath, enabled: true };
  }

  // Detect TypeScript
  const tsConfigPath = join(projectRoot, 'tsconfig.json');
  if (existsSync(tsConfigPath)) {
    config.typescript = { configPath: tsConfigPath, enabled: true };
  }

  return config;
}

/**
 * Format generated code using detected formatters
 */
export async function formatGeneratedCode(
  code: string,
  projectRoot: string
): Promise<string> {
  const codeStyle = await detectCodeStyle(projectRoot);
  let formatted = code;

  // Prettier takes precedence if available
  if (codeStyle.prettier?.enabled) {
    try {
      formatted = await formatWithPrettier(formatted, projectRoot, codeStyle.prettier.configPath);
    } catch (err) {
      // If Prettier fails, continue without formatting
      console.warn(`Prettier formatting failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (codeStyle.biome?.enabled) {
    // Biome as fallback
    try {
      formatted = await formatWithBiome(formatted, projectRoot, codeStyle.biome.configPath);
    } catch (err) {
      console.warn(`Biome formatting failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return formatted;
}

/**
 * Lint generated code using detected linters
 */
export async function lintGeneratedCode(
  code: string,
  projectRoot: string
): Promise<string> {
  const codeStyle = await detectCodeStyle(projectRoot);
  let linted = code;

  // ESLint takes precedence
  if (codeStyle.eslint?.enabled) {
    try {
      linted = await lintWithESLint(linted, projectRoot, codeStyle.eslint.configPath);
    } catch (err) {
      console.warn(`ESLint linting failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (codeStyle.biome?.enabled) {
    // Biome as fallback
    try {
      linted = await lintWithBiome(linted, projectRoot, codeStyle.biome.configPath);
    } catch (err) {
      console.warn(`Biome linting failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return linted;
}

/**
 * Format code with Prettier
 */
async function formatWithPrettier(
  code: string,
  projectRoot: string,
  configPath?: string
): Promise<string> {
  try {
    // @ts-expect-error - prettier is an optional dependency
    const prettier = await import('prettier');
    const options: {
      filepath: string;
      [key: string]: unknown;
    } = {
      filepath: 'test.ts', // Assume TypeScript for test files
    };

    if (configPath) {
      const config = await prettier.resolveConfig(configPath);
      if (config) {
        Object.assign(options, config);
      }
    } else {
      const config = await prettier.resolveConfig(projectRoot);
      if (config) {
        Object.assign(options, config);
      }
    }

    return await prettier.format(code, options);
  } catch (err) {
    // Prettier not installed or config error
    throw new Error(`Prettier formatting failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Format code with Biome
 */
async function formatWithBiome(
  code: string,
  _projectRoot: string,
  configPath?: string
): Promise<string> {
  try {
    // @ts-expect-error - @biomejs/biome is an optional dependency
    const { format } = await import('@biomejs/biome');
    const config = configPath 
      ? JSON.parse(readFileSync(configPath, 'utf-8'))
      : undefined;

    const result = format(code, {
      filePath: 'test.ts',
      ...config,
    });

    if (result.content) {
      return result.content;
    }
    return code;
  } catch (err) {
    throw new Error(`Biome formatting failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Lint code with ESLint
 */
async function lintWithESLint(
  code: string,
  projectRoot: string,
  configPath?: string
): Promise<string> {
  try {
    // @ts-expect-error - eslint is an optional dependency
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({
      cwd: projectRoot,
      useEslintrc: true,
      overrideConfigFile: configPath,
      fix: true,
    });

    const results = await eslint.lintText(code, { filePath: 'test.ts' });
    
    if (results.length > 0 && results[0].output) {
      return results[0].output;
    }
    return code;
  } catch (err) {
    throw new Error(`ESLint linting failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Lint code with Biome
 */
async function lintWithBiome(
  code: string,
  _projectRoot: string,
  configPath?: string
): Promise<string> {
  try {
    // @ts-expect-error - @biomejs/biome is an optional dependency
    const { lintAndFix } = await import('@biomejs/biome');
    const config = configPath 
      ? JSON.parse(readFileSync(configPath, 'utf-8'))
      : undefined;

    const result = lintAndFix(code, {
      filePath: 'test.ts',
      ...config,
    });

    if (result.code) {
      return result.code;
    }
    return code;
  } catch (err) {
    throw new Error(`Biome linting failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

