# Kakarot CI — Product Description & Development Plan

## Overview
Kakarot CI is an AI-powered continuous integration tool that automatically generates, runs, and commits high-quality unit tests for code changes in pull requests. It runs entirely inside CI (GitHub Actions), requires no backend server, and integrates into any TypeScript or JavaScript project using a lightweight config file—similar to tools like semantic-release, danger.js, and commitlint.
Kakarot CI eliminates the burden of writing and maintaining unit tests while ensuring that new or modified code is always accompanied by relevant, passing test coverage.

## Product Description
Kakarot CI analyzes the diff of a pull request, identifies changed TypeScript/JavaScript functions, and uses LLMs to generate unit tests (Jest or Vitest) targeted at those changes. It then executes those tests inside the project's existing CI environment.
If generated tests pass:
- Kakarot CI commits them to the PR branch
- Adds a PR comment summarizing what was added

If tests fail:
- Kakarot attempts up to N fix iterations
- If still failing, Kakarot posts the tests as a suggested snippet instead of committing

Kakarot CI runs as:
- An NPM package (@kakarot-ci/core)
- A CLI command (kakarot-ci run-pr)
- A GitHub Action
- A project configuration file

All test execution happens inside the user's own CI runner — no external code hosting or backend infrastructure required.

## Goals

### Primary Product Goals
- Automatically generate unit tests for code changes in PRs.
- Increase test coverage during normal development without adding friction.
- Improve developer velocity by eliminating repetitive test writing.
- Ensure reliability via AST-aware analysis, test execution (Jest/Vitest), and fix loops.
- Provide a fast, zero-config onboarding experience.

### Business Goals
- Provide a simple, low-maintenance tool that integrates seamlessly into developer workflows.
- Expand naturally into future offerings (dashboard, insights, enterprise features).

## High-Level Architecture

```
Repository
 ├── kakarot.config.ts           # Project-level config
 ├── .github/workflows/ci.yml    # GitHub Action that runs Kakarot CI
 ├── src/**/*.ts                 # User code
 ├── __tests__/**/*.test.ts      # Existing tests
 └── node_modules/@kakarot-ci/core

GitHub Action → CLI → Core Engine
    → GitHub API (fetch diffs)
    → AST Analysis
    → LLM (test generation)
    → Test Execution (Jest/Vitest)
    → Commit Results
    → PR Comment Summary
```

### Components
- **Core Engine**: business logic, AST, diff parsing, LLM prompts, test execution (Jest/Vitest).
- **CLI**: orchestrates single PR runs.
- **GitHub Action**: wraps CLI for easy installation.
- **Config File**: controls behavior and model usage.

## Development Plan (Epics)

### Epic 1 — Core Package & Configuration System
**Description**
Foundation layer that provides configuration, shared types, logging utilities, and structure for the entire system.

**Tasks**
- [ ] Scaffold @kakarot-ci/core package
- [ ] Add TypeScript, bundler, ESLint
- [ ] Implement config loader from:
  - [ ] kakarot.config.ts
  - [ ] .kakarot-ci.config.js/json
  - [ ] package.json → kakarotCi
- [ ] Define KakarotConfig interface
- [ ] Add schema validation (Zod)
- [ ] Add debug/logging utilities

### Epic 2 — CLI Runner (kakarot-ci run-pr)
**Description**
Provides the core entrypoint used in CI, orchestrating the entire workflow.

**Tasks**
- [ ] Create CLI binary
- [ ] Support run-pr command
- [ ] Parse required CI environment variables
- [ ] Load PR event JSON
- [ ] Build execution context (CICtx)
- [ ] Call runPullRequest() from core package
- [ ] Add structured logging and exit code handling

### Epic 3 — GitHub Integration (Octokit)
**Description**
Interact with GitHub APIs to fetch diffs, file contents, commit updates, and comment on PRs.

**Tasks**
- [ ] Octokit wrapper
- [ ] getPullRequest()
- [ ] listPullRequestFiles() (with patches)
- [ ] getFileContents(ref, path)
- [ ] commitOrUpdateFile()
- [ ] commentPR()
- [ ] Add retry + rate-limit logic

### Epic 4 — Diff Analysis & AST Extraction
**Description**
Reads the PR diff to identify exactly which functions changed and extract relevant code for test generation.

