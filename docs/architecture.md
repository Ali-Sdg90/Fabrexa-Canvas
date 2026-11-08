# Architecture

Fabrexa Canvas is a modular Node.js process that coordinates three independent
systems: Telegram, an optional local Ollama model, and ComfyUI. Its architecture
keeps those integrations behind small services and gives one queue job ownership
of each complete generation lifecycle.

## Design goals

- Keep Telegram long polling responsive during long local inference.
- Allow only explicitly authorized Telegram accounts.
- Run only one GPU-heavy generation lifecycle at a time.
- Prevent Ollama and ComfyUI models from competing for VRAM.
- Preserve the existing ComfyUI workflow outside controlled runtime inputs.
- Fail with bounded timeouts and useful diagnostics.
- Keep credentials, checkpoint names, prompts, and local histories private.
- Make core behavior testable without Telegram, ComfyUI, Ollama, or a GPU.

## Component map

```text
src/app.js
  ├─ config/                  environment parsing and display metadata
  ├─ bot/                     Telegram middleware, handlers, and messages
  ├─ services/
  │    ├─ generation          end-to-end orchestration
  │    ├─ generation-queue    bounded single-worker FIFO queue
  │    ├─ gpu-handoff         ComfyUI/Ollama ownership transition
  │    ├─ comfyui             workflow validation and API integration
  │    ├─ ollama              local server and model lifecycle
  │    ├─ prompt-enhancement  scene prompt loading and output validation
  │    ├─ activity-log        operational history
  │    └─ user-data           preferences and conversation histories
  ├─ prompts/                 maintainable scene-director system prompt
  ├─ utils/                   errors, logging, seeds, and update helpers
  └─ workflows/               exported ComfyUI API workflow
```

`src/app.js` is the composition root. It validates configuration, constructs
services, initializes persistence and workflow state, creates the Telegram bot,
and installs graceful shutdown handlers.

## Startup lifecycle

```text
load and validate environment
  -> create redacting logger
  -> initialize activity and user data
  -> load API workflow and validate mappings
  -> load scene-director prompt when enabled
  -> register Telegram middleware and handlers
  -> start long polling
```

Startup stops before polling if a required secret is missing, a local-service
URL is unsafe, a JSON data file is malformed, a workflow mapping is invalid, or
the scene-director prompt cannot be loaded.

## Telegram request lifecycle

```text
Telegram update
  -> duplicate-update filter
  -> /start audit logging
  -> access allowlist
  -> mode or message handler
  -> prompt validation
  -> queue admission
  -> initial Telegram status
  -> handler returns
  -> guarded background completion task
```

Returning after queue admission avoids holding a Telegraf update handler open
for the duration of local inference. The background task owns subsequent status
edits, activity records, image upload, and user-facing failure handling.

## Direct generation lifecycle

```text
validated prompt and seed
  -> clone committed workflow
  -> inject prompt, checkpoint name, and mapped seeds
  -> submit to ComfyUI
  -> poll prompt history until complete, failed, or timed out
  -> select output from the mapped SaveImage node
  -> download image bytes
  -> edit final status and upload Telegram photo
```

The workflow is cloned with `structuredClone`, so one request cannot mutate the
in-memory source used by the next request.

## Enhanced generation lifecycle

```text
wait for ComfyUI to become idle
  -> request ComfyUI model cleanup
  -> verify practical VRAM release
  -> start or reuse local Ollama
  -> verify configured model is installed
  -> run scene-direction inference
  -> monitor ComfyUI queue during inference
  -> request Ollama model unload
  -> verify the model is no longer resident
  -> wait for ComfyUI ownership
  -> run the direct generation lifecycle with the enhanced prompt
```

If ComfyUI becomes busy during Ollama inference, the inference is aborted and
the Ollama unload path still runs. If unload cannot be verified, image
generation is blocked. This is a safety boundary, not only an optimization.

## Queue and backpressure

`GenerationQueue` is an in-process FIFO queue with one active worker. Its size
includes the active job and all waiting jobs. New work receives its position at
admission time, and requests beyond `GENERATION_QUEUE_MAX_SIZE` fail immediately
with a user-facing response.

The single-worker design is intentional for one local GPU. It also serializes
the enhanced-mode handoff, preventing overlapping cleanup or residency checks.

## Workflow boundary

`ComfyUIService` owns all workflow access. It validates the configured nodes and
inputs, clones the API JSON, and changes only:

- The mapped positive prompt input
- The mapped checkpoint input
- The primary seed input
- Any explicitly listed additional seed inputs

Checkpoint, negative prompt, sampler, scheduler, resolution, denoise, optional
CLIP skip, and custom-node behavior otherwise remain under workflow control.

## Persistence model

Fabrexa Canvas uses local JSON because its intended deployment is one trusted
workstation with a small authorized user set.

- Activity and conversation writes are serialized in process.
- Files are written to unique temporary paths and atomically renamed.
- Invalid existing JSON is rejected instead of silently overwritten.
- Per-user preferences and chat histories are separated by Telegram user ID.
- A combined history keeps authorized-account conversations in chronological
  order.

The process has no cross-machine locking. Running multiple bot processes against
the same data paths is unsupported.

## Error boundaries

Configuration, workflow, ComfyUI, Ollama, prompt enhancement, GPU handoff,
queue, timeout, activity-log, and user-data failures use distinct error types.
Telegram receives concise messages while structured logs retain diagnostic
context. Secrets are redacted before log fields are written.

## Shutdown behavior

`SIGINT` and `SIGTERM` close the queue to new work and stop Telegram polling.
The process also records unhandled promise rejections. Shutdown is graceful at
the polling boundary, but it does not cancel a job already submitted to ComfyUI
or delete an output produced by ComfyUI.
