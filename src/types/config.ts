import { z } from 'zod';

export const KakarotConfigSchema = z.object({
  apiKey: z.string(),
  githubToken: z.string().optional(),
  provider: z.enum(['openai', 'anthropic', 'google']).optional(),
  model: z.string().optional(),
  maxFixAttempts: z.number().int().min(0).max(5).default(3),
  testLocation: z.enum(['separate', 'co-located']).default('separate'),
  testDirectory: z.string().default('__tests__'),
  testFilePattern: z.string().default('*.test.ts'),
  includePatterns: z.array(z.string()).default(['**/*.ts', '**/*.tsx']),
  excludePatterns: z.array(z.string()).default(['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**']),
  maxTestsPerPR: z.number().int().min(1).default(50),
  enableAutoCommit: z.boolean().default(true),
  commitStrategy: z.enum(['direct', 'branch-pr']).default('direct'),
  enablePRComments: z.boolean().default(true),
  debug: z.boolean().default(false),
});

export type KakarotConfig = z.infer<typeof KakarotConfigSchema>;

export type PartialKakarotConfig = Partial<KakarotConfig>;