**Tasks**
- [ ] Parse unified diff hunks
- [ ] Convert hunks to changed line ranges
- [ ] Filter .ts / .tsx / .js / .jsx files
- [ ] Fetch file contents
- [ ] Use TypeScript compiler API to:
  - [ ] Parse file AST
  - [ ] Identify changed functions/methods
  - [ ] Extract code snippets
  - [ ] Extract minimal context
  - [ ] Detect existing related test files
- [ ] Create TestTarget[] list

### Epic 5 — LLM Test Generation Engine
**Description**
Generate unit tests (Jest or Vitest) using LLMs through structured prompts and strict output parsing.

**Tasks**
- [ ] LLM provider wrapper (OpenAI, Anthropic, Google)
- [ ] Build test generation prompts
- [ ] Parse LLM output
- [ ] Validate test suite structure (Jest/Vitest)
- [ ] Implement fix-loop prompt builder

### Epic 6 — Test Execution & Fix Loop
**Description**
Executes generated tests inside CI and retries failures using model refinements. Supports both Jest and Vitest.

**Tasks**
- [ ] Detect test framework (Jest/Vitest) from package.json
- [ ] Detect package manager
- [ ] Write generated tests to disk
- [ ] Run tests programmatically with JSON output:
  - [ ] Jest runner with JSON reporter
  - [ ] Vitest runner with JSON reporter
- [ ] Parse results (unified format)
- [ ] For failures:
  - [ ] Build failure prompt
  - [ ] Generate fixes
  - [ ] Rewrite test
  - [ ] Re-run tests
- [ ] Track success/failure across all targets

### Epic 6.5 — Coverage Collection & LLM-Generated Reports
**Description**
Collect test coverage data and use LLMs to generate human-readable coverage reports and summaries.

**Tasks**
- [ ] Run tests with coverage enabled (Jest/Vitest)
- [ ] Parse coverage reports (JSON format)
- [ ] Extract coverage metrics:
  - [ ] Line coverage
  - [ ] Branch coverage
  - [ ] Function coverage
  - [ ] Statement coverage
- [ ] Calculate coverage deltas (before/after)
- [ ] Build LLM prompt with:
  - [ ] Coverage metrics
  - [ ] Test results
  - [ ] Functions tested
  - [ ] Coverage changes
- [ ] Generate human-readable summary via LLM
- [ ] Format summary as PR comment (markdown)
- [ ] Include coverage badges/visualizations if applicable

### Epic 7 — GitOps: Auto-Commit & PR Comments
**Description**
Commits passing tests to the PR branch and posts LLM-generated coverage summaries.

**Tasks**
- [ ] Apply test files to repo
- [ ] Commit changes using GitHub API (batch commit)
- [ ] Support commit strategies:
  - [ ] Direct commit to PR branch
  - [ ] Create branch + PR for suggested changes
- [ ] Integrate with Epic 6.5 for coverage summary
- [ ] Post PR comment with LLM-generated summary

### Epic 8 — GitHub Action Wrapper
**Description**
Creates a turnkey installation flow for users via GitHub Actions.

**Tasks**
- [ ] Create action.yml
- [ ] Provide api_key input (user-supplied LLM API key)
- [ ] Wrap CLI in GitHub Action runtime
- [ ] Publish action
- [ ] Add example workflow YAML

### Epic 9 — Documentation & Developer Experience
**Description**
Make onboarding, debugging, and usage intuitive.

**Tasks**
- [ ] Comprehensive README
- [ ] Example kakarot.config.ts
- [ ] Example GitHub Action workflow
- [ ] Debug mode (KAKAROT_DEBUG=1)
- [ ] Clean, semantic-release–style log formatting

### Epic 10 — Launch & Marketing
**Description**
Finalize assets for public release and team adoption.

**Tasks**
- [ ] Landing page section (kakarot.io)
- [ ] Quick-start guide
- [ ] Example repo demonstrating usage
- [ ] Publish NPM package
- [ ] Publish GitHub Action
- [ ] Announcement post

## 7-Week Roadmap (10–15 Hours/Week)
- **Week 1** — Core package, config, CLI foundation
- **Week 2** — GitHub integration (PR metadata, diffs)
- **Week 3** — AST extraction & diff mapping
- **Week 4** — LLM test generation
- **Week 5** — Test execution & fix loop (Jest/Vitest)
- **Week 5.5** — Coverage collection & LLM reports
- **Week 6** — Auto-commit, PR comments, GitHub Action
- **Week 7** — Docs, launch prep

## Note
This repository contains the **core package** (@kakarot-ci/core) only. Other components (CLI, GitHub Action) will be in separate repositories.
