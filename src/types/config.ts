import { z } from 'zod';

// ============================================================================
// Const Type Definitions
// ============================================================================

/** Supported LLM providers */
export const LLM_PROVIDERS = ['openai', 'anthropic', 'google'] as const;
export type LLMProvider = (typeof LLM_PROVIDERS)[number];

/** Supported test frameworks */
export const TEST_FRAMEWORKS = ['jest', 'vitest'] as const;
export type TestFramework = (typeof TEST_FRAMEWORKS)[number];

/** Test generation modes */
export const TEST_MODES = ['scaffold', 'full', 'pr'] as const;
export type TestMode = (typeof TEST_MODES)[number];

/** Test file location strategies */
export const TEST_LOCATIONS = ['separate', 'co-located'] as const;
export type TestLocation = (typeof TEST_LOCATIONS)[number];

/** Common test directory names */
export const TEST_DIRECTORIES = ['__tests__', 'tests', 'test', 'spec', 'src/__tests__'] as const;
export type TestDirectory = (typeof TEST_DIRECTORIES)[number];

/** Common test file patterns */
export const TEST_FILE_PATTERNS = [
  '*.test.ts',
  '*.spec.ts',
  '*.test.tsx',
  '*.spec.tsx',
  '*.test.js',
  '*.spec.js',
  '*.test.jsx',
  '*.spec.jsx',
] as const;
export type TestFilePattern = (typeof TEST_FILE_PATTERNS)[number];

/** Commit strategies for auto-commit */
export const COMMIT_STRATEGIES = ['direct', 'branch-pr'] as const;
export type CommitStrategy = (typeof COMMIT_STRATEGIES)[number];

// ============================================================================
// Config Schema
// ============================================================================

export const KakarotConfigSchema = z.object({
  // Authentication (user-provided, must remain flexible)
  apiKey: z.string(),
  githubToken: z.string().optional(),
  githubOwner: z.string().optional(),
  githubRepo: z.string().optional(),

  // LLM Settings
  provider: z.enum(LLM_PROVIDERS).optional(),
  model: z.string().optional(), // Models change frequently, keep as string
  fixModel: z.string().optional(), // Optional separate model for fixing (stronger model recommended)
  maxTokens: z.number().int().min(1).max(100000).optional(),
  contextLimit: z.number().int().min(1000).max(2000000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  fixTemperature: z.number().min(0).max(2).optional(),
  maxFixAttempts: z.number().int().min(-1).default(5), // -1 means infinite attempts

  // Test Framework Settings
  framework: z.enum(TEST_FRAMEWORKS),
  mode: z.enum(TEST_MODES).default('pr'),
  testLocation: z.enum(TEST_LOCATIONS).default('separate'),
  testDirectory: z.enum(TEST_DIRECTORIES).default('__tests__'),
  testFilePattern: z.enum(TEST_FILE_PATTERNS).default('*.test.ts'),

  // File Patterns (must remain flexible for glob patterns)
  includePatterns: z.array(z.string()).default(['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx']),
  excludePatterns: z.array(z.string()).default(['**/*.test.ts', '**/*.spec.ts', '**/*.test.js', '**/*.spec.js', '**/node_modules/**']),

  // Rate Limiting
  // -1 means unlimited (process all targets)
  maxTestsPerPR: z.number().int().min(-1).default(-1),
  requestDelay: z.number().int().min(0).max(60000).default(0).optional(), // Delay between requests in ms
  maxRetries: z.number().int().min(0).max(10).default(3).optional(), // Max retries for rate limits

  // Git Integration
  enableAutoCommit: z.boolean().default(true),
  commitStrategy: z.enum(COMMIT_STRATEGIES).default('direct'),
  commitMessageTemplate: z.string().optional(), // User-defined template, keep flexible
  skipCommitOnFailure: z.boolean().default(false),
  enablePRComments: z.boolean().default(true),

  // Coverage
  enableCoverage: z.boolean().default(false),

  // Code Style
  codeStyle: z.object({
    autoDetect: z.boolean().default(true),
    formatGeneratedCode: z.boolean().default(true),
    lintGeneratedCode: z.boolean().default(true),
  }).default({}).optional(),

  // Custom Prompts (user-defined, must remain flexible)
  customPrompts: z.object({
    testGeneration: z.string().optional(),
    testScaffold: z.string().optional(),
    testScaffoldSystem: z.string().optional(),
    testScaffoldUser: z.string().optional(),
    testFix: z.string().optional(),
  }).optional(),

  // Debug
  debug: z.boolean().default(false),
});

export type KakarotConfig = z.infer<typeof KakarotConfigSchema>;

export type PartialKakarotConfig = Partial<KakarotConfig>;

