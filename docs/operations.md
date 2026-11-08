# Operations and troubleshooting

Fabrexa Canvas is intended to run on the same trusted Windows workstation as
ComfyUI and optional Ollama. It uses Telegram long polling and does not require
an inbound HTTP port.

## Startup checklist

Before starting the bot:

1. Confirm `.env` exists and contains no placeholder values for required fields.
2. Confirm the configured ComfyUI workflow file exists.
3. Start ComfyUI with the arguments and custom nodes required by the workflow.
4. Confirm ComfyUI is available at `http://127.0.0.1:8188`.
5. If enhanced mode is enabled, confirm the configured model appears in
   `ollama list`.
6. Run `npm.cmd start`.

Expected startup logs include initialization of the activity log, user data,
workflow mappings, scene prompt when enabled, and Telegram long polling.
Ollama starts lazily, not during normal application startup.

## Health checks

### Application process

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like '*Fabrexa-Canvas*src/app.js*' } |
  Select-Object ProcessId, CommandLine
```

Run only one Fabrexa Canvas process against a set of JSON data paths.

### ComfyUI

```powershell
Invoke-RestMethod http://127.0.0.1:8188/queue
Invoke-RestMethod http://127.0.0.1:8188/system_stats
```

The queue response shows active and pending ComfyUI work. Check it before
restarting the bot or diagnosing a GPU handoff timeout.

### Ollama

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags
Invoke-RestMethod http://127.0.0.1:11434/api/ps
```

`/api/tags` shows installed models. `/api/ps` shows currently resident models
and is the authoritative check after enhanced inference.

## Runtime data

Default local files are:

```text
data/
  activity-log.json
  global-memory.json
  users/
    <telegram-id>/
      preferences.json
      chats.json
```

### Activity log

The activity log records `/start` attempts, mode changes, accepted prompts, and
successful generations. Generation entries include the original and final
prompts, mode, seed, ComfyUI prompt ID, output filename, duration, and stage
timings where available.

### Per-account data

Each authorized Telegram ID receives a preferences file and complete local chat
history. Preferences store the selected generation mode. Histories include user
messages, bot messages, generation statuses, delivery events, and metadata.

### Global memory

`global-memory.json` stores the same authorized-account conversation entries in
one chronological array. It is local persistence for future features; it is not
sent to a remote database by this project.

All default paths and temporary atomic-write files are ignored by Git.

## Backup and restore

Stop the bot before copying mutable JSON files. Back up the entire `data`
directory and the ignored `.env` to an encrypted location appropriate for the
sensitivity of Telegram identities and prompts.

To restore:

1. Stop all Fabrexa Canvas processes.
2. Restore `.env` and the `data` directory to their configured paths.
3. Validate that every JSON file is complete and parseable.
4. Start one bot process and inspect initialization logs.

The app rejects malformed JSON instead of replacing it with an empty file.

## Graceful shutdown

Use `Ctrl+C` in the active terminal or send `SIGTERM`. The bot closes the queue
to new work and stops Telegram polling. A ComfyUI job already submitted to the
local server may continue after the Node.js process stops; inspect `/queue`
before retrying the same request.

## Enhanced-mode hardware check

Mocked tests cannot prove real GPU residency behavior. After changing the
workflow, model, or handoff logic:

1. Leave the Ollama desktop UI closed when testing auto-start.
2. Start ComfyUI and Fabrexa Canvas.
3. Send `/start`, select Gemma, and submit a representative scene.
4. Confirm Telegram progresses through scene understanding, image preparation,
   image generation, and delivery.
5. Confirm the final prompt differs only when enhancement succeeds.
6. Run `Invoke-RestMethod http://127.0.0.1:11434/api/ps` after delivery.
7. Confirm the configured scene model is no longer resident.
8. Inspect `data/activity-log.json` for `comfyReleaseMs`, `gemmaInferenceMs`,
   `ollamaUnloadMs`, `comfyGenerationMs`, and `totalMs`.

The handoff verifies queue state and practical VRAM release. It does not claim
that every driver cache or CUDA context allocation reaches zero.

## Troubleshooting

### Configuration validation fails

Compare `.env` with `.env.example`. Required values must not be empty. Boolean
values must be `true` or `false`, numeric values must remain inside validated
ranges, and service URLs must stay on loopback hosts.

### Workflow file cannot be loaded

Confirm `COMFYUI_WORKFLOW_PATH` points to an API-format JSON file. Relative paths
resolve from the project root. A UI-format workflow does not satisfy the API
structure expected by ComfyUI submission.

### A mapped node or input is missing

Reopen the exported workflow JSON and copy exact object keys and input property
names. Node titles and canvas positions are not IDs. Confirm the output mapping
targets a real `SaveImage` node and the checkpoint mapping targets
`CheckpointLoaderSimple`.

### ComfyUI is unavailable

Confirm the local process is running and `/queue` responds. Fabrexa Canvas
rejects remote URLs by design. A network failure is reported to Telegram without
stopping long polling.

### The queue is full

Wait for an active request to finish. The queue limit includes the active job.
Do not increase it to improve GPU throughput; only one job runs at a time.

### Ollama does not start automatically

Run `ollama --version`. If it is not on `PATH`, set
`OLLAMA_EXECUTABLE_PATH` to the full `ollama.exe` path. Check that another
process is not incorrectly occupying port `11434`.

### The configured model is unavailable

Run `ollama list` and compare the exact model name with `OLLAMA_MODEL`. The app
never pulls or renames a model automatically.

### GPU handoff cannot be verified

Check that no manual ComfyUI job is running or queued. Inspect `/system_stats`
and Ollama `/api/ps`. Increase cleanup or unload timeouts only when the machine
is healthy but consistently slower than the configured limit.

### Enhanced output is rejected

Inspect local logs and confirm the model can follow the scene-director prompt.
The response must be non-empty, non-conversational, and within the configured
length. Raw fallback is intentionally limited to this validation failure and
does not bypass infrastructure or unload safety.

### Generation fails or times out

Inspect the ComfyUI console and prompt history for the failing node. A timeout
does not delete the ComfyUI job or its output. Check `/queue` before sending the
same request again.

### JSON data cannot be loaded

Do not replace the file immediately. Preserve it for diagnosis, validate the
JSON, and restore the newest known-good backup. The app refuses to overwrite an
invalid existing activity log, preference file, or history.
