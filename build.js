import { build } from 'esbuild';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));

const format = process.argv[2] || 'esm';
const isESM = format === 'esm';

const baseConfig = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: isESM ? 'esm' : 'cjs',
  outfile: isESM ? 'dist/index.js' : 'dist/index.cjs',
  external: [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
  ],
  ...(isESM ? {} : {
    banner: {
      js: "const require = (await import('node:module')).createRequire(import.meta.url);",
    },
  }),
  sourcemap: true,
  minify: false,
  logLevel: 'info',
};

build(baseConfig).catch(() => process.exit(1));

