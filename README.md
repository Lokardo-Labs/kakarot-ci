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

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

**Note**: This project is maintained by a single person as a side project. While I do my best to respond to issues and review PRs, response times may vary. Your patience and understanding are appreciated!

## License

[BUSL-1.1](LICENSE)
