<div align="center">
  <img src="assets/logo.svg" alt="Kakarot CI Logo" width="200">
  
  # Kakarot CI
  
  [![npm version](https://img.shields.io/npm/v/@kakarot-ci/core.svg)](https://www.npmjs.com/package/@kakarot-ci/core)
  [![Node.js version](https://img.shields.io/node/v/@kakarot-ci/core.svg)](https://nodejs.org/)
</div>

> AI-powered unit test generation for TypeScript and JavaScript

> **Beta Software**: This project is currently in beta. Expect occasional bugs and breaking changes. Please report issues and provide feedback.

Kakarot CI automatically generates comprehensive unit tests using AI. It analyzes code, generates test files, runs them, and can automatically commit results back to your repository. As AI improves so will Kakarot-ci!

## Supported Frameworks

- **Vitest**
- **Jest**

## Supported Providers

| Provider | Default (zero-config) | Minimum | Notes |
|----------|----------------------|---------|-------|
| **Anthropic** | `claude-opus-4-6` | `claude-sonnet-4-20250514` | Best test quality. Default for zero-config. |
| **OpenAI** | `gpt-5` | `gpt-4o` | Strong all-round. |
| **Google** | `gemini-3.1-pro-preview` | `gemini-2.5-pro` | Use Pro models only. Flash models may return incomplete responses. |

**Note**: Zero-config defaults use the strongest available model per provider for highest success rate. Use `--model` to pick a cheaper model if preferred.

## Quick Start (Zero Config)

Two commands. No config file needed.

```bash
npm install --save-dev @kakarot-ci/core
KAKAROT_API_KEY=sk-... npx kakarot-ci --mode full
```

Kakarot auto-detects your test framework (Jest or Vitest) from `package.json` and infers the LLM provider from your API key prefix:

| Key prefix | Provider detected | Default model |
|------------|-------------------|---------------|
| `sk-ant-`  | Anthropic         | `claude-opus-4-6` |
| `sk-`      | OpenAI            | `gpt-5` |
| `AIza`     | Google            | `gemini-3.1-pro-preview` |

### Custom Configuration (Optional)

For full control, create `kakarot.config.js`:

```javascript
/** @type {import('@kakarot-ci/core').KakarotConfig} */
export default {
  apiKey: process.env.KAKAROT_API_KEY,
  framework: 'vitest',
  provider: 'anthropic',
  model: 'claude-opus-4-6',
  maxTokens: 16000,
  enableCoverage: true,
};
```

Any field you omit will be auto-detected or use sensible defaults.

### Usage

```bash
# Generate tests for local changes (zero config)
KAKAROT_API_KEY=sk-... npx kakarot-ci --mode full

# Pass API key inline
npx kakarot-ci --mode full --api-key sk-...

# Choose a specific model
npx kakarot-ci --mode full --api-key sk-ant-... --model claude-sonnet-4-20250514

# Target specific files
npx kakarot-ci --mode full --include "src/utils/**/*.ts"

# Generate tests for a PR (in GitHub Actions)
npx kakarot-ci --pr 123 --owner myorg --repo myrepo
```

### CLI Options

```
Options:
  --mode <mode>             Execution mode: pr, scaffold, or full (default: pr)
  --pr <number>             Pull request number (required for pr mode)
  --owner <string>          Repository owner
  --repo <string>           Repository name
  --token <string>          GitHub token (or use GITHUB_TOKEN env var)
  --api-key <string>        LLM API key (or use KAKAROT_API_KEY env var)
  --provider <provider>     LLM provider: openai, anthropic, or google
  --model <model>           LLM model name (e.g. gpt-5, claude-opus-4-6)
  --include <patterns...>   File patterns to include (overrides config)
  --exclude <patterns...>   File patterns to exclude (overrides config)
  -V, --version             Show version number
  -h, --help                Display help
```

## Requirements

- Node.js >= 18.0.0
- A test framework (Jest or Vitest) installed as a dependency
- An API key for any supported LLM provider

## Documentation

For full documentation, configuration options, GitHub Actions setup, and troubleshooting, visit:

**[Full Documentation](https://www.kakarot.io/docs/getting-started)**

## Security & Privacy

### Source Code Transmission

Kakarot CI sends your source code to third-party LLM APIs (OpenAI, Anthropic, or Google) to generate tests. The function code under test, surrounding context, and generated test files are included in API requests. Review your LLM provider's data retention and privacy policies before use. Do not use Kakarot CI on codebases containing hardcoded secrets, credentials, or sensitive data that should not leave your environment.

### API Key Handling

Kakarot CI never stores, logs, or transmits your API keys anywhere other than directly to your chosen LLM provider. Keys are held in memory only for the duration of the process and are never persisted to disk, sent to Kakarot servers, or included in any telemetry.

For production and CI environments, use the `KAKAROT_API_KEY` environment variable rather than the `--api-key` CLI flag. CLI arguments are visible in process listings (`ps aux`) on the host. The environment variable approach avoids this exposure.

```bash
# Preferred: env var (not visible in process list)
KAKAROT_API_KEY=sk-ant-... npx kakarot-ci --mode full

# Avoid in shared/production environments:
npx kakarot-ci --mode full --api-key sk-ant-...
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Setup

```bash
git clone https://github.com/lokardo/kakarot-ci.git
cd kakarot-ci
npm install
npm run build
npm test
```

### Guidelines

- Write tests for new features
- Follow existing code style
- Update documentation for user-facing changes
- Keep commits focused and atomic

**Note**: This project is maintained as a side project. Response times may vary. Your patience is appreciated.

## License

Source-available. Free to use for testing your own software. See [LICENSE](LICENSE) for details.

**You may**: Use this tool to generate tests for any software you build or sell.

**You may not**: Redistribute, resell, or use this code to build competing products.
