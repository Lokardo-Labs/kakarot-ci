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

| Provider | Minimum Recommended | Best | Notes |
|----------|---------------------|------|-------|
| **Anthropic** | `claude-sonnet-4-20250514` | `claude-opus-4-6` | **Opus 4.5/4.6 highly recommended.** Best test quality by far. Use Opus if you're hitting issues with other models. |
| **OpenAI** | `gpt-4o` | — | Best balance of speed, quality, and reliability. **Recommended for most users.** |
| **Google** | `gemini-2.5-pro` | — | Use Pro models only. Flash models may return incomplete responses. |

**Note**: These are minimum recommended models. Newer and more capable models will generally produce better results. **Claude Opus 4.5 and 4.6 are the strongest models we've tested** — if you're experiencing quality issues, switching to Opus will almost always resolve them.

## Quick Start

### Installation

```bash
npm install --save-dev @kakarot-ci/core
```

### Configuration

Create `kakarot.config.js`:

```javascript
/** @type {import('@kakarot-ci/core').KakarotConfig} */
export default {
  apiKey: process.env.KAKAROT_API_KEY,
  framework: 'vitest', // or 'jest'
  provider: 'openai',  // 'openai', 'anthropic', or 'google'
  model: 'gpt-4o',     // recommended
};
```

### Usage

```bash
# Generate tests for local changes
npx kakarot-ci --mode full

# Target specific files
npx kakarot-ci --mode full --include "src/utils/**/*.ts"

# Generate tests for a PR
npx kakarot-ci --pr 123 --owner myorg --repo myrepo
```

### CLI Options

```
Options:
  --mode <mode>           Execution mode: pr, scaffold, or full (default: pr)
  --pr <number>           Pull request number (required for pr mode)
  --owner <string>        Repository owner
  --repo <string>         Repository name
  --token <string>        GitHub token (or use GITHUB_TOKEN env var)
  --include <patterns...> File patterns to include (overrides config)
  --exclude <patterns...> File patterns to exclude (overrides config)
  -V, --version           Show version number
  -h, --help              Display help
```

## Requirements

- Node.js >= 18.0.0
- A test framework (Jest or Vitest) already set up in your project
- An API key for your chosen LLM provider

## Documentation

For full documentation, configuration options, GitHub Actions setup, and troubleshooting, visit:

**[Full Documentation](https://www.kakarot.io/docs/getting-started)**

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
