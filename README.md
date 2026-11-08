# Fabrexa Canvas

[![CI](https://github.com/Ali-Sdg90/Fabrexa-Canvas/actions/workflows/ci.yml/badge.svg)](https://github.com/Ali-Sdg90/Fabrexa-Canvas/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/Ali-Sdg90/Fabrexa-Canvas)](https://github.com/Ali-Sdg90/Fabrexa-Canvas/releases)
[![Node.js](https://img.shields.io/badge/Node.js-22.14%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Fabrexa Canvas is a private, self-hosted Telegram image-generation bot built
around a local ComfyUI workflow. It accepts a scene description in Telegram,
optionally refines it with a local Ollama model, coordinates GPU ownership
between the language and image models, and returns the generated image with its
final prompt and settings.

The core challenge is not the image-generation API call. It is keeping Telegram
responsive while long-running local jobs move safely through validation,
queuing, prompt enhancement, GPU cleanup, ComfyUI execution, output retrieval,
delivery, and persistent activity tracking.

## What this project demonstrates

- **Long-running job orchestration:** Telegram updates return promptly while a
  guarded background task owns the complete generation lifecycle.
- **Safe GPU handoff:** ComfyUI models are released before Ollama inference, and
  the Ollama model must be verified as unloaded before ComfyUI can resume.
- **Controlled concurrency:** A bounded single-worker FIFO queue prevents local
  models from competing for the same GPU and gives users a clear queue position.
- **Workflow integrity:** The committed ComfyUI API workflow is cloned per
  request. Only explicitly mapped prompt, checkpoint, and seed inputs change.
- **Local-first privacy:** Telegram access is allowlisted, AI services are
  restricted to loopback addresses, secrets stay in `.env`, and generated
  images are not duplicated inside the project.
- **Operational visibility:** Structured logs, per-account histories, a global
  conversation history, generation timings, seeds, and activity events remain
  available locally for diagnosis.
- **Release discipline:** Pull requests and `main` pushes run automated checks;
  successful `main` builds let Semantic Release update the project version and
  changelog, commit the release, tag it, and publish the GitHub Release.

## System flow

```text
Telegram prompt
  -> access, deduplication, and prompt validation
  -> bounded FIFO generation queue
  -> direct mode or local Ollama scene direction
  -> verified GPU handoff
  -> cloned ComfyUI workflow with runtime input injection
  -> completion polling and in-memory image retrieval
  -> Telegram status update and photo delivery
  -> local activity and conversation records
```

### Direct mode

The validated prompt goes directly to the configured ComfyUI workflow. This is
the shortest path and does not start Ollama or perform a language-model handoff.

### Enhanced mode

Gemma acts as a local scene director. Fabrexa Canvas releases ComfyUI models,
runs the prompt through Ollama, validates the returned image prompt, verifies
that the model has left memory, and then returns control to ComfyUI. Unsafe or
unverifiable transitions fail closed instead of starting the next GPU stage.

## Key engineering decisions

### Keep Telegram polling responsive

Telegraf update handlers should not wait for a complete local generation. The
handler validates and queues the request, sends the initial status, and returns.
A guarded background task continues the job and edits the same Telegram status
through each stage.

### Treat the workflow as a controlled input

Node IDs differ between ComfyUI workflows, so they are configuration rather than
hard-coded assumptions. Startup validates the positive prompt, checkpoint,
seed, optional additional seeds, and final `SaveImage` mappings before Telegram
polling begins.

### Prefer explicit failure over unsafe fallback

Infrastructure, model-startup, GPU-cleanup, and unload failures do not silently
continue. Optional raw-prompt fallback applies only when the local language
model returns unusable text and safe unload has still been verified.

### Avoid unnecessary image copies

ComfyUI keeps the authoritative output in its configured output directory. The
bot downloads that output into memory for Telegram delivery and does not create
a second image file inside the repository.

## Technology

| Area | Choice |
| --- | --- |
| Runtime | Node.js 22, ES Modules |
| Telegram integration | Telegraf long polling |
| Image generation | Local ComfyUI HTTP API workflow |
| Prompt enhancement | Local Ollama model, optional per account |
| HTTP client | Axios |
| Configuration | dotenv with startup validation |
| Persistence | Local JSON with serialized, atomic writes |
| Quality | ESLint and Node.js built-in test runner |
| Delivery | GitHub Actions and Semantic Release |

## Requirements

- Windows with Node.js 22.14 or newer
- A Telegram bot token and the numeric IDs of authorized users
- A working ComfyUI installation available on localhost
- A ComfyUI workflow exported in API format
- The checkpoint and custom nodes required by that workflow
- Ollama and a locally installed model only for enhanced mode

Fabrexa Canvas is designed for a trusted local workstation. It is not a hosted
multi-tenant service and does not expose ComfyUI or Ollama to the network.

## Quick start

```powershell
git clone https://github.com/Ali-Sdg90/Fabrexa-Canvas.git
cd Fabrexa-Canvas
npm.cmd install
Copy-Item .env.example .env
```

Then:

1. Add the Telegram token and allowed user IDs to `.env`.
2. Export the working ComfyUI API workflow to
   `src/workflows/workflow_api.json`.
3. Configure the workflow node mappings and private checkpoint name in `.env`.
4. Start ComfyUI with the arguments required by the workflow.
5. Run the bot:

   ```powershell
   npm.cmd start
   ```

Open the bot in Telegram, send `/start`, choose **Gemma** or **Direct** mode,
and then send a text description of the image.

The complete procedure is documented in [Setup](./docs/setup.md) and
[Configuration](./docs/configuration.md).

## Telegram experience

For every accepted request, the bot shows the selected mode, seed, workflow
settings, queue position when applicable, and the prompt currently being used.
Enhanced requests progress through scene understanding, GPU preparation, and
image generation. The final status contains the actual prompt sent to ComfyUI
and the total duration before the image is uploaded.

Generation work stays in the background, so Telegram polling can continue to
handle new updates while a long image request is running.

## Quality and testing

```powershell
npm.cmd run check
```

The quality gate runs ESLint and the automated test suite. Tests cover access
control, configuration, queue behavior, workflow injection, ComfyUI polling,
Ollama lifecycle management, GPU handoff, Telegram handlers, persistence,
logging redaction, failures, and timeouts without requiring a real Telegram
token, GPU, ComfyUI process, or Ollama process.

Hardware behavior still requires a local end-to-end check. Mocked tests verify
the contracts and failure paths, not the behavior of a particular GPU driver,
checkpoint, or custom ComfyUI node.

## Documentation

| Guide | Contents |
| --- | --- |
| [Documentation index](./docs/README.md) | Guide map and suggested reading paths |
| [Setup](./docs/setup.md) | Installation, workflow export, and first run |
| [Configuration](./docs/configuration.md) | Environment variables and safe defaults |
| [Architecture](./docs/architecture.md) | Components, request lifecycle, and design boundaries |
| [Development and releases](./docs/development.md) | Local workflow, testing, CI, and Semantic Release |
| [Operations](./docs/operations.md) | Runtime checks, local data, backup, and troubleshooting |
| [Security and privacy](./docs/security.md) | Trust model, secret handling, and local-data boundaries |
| [Changelog](./CHANGELOG.md) | Versioned changes generated from Conventional Commits |

## Current scope

- Text-to-image requests only
- One active generation at a time
- Telegram long polling rather than webhooks
- Local JSON persistence rather than a database
- Windows-first Ollama auto-start behavior
- No automatic model or checkpoint downloads
- No hosted deployment or remote ComfyUI support

These boundaries are deliberate. They keep the project focused on a reliable,
private workflow for one local GPU while leaving room for presets,
regeneration, image-to-image workflows, and character-aware pipelines later.

## License

Licensed under the [MIT License](./LICENSE).
