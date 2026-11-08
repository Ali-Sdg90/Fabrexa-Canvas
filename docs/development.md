# Development and releases

## Project layout

```text
src/                    application source
  bot/                  Telegram middleware, handlers, and copy
  config/               validated configuration and display metadata
  prompts/              local scene-director prompt
  services/             orchestration, integrations, and persistence
  utils/                shared errors and helpers
  workflows/            ComfyUI API workflow and workflow notes
tests/                  unit and mocked integration tests
docs/                   project documentation
.github/workflows/      CI and release automation
```

## Local commands

| Command | Purpose |
| --- | --- |
| `npm.cmd install` | Install and update dependencies during development |
| `npm.cmd ci` | Reproduce the lockfile exactly on a clean install |
| `npm.cmd start` | Start the bot |
| `npm.cmd run dev` | Start with Node.js watch mode |
| `npm.cmd run lint` | Run ESLint |
| `npm.cmd test` | Run the Node.js test suite |
| `npm.cmd run check` | Run the complete local quality gate |
| `npm.cmd run release` | Run Semantic Release, intended for CI |

Do not run the release command locally against `main` unless you intentionally
want to publish a release and have configured suitable GitHub credentials.

## Test strategy

The suite uses Node.js's built-in test runner and dependency injection rather
than live external services. It covers:

- Telegram authorization, update deduplication, and handlers
- Required configuration, limits, booleans, URLs, and workflow mappings
- Queue ordering, capacity, shutdown, and background execution
- Workflow cloning and controlled runtime input injection
- ComfyUI submission, polling, completion, failure, timeout, and image retrieval
- Ollama startup, installed-model checks, inference options, and unload behavior
- GPU handoff success, contention, abort, and failure paths
- Prompt validation and enhanced-output normalization
- Atomic activity, preference, and conversation persistence
- Secret redaction and user-facing error mapping

These tests are deterministic and need no token, GPU, ComfyUI process, or Ollama
process. They should not be described as end-to-end hardware verification.

Run a focused test file while developing:

```powershell
node --test tests/gpu-handoff.test.js
```

Run the full gate before handing off a change:

```powershell
npm.cmd run check
git diff --check
```

## Making changes safely

### Configuration changes

Update all of the following together:

1. `.env.example`
2. `src/config/index.js`
3. Relevant service or handler code
4. Configuration and behavior tests
5. `docs/configuration.md` and any affected operational guide

Never edit or commit a personal `.env` as part of a configuration change.

### Workflow changes

1. Confirm the workflow generates correctly in ComfyUI first.
2. Export it in API format.
3. Keep the private checkpoint input blank when it should be injected at runtime.
4. Update `.env.example` mappings only when public node IDs changed.
5. Run workflow, configuration, and full project tests.
6. Perform a local hardware check before claiming the workflow works on a GPU.

### Telegram behavior changes

Keep long work outside Telegraf update handlers. A handler should validate,
queue, acknowledge, and return. The queued background task should own
generation, status edits, delivery, and final error handling.

## Continuous integration

The GitHub Actions workflow has two jobs:

```text
pull request or push to main
  -> npm ci
  -> npm run check
  -> release job on main only
  -> Semantic Release
  -> update package version and changelog when required
  -> commit package.json, package-lock.json, and CHANGELOG.md
  -> create version tag, release notes, and GitHub Release
```

The release job depends on the test job, checks out complete Git history, and
uses the repository-provided `GITHUB_TOKEN`. It does not publish the package to
npm. Release concurrency is serialized to prevent overlapping publish jobs.

The release pipeline uses these plugins in order:

1. `@semantic-release/commit-analyzer` selects the next version.
2. `@semantic-release/release-notes-generator` creates release notes.
3. `@semantic-release/changelog` updates `CHANGELOG.md`.
4. `@semantic-release/npm` writes the version to `package.json` and
   `package-lock.json` with npm publishing disabled.
5. `@semantic-release/git` creates the release commit on `main`.
6. `@semantic-release/github` publishes the tag and GitHub Release.

## Commit and release conventions

Semantic Release analyzes Conventional Commits on `main`:

| Commit | Result |
| --- | --- |
| `fix: handle stalled history polling` | Patch release |
| `feat: add another generation mode` | Minor release |
| Commit with `BREAKING CHANGE:` footer | Major release |
| `docs:`, `test:`, `refactor:`, `chore:` | No release by default |

Because this repository currently has no release tag, the first successful
release starts at `v1.0.0`. The mapping above controls subsequent versions, such
as `v1.0.1` for a fix and `v1.1.0` for a feature.

Examples:

```text
feat(queue): report the waiting position
fix(ollama): verify unload before ComfyUI resumes
docs(readme): explain the local GPU handoff
```

The generated commit uses this subject:

```text
chore(release): bump version to <version>
```

It contains the updated manifest, lockfile, and changelog. The workflow token
therefore needs `contents: write`, and repository rules must allow the GitHub
Actions bot to push this release commit to `main`.

## Review checklist

- The change stays inside its intended feature boundary.
- New external behavior has tests.
- Secrets and personal local data remain untracked.
- User-facing Telegram text matches the actual behavior.
- Documentation and `.env.example` match configuration validation.
- `npm.cmd run check` passes.
- `git diff --check` reports no whitespace errors.
- Hardware or live-integration claims are supported by an actual local test.
