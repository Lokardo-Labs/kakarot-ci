<div align="center">
  <img src="assets/logo.svg" alt="Kakarot CI Logo" width="200">
  
  # Kakarot CI
  
  [![npm version](https://img.shields.io/npm/v/@kakarot-ci/core.svg)](https://www.npmjs.com/package/@kakarot-ci/core)
  [![Node.js version](https://img.shields.io/node/v/@kakarot-ci/core.svg)](https://nodejs.org/)
</div>

> AI-powered unit test generation for TypeScript and JavaScript

> **⚠️ Beta Software**: This project is currently in beta. While functional, expect occasional bugs and breaking changes as we iterate and improve. Please report issues and provide feedback!

Kakarot CI automatically generates comprehensive unit tests using AI. While optimized for pull request workflows, it can be used in various scenarios: analyzing PR changes, generating tests for specific files, or creating test suites for entire codebases. It analyzes code, generates test files, runs them, and can automatically commit results back to your repository.

## Features

- 🤖 **AI-Powered Test Generation**: Uses LLMs (OpenAI, Anthropic, Google) to generate comprehensive unit tests
- 🔍 **Smart Code Analysis**: Analyzes AST to extract functions and understand code structure
- 🎯 **Targeted Testing**: Generates tests for specific functions, files, or entire codebases
- 🔄 **Auto-Fix Loop**: Automatically fixes failing tests with multiple retry attempts
- 📊 **Coverage Reports**: Optional test coverage analysis and summaries
- 🚀 **GitHub Integration**: Seamlessly integrates with GitHub Actions and PR workflows (optional)
- ⚙️ **Flexible Configuration**: Supports Jest and Vitest, configurable test locations and patterns
- 📝 **PR Comments**: Automatically posts test generation summaries to pull requests

## Installation

```bash
npm install --save-dev @kakarot-ci/core
```

## Usage

### Pull Request Workflow (Primary Use Case)

The simplest way to use Kakarot CI is via the command-line interface for pull requests:

```bash
npx kakarot-ci --pr 123 --owner myorg --repo myrepo --token ghp_xxxxx
```

Or in a GitHub Actions workflow:

```yaml
- name: Generate Tests
  run: npx kakarot-ci
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    KAKAROT_API_KEY: ${{ secrets.KAKAROT_API_KEY }}
```

The CLI automatically detects:
- PR number from `GITHUB_EVENT_PATH` (GitHub Actions)
- Repository owner/repo from `GITHUB_REPOSITORY` or git remote
- GitHub token from `GITHUB_TOKEN` environment variable

### Programmatic API

#### Pull Request Processing

```typescript
import { runPullRequest } from '@kakarot-ci/core';

const summary = await runPullRequest({
  prNumber: 123,
  owner: 'myorg',
  repo: 'myrepo',
  githubToken: 'ghp_xxxxx',
});

console.log(`Generated ${summary.testsGenerated} tests`);
```

#### Custom Workflows

You can also use the lower-level APIs for custom workflows:

```typescript
import { 
  TestGenerator, 
  extractTestTargets,
  analyzeFile,
  writeTestFiles 
} from '@kakarot-ci/core';

// Generate tests for specific files
const targets = await analyzeFile('src/utils.ts', 'main', githubClient, config);
const generator = new TestGenerator({ apiKey, provider: 'openai' });

for (const target of targets) {
  const test = await generator.generateTest({
    target,
    framework: 'vitest',
  });
  // Write test file...
}

// Or extract targets from file diffs
const prFiles = [...]; // Your file changes
const targets = await extractTestTargets(prFiles, githubClient, 'sha', config);
```

## Configuration

Kakarot CI can be configured via:

1. **Config file**: `kakarot.config.js`, `.kakarot-ci.config.js`, or `.kakarot-ci.config.json`
2. **package.json**: Add a `kakarotCi` field
3. **Environment variables**: `KAKAROT_API_KEY`, `GITHUB_TOKEN`, etc.

**Note**: TypeScript config files (`.ts`) are not supported in the compiled package. Use JavaScript (`.js`) or JSON (`.json`) config files instead.

### Configuration Options

#### Required

- **`apiKey`** (string, required)
  - Your LLM provider API key
  - Can also be set via `KAKAROT_API_KEY` environment variable
  - Example: `"sk-xxxxx"` (OpenAI) or `"sk-ant-xxxxx"` (Anthropic)

#### LLM Provider Settings

- **`provider`** (string, optional, default: `"openai"`)
  - LLM provider to use: `"openai"`, `"anthropic"`, or `"google"`
  - Can also be set via `PROVIDER` environment variable
  - Example: `"anthropic"`

- **`model`** (string, optional)
  - Specific model to use (provider-specific)
  - Can also be set via `MODEL` environment variable
  - Defaults to provider's recommended model
  - Examples: `"gpt-4"`, `"claude-3-opus-20240229"`, `"gemini-pro"`

- **`maxTokens`** (number, optional, default: provider default)
  - Maximum tokens in response (1-100000)
  - Example: `4000`

- **`temperature`** (number, optional, default: `0.2`)
  - Temperature for test generation (0-2)
  - Lower values = more consistent, higher = more creative
  - Example: `0.2`

- **`fixTemperature`** (number, optional, default: `0.2`)
  - Temperature for test fixing attempts (0-2)
  - Example: `0.3`

- **`maxFixAttempts`** (number, optional, default: `3`)
  - Maximum number of attempts to fix failing tests (0-5)
  - Example: `5`

#### Test Framework

- **`framework`** (string, required)
  - Test framework: `"jest"` or `"vitest"`
  - Example: `"vitest"`

#### Test File Organization

- **`testLocation`** (string, optional, default: `"separate"`)
  - Where to place test files: `"separate"` or `"co-located"`
  - `"separate"`: Tests in a dedicated test directory
  - `"co-located"`: Tests next to source files
  - Example: `"co-located"`

- **`testDirectory`** (string, optional, default: `"__tests__"`)
  - Directory name for test files (when `testLocation` is `"separate"`)
  - Example: `"tests"` or `"__tests__"`

- **`testFilePattern`** (string, optional, default: `"*.test.ts"`)
  - Glob pattern for test file names
  - Example: `"*.spec.ts"` or `"*.test.js"`

#### File Filtering

- **`includePatterns`** (string[], optional, default: `["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"]`)
  - Glob patterns for files to include when scanning for changes
  - Example: `["src/**/*.ts", "lib/**/*.ts"]`

- **`excludePatterns`** (string[], optional, default: `["**/*.test.ts", "**/*.spec.ts", "**/*.test.js", "**/*.spec.js", "**/node_modules/**"]`)
  - Glob patterns for files to exclude
  - Example: `["**/*.test.ts", "**/vendor/**"]`

#### Limits

- **`maxTestsPerPR`** (number, optional, default: `50`)
  - Maximum number of test targets to process per PR
  - Prevents excessive API usage on large PRs
  - Example: `100`

#### GitHub Integration

- **`githubToken`** (string, optional)
  - GitHub personal access token
  - Can also be set via `GITHUB_TOKEN` environment variable
  - Required for GitHub operations (commits, PR comments)
  - Example: `"ghp_xxxxx"`

- **`githubOwner`** (string, optional)
  - Repository owner (can be auto-detected from git remote)
  - Example: `"myorg"`

- **`githubRepo`** (string, optional)
  - Repository name (can be auto-detected from git remote)
  - Example: `"myrepo"`

#### Commit Strategy

- **`enableAutoCommit`** (boolean, optional, default: `true`)
  - Automatically commit generated tests
  - Example: `false` (to review tests before committing)

- **`commitStrategy`** (string, optional, default: `"direct"`)
  - How to commit tests: `"direct"` or `"branch-pr"`
  - `"direct"`: Commit directly to PR branch
  - `"branch-pr"`: Create a new branch and open a PR
  - Example: `"branch-pr"`

- **`enablePRComments`** (boolean, optional, default: `true`)
  - Post test generation summary as PR comment
  - Example: `true`

#### Coverage

- **`enableCoverage`** (boolean, optional, default: `false`)
  - Enable test coverage collection and reporting
  - Example: `true`

#### Debugging

- **`debug`** (boolean, optional, default: `false`)
  - Enable debug logging
  - Can also be set via `KAKAROT_DEBUG=true` environment variable
  - Example: `true`

### Example Configuration

**`kakarot.config.js`**:

```javascript
/** @type {import('@kakarot-ci/core').KakarotConfig} */
const config = {
  // Required: API key (can also be set via KAKAROT_API_KEY env var)
  apiKey: process.env.OPENAI_API_KEY,
  
  // Required: Test framework
  framework: 'vitest',
  
  // Optional: LLM provider settings (can also be set via PROVIDER and MODEL env vars)
  provider: 'openai', // 'openai' | 'anthropic' | 'google'
  model: 'gpt-4',
  temperature: 0.2,
  fixTemperature: 0.2,
  maxTokens: 4000,
  
  // File filtering
  includePatterns: ['src/**/*.ts'],
  excludePatterns: [
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
  ],
  
  // Test file organization
  testLocation: 'co-located', // 'separate' | 'co-located'
  testDirectory: '__tests__', // Only used when testLocation is 'separate'
  testFilePattern: '*.test.ts',
  
  // Limits and behavior
  maxTestsPerPR: 50,
  maxFixAttempts: 3,
  
  // GitHub integration
  enableAutoCommit: true,
  commitStrategy: 'branch-pr', // 'direct' | 'branch-pr'
  enablePRComments: true,
  
  // Optional features
  enableCoverage: false,
  debug: true,
};

module.exports = config;
```

**`.kakarot-ci.config.json`** (minimal example):

```json
{
  "framework": "vitest",
  "includePatterns": ["src/**/*.ts"],
  "excludePatterns": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "**/node_modules/**",
    "**/dist/**"
  ],
  "maxFixAttempts": 3,
  "enableAutoCommit": true,
  "commitStrategy": "branch-pr",
  "enablePRComments": true
}
```

**Note**: The `apiKey` should be provided via the `KAKAROT_API_KEY` environment variable for security.

**`package.json`**:

```json
{
  "kakarotCi": {
    "framework": "vitest",
    "testLocation": "co-located",
    "maxTestsPerPR": 50
  }
}
```

## GitHub Actions Integration

Create a workflow file (`.github/workflows/kakarot-ci.yml`):

```yaml
name: Kakarot CI

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  generate-tests:
    runs-on: ubuntu-latest
    permissions:
      contents: write  # Required to push commits directly to branch (commitStrategy: 'direct')
      pull-requests: write  # Required to create PRs (commitStrategy: 'branch-pr') and post comments
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Generate tests
        run: npx kakarot-ci
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          KAKAROT_API_KEY: ${{ secrets.KAKAROT_API_KEY }}
          # Optional: Override provider/model via env vars
          # PROVIDER: openai
          # MODEL: gpt-4
          
```

**Note on permissions:**
- `contents: write` is required to push commits directly to the PR branch (when using `commitStrategy: 'direct'`, the default)
- `pull-requests: write` is required to:
  - Create pull requests (when using `commitStrategy: 'branch-pr'`)
  - Post PR comments (when `enablePRComments: true`)
- Both permissions are recommended for full functionality

**Using a Personal Access Token (PAT):**

If your organization restricts `GITHUB_TOKEN` permissions, you'll need to use a Personal Access Token:

```yaml
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GH_PAT }}  # Use PAT instead of GITHUB_TOKEN

      - name: Generate tests
        run: npx kakarot-ci
        env:
          GITHUB_TOKEN: ${{ secrets.GH_PAT }}  # Use PAT instead of GITHUB_TOKEN
          KAKAROT_API_KEY: ${{ secrets.KAKAROT_API_KEY }}
          # Optional: Override provider/model via env vars
          # PROVIDER: openai
          # MODEL: gpt-4
```

Create a PAT with `repo` scope and add it as a repository secret named `GH_PAT`.

## How It Works

### Pull Request Workflow

1. **Analyze PR Changes**: Scans the pull request diff to identify changed files
2. **Extract Functions**: Uses AST analysis to find functions, methods, and classes that were modified
3. **Generate Tests**: Sends function code to LLM with carefully crafted prompts to generate comprehensive tests
4. **Run Tests**: Executes the generated tests using your configured test framework
5. **Fix Failures**: Automatically attempts to fix failing tests (up to `maxFixAttempts` times)
6. **Commit Results**: Commits generated tests back to the PR (if `enableAutoCommit` is true)
7. **Post Summary**: Posts a summary comment to the PR with test generation results

### Core Components

The tool is built with modular components that can be used independently:

- **AST Analysis**: Extracts functions, methods, and classes from TypeScript/JavaScript files
- **Test Generation**: Uses LLM prompts optimized for generating accurate, comprehensive tests
- **Test Execution**: Runs tests using Jest or Vitest
- **Auto-Fix Loop**: Iteratively fixes failing tests using LLM feedback
- **GitHub Integration**: Optional integration for PR workflows, commits, and comments

You can use these components programmatically for custom workflows beyond pull requests.

## Requirements

- Node.js >= 18.0.0
- A test framework (Jest or Vitest) already set up in your project
- An API key for your chosen LLM provider (OpenAI, Anthropic, or Google)
- GitHub token with appropriate permissions (required only for GitHub integration features)

## CLI Options

```bash
kakarot-ci [options]

Options:
  --pr <number>        Pull request number
  --owner <string>     Repository owner
  --repo <string>      Repository name
  --token <string>     GitHub token (or use GITHUB_TOKEN env var)
  -V, --version        Show version number
  -h, --help           Display help
```

## Environment Variables

- `KAKAROT_API_KEY`: LLM provider API key (required, can also be set in config file)
- `PROVIDER`: LLM provider (`openai`, `anthropic`, or `google`, can also be set in config file)
- `MODEL`: LLM model name (e.g., `gpt-4`, `claude-3-opus-20240229`, can also be set in config file)
- `GITHUB_TOKEN`: GitHub personal access token (required for GitHub operations)
- `GITHUB_REPOSITORY`: Repository in format `owner/repo` (auto-detected in GitHub Actions)
- `GITHUB_EVENT_PATH`: Path to GitHub event JSON (auto-set in GitHub Actions)
- `PR_NUMBER`: Pull request number (alternative to `--pr` flag)
- `KAKAROT_DEBUG`: Enable debug logging (`true`/`false`)

## Troubleshooting

### Common Issues

#### "LLM API key is required"
**Problem**: The API key is missing or not properly configured.

**Solutions**:
- Set `KAKAROT_API_KEY` environment variable
- Add `apiKey` to your config file (`kakarot.config.js` or `.kakarot-ci.config.json`)
- Verify the API key is valid for your chosen provider (OpenAI, Anthropic, or Google)

#### "GitHub token is required"
**Problem**: GitHub token is missing when trying to use GitHub features.

**Solutions**:
- Set `GITHUB_TOKEN` environment variable
- Add `githubToken` to your config file
- Use `--token` CLI flag
- For GitHub Actions, ensure `GITHUB_TOKEN` is available (or use a PAT if your org restricts permissions)

#### "Pull request number is required"
**Problem**: PR number cannot be detected automatically.

**Solutions**:
- Use `--pr <number>` CLI flag
- Set `PR_NUMBER` environment variable
- In GitHub Actions, ensure `GITHUB_EVENT_PATH` is set (should be automatic)

#### "Invalid repository format"
**Problem**: Repository owner/repo format is incorrect.

**Solutions**:
- Use format: `owner/repo` (e.g., `myorg/myrepo`)
- Set `GITHUB_REPOSITORY` environment variable
- Use `--owner` and `--repo` CLI flags separately

#### "Unsupported test framework"
**Problem**: Framework is not `jest` or `vitest`.

**Solutions**:
- Set `framework: 'jest'` or `framework: 'vitest'` in config
- Ensure Jest or Vitest is installed in your project
- Verify your test framework is properly configured

#### "No valid JSON output from Vitest/Jest"
**Problem**: Test runner output cannot be parsed.

**Solutions**:
- Ensure test framework is properly installed
- Check that test files are valid
- Enable debug mode (`KAKAROT_DEBUG=true`) to see raw output
- Verify package manager detection (npm/yarn/pnpm)

#### Tests fail after generation
**Problem**: Generated tests don't pass.

**Solutions**:
- Increase `maxFixAttempts` in config (default: 3)
- Check test output for specific errors
- Review generated tests manually
- Ensure your code is testable (no circular dependencies, proper exports)
- Check that mocks are set up correctly if your code has external dependencies

#### "OpenAI/Anthropic/Google API error: 401"
**Problem**: Invalid API key or authentication failure.

**Solutions**:
- Verify API key is correct
- Check API key has proper permissions
- Ensure you're using the correct key format for your provider
- Check if API key has expired or been revoked

#### "OpenAI/Anthropic/Google API error: 429"
**Problem**: Rate limit exceeded.

**Solutions**:
- Wait before retrying
- Reduce `maxTestsPerPR` to process fewer tests at once
- Check your API usage limits
- Consider using a different model or provider

#### "Expected file but got directory"
**Problem**: Path points to a directory instead of a file.

**Solutions**:
- Check your `includePatterns` and `excludePatterns` in config
- Verify file paths are correct
- Ensure test files aren't being included in source file patterns

#### Commit fails in GitHub Actions
**Problem**: Cannot commit generated tests.

**Solutions**:
- Ensure `contents: write` permission is set in workflow
- Use a PAT if your organization restricts `GITHUB_TOKEN` permissions
- Check that the branch is not protected
- Verify `enableAutoCommit` is `true` in config

#### TypeScript config files not working
**Problem**: `kakarot.config.ts` files are not recognized.

**Solutions**:
- Use JavaScript (`.js`) or JSON (`.json`) config files instead
- TypeScript config files require transpilation which is not available in the compiled package
- Use `kakarot.config.js` or `.kakarot-ci.config.json`

### Debug Mode

Enable debug logging to troubleshoot issues:

```bash
KAKAROT_DEBUG=true npx kakarot-ci --pr 123
```

Or in config:
```javascript
{
  debug: true
}
```

This will show:
- Detailed API requests/responses
- Test execution output
- File operations
- Configuration loading
- Error stack traces

## FAQ

### General

**Q: What LLM providers are supported?**
A: OpenAI, Anthropic (Claude), and Google (Gemini). You can switch providers via the `provider` config option or `PROVIDER` environment variable.

**Q: Can I use this without GitHub?**
A: Yes! Use `scaffold` or `full` mode for local development:
```bash
npx kakarot-ci --mode scaffold
npx kakarot-ci --mode full
```

**Q: Does this work with JavaScript or only TypeScript?**
A: Both! Kakarot CI supports `.ts`, `.tsx`, `.js`, and `.jsx` files.

**Q: Can I customize the generated tests?**
A: Yes, you can provide custom prompts via the `customPrompts` config option to override default test generation behavior.

**Q: What test frameworks are supported?**
A: Jest and Vitest. Set `framework: 'jest'` or `framework: 'vitest'` in your config.

### Configuration

**Q: Where should I put my config file?**
A: Config files can be:
- `kakarot.config.js` (root directory)
- `.kakarot-ci.config.js` (root directory)
- `.kakarot-ci.config.json` (root directory)
- `package.json` (under `kakarotCi` field)

**Q: Can I use environment variables instead of a config file?**
A: Yes! Most options can be set via environment variables. See the [Environment Variables](#environment-variables) section.

**Q: How do I exclude certain files from test generation?**
A: Use `excludePatterns` in your config:
```javascript
{
  excludePatterns: ['**/*.test.ts', '**/vendor/**', '**/node_modules/**']
}
```

**Q: Can I generate tests for specific files only?**
A: Yes, use local modes (`scaffold` or `full`) which analyze git changes, or configure `includePatterns` to limit scope.

### Test Generation

**Q: How does the tool decide what to test?**
A: It analyzes PR diffs (or local git changes) to find modified functions, methods, and classes. It uses AST analysis to extract code structure.

**Q: What if generated tests fail?**
A: Kakarot CI automatically attempts to fix failing tests up to `maxFixAttempts` times (default: 3). If tests still fail after all attempts, they're posted as suggestions instead of being committed.

**Q: Can I review tests before they're committed?**
A: Yes, set `enableAutoCommit: false` in your config. Tests will be generated but not committed automatically.

**Q: How does scaffold mode differ from full mode?**
A: 
- **Scaffold**: Generates test structure only (describe/it blocks with TODO comments)
- **Full**: Generates complete tests with assertions
- **PR mode**: Full tests + GitHub integration (commits, PR comments)

**Q: Does it generate tests for existing code?**
A: By default, it only generates tests for changed code in PRs. In local modes, it analyzes git changes. You can configure `includePatterns` to target specific files.

### GitHub Integration

**Q: Do I need a GitHub token?**
A: Only if you're using PR mode or want to commit tests. For local modes (`scaffold`/`full`), no GitHub token is needed.

**Q: What permissions does the GitHub token need?**
A: For full functionality:
- `repo` scope (for commits and PR operations)
- Or in GitHub Actions: `contents: write` and `pull-requests: write` permissions

**Q: Can I use this in private repositories?**
A: Yes! Just provide a GitHub token with appropriate permissions.

**Q: What if my organization restricts GITHUB_TOKEN permissions?**
A: Use a Personal Access Token (PAT) with `repo` scope. See the [GitHub Actions Integration](#github-actions-integration) section for details.

**Q: How are PR comments formatted?**
A: PR comments include:
- Summary of generated tests
- Test results (passed/failed)
- Coverage metrics (if enabled)
- Coverage delta (change in coverage)

### Performance & Limits

**Q: How many tests can be generated per PR?**
A: Default limit is 50 (`maxTestsPerPR`). You can increase this, but be mindful of API rate limits and costs.

**Q: How long does test generation take?**
A: Depends on:
- Number of functions to test
- LLM provider response time
- Test execution time
- Fix loop iterations

Typically 1-5 minutes for a small PR, 10-20 minutes for larger PRs.

**Q: Does this use a lot of API tokens?**
A: Token usage depends on:
- Code complexity
- Number of functions
- Fix loop iterations
- Model used

Enable debug mode to see token usage per operation.

### Code Standards

**Q: Does it format generated code?**
A: Yes, by default it auto-detects and applies your project's code style (ESLint, Prettier, Biome). You can disable this via `formatGeneratedCode: false` or `lintGeneratedCode: false`.

**Q: What code style tools are supported?**
A: ESLint, Prettier, Biome, and TypeScript config. The tool auto-detects which ones you're using.

**Q: Can I disable code formatting?**
A: Yes, set `formatGeneratedCode: false` and `lintGeneratedCode: false` in config.

## Migration Guide

### Upgrading Between Versions

Kakarot CI follows semantic versioning. Breaking changes are documented in [CHANGELOG.md](CHANGELOG.md).

#### From v0.3.x to v0.4.x

**New Features**:
- Added `mode` option (`pr`, `scaffold`, `full`)
- Added `codeStyle` configuration options
- Added `customPrompts` for prompt customization

**Config Changes**:
- `mode` is now optional (defaults to `'pr'`)
- New `codeStyle` object with `autoDetect`, `formatGeneratedCode`, `lintGeneratedCode`
- New `customPrompts` object for custom prompt overrides

**Migration Steps**:
1. No breaking changes - existing configs continue to work
2. Optionally add `mode: 'pr'` to explicitly set PR mode
3. Optionally enable code standards integration:
```javascript
{
  codeStyle: {
    autoDetect: true,
    formatGeneratedCode: true,
    lintGeneratedCode: true
  }
}
```

#### From v0.2.x to v0.3.x

**Breaking Changes**:
- TypeScript config files (`.ts`) are no longer supported
- Use `.js` or `.json` config files instead

**Migration Steps**:
1. Rename `kakarot.config.ts` to `kakarot.config.js`
2. Remove TypeScript-specific syntax (type annotations, imports)
3. Use JSDoc comments for type hints:
```javascript
/** @type {import('@kakarot-ci/core').KakarotConfig} */
const config = { ... };
```

#### General Upgrade Tips

1. **Backup your config**: Before upgrading, save a copy of your config file
2. **Check CHANGELOG**: Review breaking changes in [CHANGELOG.md](CHANGELOG.md)
3. **Test in a branch**: Try the upgrade in a feature branch first
4. **Update dependencies**: Run `npm update @kakarot-ci/core`
5. **Verify config**: Ensure your config still works with the new version

### Config File Migration

If you need to migrate from one config format to another:

**From package.json to separate file**:
1. Copy `package.json` → `kakarotCi` field content
2. Create `kakarot.config.js` with that content
3. Remove `kakarotCi` from `package.json`

**From JSON to JavaScript**:
1. Copy `.kakarot-ci.config.json` content
2. Create `kakarot.config.js`
3. Convert JSON to JavaScript object syntax
4. Add JSDoc type hint if desired
5. Delete JSON file

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

**Note**: This project is maintained by a single person as a side project. While I do my best to respond to issues and review PRs, response times may vary. Your patience and understanding are appreciated!

## License

[BUSL-1.1](LICENSE)
