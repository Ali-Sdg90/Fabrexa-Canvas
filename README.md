# Fabrexa Canvas

Fabrexa Canvas is a private, self-hosted Telegram image-generation bot for a
locally running ComfyUI instance. Send a text prompt in Telegram, and the bot
queues the request, runs the existing ComfyUI API workflow, and returns the
result as a Telegram photo.

The project is intentionally small and local-first. It uses Telegram long
polling, keeps ComfyUI on localhost, and does not create duplicate image files.

## Features

- Private access through one allowed Telegram user ID
- FIFO queue with one active generation and a bounded waiting list
- Direct prompt and random-seed injection into an existing API workflow
- Optional local Gemma scene direction for stories and complex multi-subject scenes
- Automatic background Ollama startup on Windows, with no desktop UI required
- Sequential ComfyUI-to-Ollama-to-ComfyUI GPU handoff with bounded verification
- Explicit workflow node mappings validated during startup
- ComfyUI completion, failure, and timeout detection
- Telegram photo delivery with a linked Fabrexa Canvas attribution
- Local JSON activity history for starts, prompts, and generated filenames
- Periodic `typing` activity while ComfyUI is working
- Graceful polling shutdown and structured diagnostic logs
- Automated tests that do not need Telegram, ComfyUI, or a GPU

Fabrexa Canvas changes only the positive prompt and mapped seed inputs. It does
not alter the configured checkpoint, negative prompt, sampler, scheduler,
resolution, or other workflow settings.

## Technology

- Node.js 22 or newer, using ES Modules
- Telegraf
- Axios
- dotenv
- Node's built-in test runner

## Architecture

```text
src/
  app.js                         Application composition and lifecycle
  bot/
    bot.js                       Telegram middleware and routes
    handlers/                    /start and image request handling
    messages.js                 User-facing English copy
  config/
    index.js                     Environment parsing and validation
    generation.config.js        Display-only generation metadata
  services/
    activity-log.service.js      Local JSON activity history
    comfyui.service.js           Workflow and ComfyUI API integration
    generation-queue.service.js  Bounded single-worker FIFO queue
    generation.service.js        End-to-end generation orchestration
    gpu-handoff.service.js       Sequential GPU-stage coordination
    ollama.service.js            Local server, model inference and unload lifecycle
    prompt-enhancement.service.js  Scene prompt loading and output validation
    prompt.service.js            Incoming Telegram prompt validation
  prompts/
    scene-director.txt           Maintainable Gemma system prompt
  utils/                         Errors, logging, seed and update utilities
  workflows/                     Place the exported API workflow here
tests/                           Unit and mocked integration tests
```

The Telegram layer never edits workflow data. One `GenerationQueue` job owns
the entire enhancement, cleanup, image generation, retrieval, and delivery
pipeline. `GenerationService` coordinates the stages, while `ComfyUIService`
owns workflow cloning, mapping validation, ComfyUI requests, completion polling,
and image retrieval. After a request is validated, the Telegram update handler
returns immediately while the queued job continues in a guarded background
task. This keeps long polling responsive and avoids Telegraf's per-update
90-second timeout during local generation.

When enhancement is enabled, the sequence is intentionally serial:

```text
ComfyUI idle -> unload ComfyUI models -> Gemma inference -> verify Gemma unload
-> submit the existing ComfyUI workflow -> retrieve and send the photo
```

The Ollama server may remain running because the server itself is lightweight.
The configured Gemma model is explicitly unloaded and checked through Ollama's
running-model API before ComfyUI is allowed to start.

## Requirements

- Windows with Node.js 22+
- A Telegram bot token from BotFather
- Your numeric Telegram user ID
- ComfyUI running locally at `http://127.0.0.1:8188`
- The working ComfyUI workflow exported in API format
- The existing checkpoint and custom nodes required by that workflow
- For prompt enhancement: Ollama for Windows and the configured local model

The current display metadata follows the committed workflow settings without
exposing the private checkpoint name:

| Setting | Value |
| --- | --- |
| Resolution | 896 x 1152 |
| Steps | 8 |
| CFG | 1.1 |
| Sampler | LCM |
| Scheduler | Karras |

These values are not written into the workflow. The exported workflow remains
the source of truth, including the existing negative prompt, optional CLIP skip, denoise,
batch size, SaveImage configuration, and `--fp32-vae` launch requirement.

## Installation

```powershell
git clone <your-repository-url>
cd Fabrexa-Canvas
npm.cmd install
Copy-Item .env.example .env
```

Do not commit `.env`. It is ignored by Git.

## Export the ComfyUI API workflow

The repository deliberately does not contain a fabricated workflow. Export the
workflow that already generates correct images on your computer:

1. Open the working workflow in ComfyUI.
2. Confirm it still generates correctly and still includes its SaveImage node.
3. Enable developer options in ComfyUI settings if the API export option is not
   visible.
4. Choose **Save (API Format)** or **Export (API)**, depending on your ComfyUI
   version.
5. Save the JSON as `src/workflows/workflow_api.json`.

The normal UI workflow JSON is not interchangeable with the API-format prompt
JSON. An API workflow is an object keyed by node IDs, and each node contains
`class_type` and `inputs`.

## Identify the workflow mappings

Open `workflow_api.json` in a text editor and find these four nodes:

1. **Positive prompt node:** Find the text-encoding node whose `inputs.text`
   contains the positive prompt. Copy its object key as
   `COMFYUI_POSITIVE_PROMPT_NODE_ID`. In most workflows its input name is
   `text`.
2. **Checkpoint node:** Find the `CheckpointLoaderSimple` node. Store its object
   key in `COMFYUI_CHECKPOINT_NODE_ID`, its input name (normally `ckpt_name`) in
   `COMFYUI_CHECKPOINT_INPUT`, and the private checkpoint filename in
   `COMFYUI_CHECKPOINT_NAME` inside `.env` only.
3. **Seed node:** Find the sampler or noise node whose input contains the seed.
   Copy its object key as `COMFYUI_SEED_NODE_ID`. Copy the exact input name,
   commonly `seed` or `noise_seed`, as `COMFYUI_SEED_INPUT`.
   If another processing node also has an independent seed, list it as a
   `nodeId:inputName` pair in `COMFYUI_ADDITIONAL_SEED_MAPPINGS`.
4. **SaveImage node:** Find the final node whose `class_type` is `SaveImage`. Copy its
   object key as `COMFYUI_SAVE_IMAGE_NODE_ID`.

Node IDs are workflow-specific and must not be guessed. The application checks
all mappings before Telegram polling starts and reports the exact missing node
or input.

Example mapping shape only, using your real IDs:

```env
COMFYUI_POSITIVE_PROMPT_NODE_ID=your-positive-node-id
COMFYUI_POSITIVE_PROMPT_INPUT=text
COMFYUI_CHECKPOINT_NODE_ID=your-checkpoint-node-id
COMFYUI_CHECKPOINT_INPUT=ckpt_name
COMFYUI_CHECKPOINT_NAME=your-private-checkpoint-filename.safetensors
COMFYUI_SEED_NODE_ID=your-seed-node-id
COMFYUI_SEED_INPUT=seed
COMFYUI_ADDITIONAL_SEED_MAPPINGS=optional-node-id:seed
COMFYUI_SAVE_IMAGE_NODE_ID=your-save-image-node-id
```

## Enable local scene direction

Prompt enhancement is opt-in in `.env.example`. Install Ollama for Windows once
and make sure the configured model already exists locally. Fabrexa Canvas never
downloads a model automatically.

Check the installation and local model list:

```powershell
ollama --version
ollama list
```

If the intended model is not listed, install it explicitly once:

```powershell
ollama pull hf.co/mradermacher/Gemma-The-Writer-9B-HERETIC-Uncensored-Abliterated-i1-GGUF:Q6_K
```

Then set:

```env
PROMPT_ENHANCEMENT_ENABLED=true
OLLAMA_MODEL=hf.co/mradermacher/Gemma-The-Writer-9B-HERETIC-Uncensored-Abliterated-i1-GGUF:Q6_K
OLLAMA_AUTO_START=true
OLLAMA_EXECUTABLE_PATH=ollama
```

`OLLAMA_EXECUTABLE_PATH` can also be the full path to `ollama.exe`. At the first
enhanced request, the app probes the local HTTP endpoint. If it is unavailable,
the app starts `ollama serve` as a hidden background process and waits for API
readiness. It reuses an already-running server and does not stop an externally
managed one. Set `PROMPT_ENHANCEMENT_ENABLED=false` to restore the direct-prompt
pipeline with no Ollama calls or GPU handoff work.

The system prompt lives in `src/prompts/scene-director.txt`. It instructs Gemma
to choose one visually coherent still frame, preserve subjects and constraints,
and return only an English positive image prompt. The response is normalized and
validated before it reaches ComfyUI; empty, conversational, refusal, malformed,
or oversized output is rejected without starting image generation.

## Environment variables

Copy `.env.example` to `.env`, then fill in the blank values.

| Variable | Required | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Yes | Token issued by BotFather |
| `ALLOWED_TELEGRAM_USER_ID` | Yes | Only Telegram account allowed to use the bot |
| `COMFYUI_BASE_URL` | Yes | Local ComfyUI URL; remote hosts are rejected |
| `COMFYUI_WORKFLOW_PATH` | Yes | API workflow path, relative to the project root or absolute |
| `COMFYUI_CHECKPOINT_NAME` | Yes | Private local checkpoint filename; keep it only in `.env` |
| `COMFYUI_POSITIVE_PROMPT_NODE_ID` | Yes | Positive text node ID |
| `COMFYUI_POSITIVE_PROMPT_INPUT` | Yes | Positive text input name |
| `COMFYUI_CHECKPOINT_NODE_ID` | Yes | Checkpoint loader node ID |
| `COMFYUI_CHECKPOINT_INPUT` | Yes | Checkpoint filename input; normally `ckpt_name` |
| `COMFYUI_SEED_NODE_ID` | Yes | Sampler/noise seed node ID |
| `COMFYUI_SEED_INPUT` | Yes | Seed input name |
| `COMFYUI_ADDITIONAL_SEED_MAPPINGS` | No | Additional `nodeId:inputName` seed mappings, comma-separated |
| `COMFYUI_SAVE_IMAGE_NODE_ID` | Yes | SaveImage node ID used for delivery |
| `COMFYUI_POLL_INTERVAL_MS` | No | History polling interval; default `2000` |
| `COMFYUI_TIMEOUT_MS` | No | Whole-generation timeout; default `240000` |
| `COMFYUI_REQUEST_TIMEOUT_MS` | No | Individual HTTP timeout; default `10000` |
| `COMFYUI_IDLE_TIMEOUT_MS` | No | Maximum wait for unrelated ComfyUI work to finish; default `300000` |
| `COMFYUI_CLEANUP_TIMEOUT_MS` | No | Maximum wait to verify pre-Gemma VRAM cleanup; default `30000` |
| `COMFYUI_CLEANUP_POLL_INTERVAL_MS` | No | Queue and VRAM check interval during cleanup; default `1000` |
| `COMFYUI_CLEANUP_MIN_RELEASE_MB` | No | Minimum observed VRAM release accepted by cleanup; default `64` |
| `COMFYUI_CLEANUP_FREE_RATIO` | No | Free-VRAM ratio also accepted as ready; default `0.7` |
| `COMFYUI_CLEANUP_STABLE_SAMPLES` | No | Stable VRAM samples required before Gemma starts; default `2` |
| `PROMPT_ENHANCEMENT_ENABLED` | No | Enables the full local Gemma pipeline; default `false` |
| `PROMPT_ENHANCEMENT_FALLBACK_TO_RAW` | No | Allows raw fallback only for unusable Gemma text; default `false` |
| `PROMPT_ENHANCEMENT_MAX_LENGTH` | No | Maximum validated Gemma prompt length; default `2400` |
| `OLLAMA_BASE_URL` | No | Local Ollama endpoint; default `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | When enabled | Exact locally installed scene model name |
| `OLLAMA_AUTO_START` | No | Starts `ollama serve` when needed; default `true` |
| `OLLAMA_EXECUTABLE_PATH` | No | Command or full path for `ollama.exe`; default `ollama` |
| `OLLAMA_STARTUP_TIMEOUT_MS` | No | Bounded API-readiness wait; default `30000` |
| `OLLAMA_REQUEST_TIMEOUT_MS` | No | Ollama HTTP/inference timeout; default `180000` |
| `OLLAMA_UNLOAD_TIMEOUT_MS` | No | Bounded model-unload verification; default `30000` |
| `OLLAMA_POLL_INTERVAL_MS` | No | Ollama and handoff polling interval; default `500` |
| `OLLAMA_SYSTEM_PROMPT_PATH` | No | Scene-director prompt file path |
| `OLLAMA_TEMPERATURE` | No | Scene-director sampling temperature; default `0.35` |
| `OLLAMA_TOP_P` | No | Scene-director nucleus sampling value; default `0.9` |
| `OLLAMA_NUM_PREDICT` | No | Maximum generated tokens; default `700` |
| `OLLAMA_NUM_CTX` | No | Ollama context window; default `8192` |
| `GENERATION_SEED` | No | Fixed seed for every mapped seed input; leave blank for a new random seed per request |
| `GENERATION_QUEUE_MAX_SIZE` | No | Active plus waiting jobs; default `5` |
| `PROMPT_MAX_LENGTH` | No | Maximum input characters; default `3500` |
| `ACTIVITY_LOG_PATH` | No | Local JSON activity file; default `./data/activity-log.json` |
| `ACTIVITY_LOG_TIME_ZONE` | No | Local timestamp time zone; default `Asia/Tehran` |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, or `error` |

`COMFYUI_BASE_URL` accepts only loopback hosts (`127.0.0.1`, `localhost`, or
`::1`). `OLLAMA_BASE_URL` has the same restriction. Keep both services local.

The fallback switch does not bypass GPU safety. It applies only when Gemma
returns text that fails prompt validation, and the model must still be verified
as unloaded before the original prompt can reach ComfyUI. Startup, inference,
cleanup, and unload failures are reported instead of silently continuing.

Leave `GENERATION_SEED` blank for normal random generation. When it contains a
non-negative whole number, that exact value is used for the primary sampler and
every entry in `COMFYUI_ADDITIONAL_SEED_MAPPINGS`.

## Run the bot

Start ComfyUI first, with the same arguments used by the working setup,
including `--fp32-vae`. You do not need to open Ollama manually when
`OLLAMA_AUTO_START=true`. Then run:

```powershell
npm.cmd start
```

For automatic restart while editing source files:

```powershell
npm.cmd run dev
```

On startup, the app validates the environment, reads the workflow and scene
prompt, checks every node mapping, and only then starts Telegram long polling.
Ollama is started lazily on the first enhanced request, not during application
startup.

## Telegram interaction

```text
You: /start

Fabrexa Canvas:
Welcome to Fabrexa Canvas! 🎨

Turn your imagination into images.

Send me a description of what you'd like to create, and I'll bring it to life.

You: A mysterious vampire queen inside a gothic castle.

Fabrexa Canvas:
🎨 Creating your image...
...
```

Telegram displays `typing` throughout scene understanding and image generation.
For enhanced requests, the status advances from "Understanding your scene" to
"Preparing image generation" and then "Creating your image". The final positive
prompt actually sent to ComfyUI appears inside a collapsed expandable
blockquote. No fixed 45-second estimate is shown for the enhanced pipeline.
When generation finishes, the bot keeps the final prompt, settings, seed, and
total duration in the status message, switches to `upload_photo`, and sends only
the image. Its caption contains only the linked Fabrexa Canvas attribution.

## Activity history

The bot creates `data/activity-log.json` as a JSON array. It records `/start`
attempts, accepted prompts, and successful generations with UTC and Tehran
timestamps, Telegram identity details, prompt text, seed, prompt ID, duration,
and the generated filename where applicable. Enhanced generations also record
the original request, the final prompt, fallback status, and per-stage timings.

The default activity file and its atomic temporary files are ignored by Git.
They can contain private Telegram identity and prompt data and must not be
committed. If `ACTIVITY_LOG_PATH` is changed, add the custom path to
`.gitignore` as well.

## Image storage

The SaveImage node remains active, so ComfyUI writes the original PNG to its
existing configured output directory. Fabrexa Canvas retrieves that same output
through `GET /view` into memory and sends it to Telegram as a photo. It does not
create a project copy, move the original, or use the Windows Downloads folder.
ComfyUI keeps the authoritative original PNG in its configured output
directory.

## Quality checks

```powershell
npm.cmd run check
```

This runs ESLint and the mocked automated test suite. It does not contact
Telegram, ComfyUI, or the GPU.

### Optional Windows hardware check

With ComfyUI running and the configured Ollama model installed:

1. Set `PROMPT_ENHANCEMENT_ENABLED=true` and start the bot with
   `npm.cmd start`. Leave the Ollama desktop application closed.
2. Send a narrative scene to the Telegram bot.
3. Confirm the status moves through scene understanding, handoff, and image
   generation, then returns a photo whose final status shows the enhanced
   prompt.
4. After delivery, run the following command. The configured Gemma model must
   not appear in the result:

   ```powershell
   Invoke-RestMethod http://127.0.0.1:11434/api/ps
   ```

5. Inspect `data/activity-log.json` for `comfyReleaseMs`,
   `gemmaInferenceMs`, `ollamaUnloadMs`, `comfyGenerationMs`, and `totalMs`.

The handoff verifies queue state, practical VRAM release reported by ComfyUI,
and Ollama model residency. It does not claim that every CUDA context or driver
cache allocation becomes zero.

## Troubleshooting

### Startup says an environment variable is missing

Compare `.env` with `.env.example`. Values after `=` must not be left blank for
required fields.

### Startup cannot find the workflow

Export the API-format JSON to `src/workflows/workflow_api.json`, or set
`COMFYUI_WORKFLOW_PATH` to the correct file.

### Startup reports a missing node or input

The configured ID or input name does not match the exported workflow. Reopen
the JSON and copy the exact object key and input property. Do not use the visual
position or node title.

### ComfyUI is unavailable

Confirm ComfyUI is running and its API responds at `http://127.0.0.1:8188`.
Keep the address local. The bot reports network failures without terminating
polling.

### Ollama cannot start automatically

Run `ollama --version`. If the command is not on `PATH`, set
`OLLAMA_EXECUTABLE_PATH` to the full `ollama.exe` path. Check that nothing else
is incorrectly using port `11434`, and increase `OLLAMA_STARTUP_TIMEOUT_MS` only
if the server is known to start slowly. Set `OLLAMA_AUTO_START=false` only when
you intentionally manage the server yourself.

### The configured Gemma model is unavailable

Run `ollama list` and compare the exact name with `OLLAMA_MODEL`. The app never
pulls models automatically. Install or rename the model explicitly, then retry.

### GPU handoff cannot be verified

Check that ComfyUI has no manual running or queued job. The bot waits rather
than interrupting unrelated work. If the machine releases memory slowly,
increase `COMFYUI_CLEANUP_TIMEOUT_MS` or `OLLAMA_UNLOAD_TIMEOUT_MS`. Use
ComfyUI's `/system_stats` and Ollama's `/api/ps` endpoints to inspect the two
sides. The app deliberately refuses to start ComfyUI inference when Gemma
unloading cannot be verified.

### Scene direction returns no usable prompt

Check the Ollama terminal or application logs and confirm the configured model
fits in available memory. Increase `OLLAMA_REQUEST_TIMEOUT_MS` for legitimately
slow inference. `PROMPT_ENHANCEMENT_FALLBACK_TO_RAW=true` permits fallback only
for invalid generated text after safe unload; infrastructure and GPU-handoff
failures never fall back silently.

### Generation fails

Check the ComfyUI terminal for the node that failed. The bot reads execution
errors from history and logs the prompt ID, but does not expose internal details
in Telegram.

### Generation times out

Increase `COMFYUI_TIMEOUT_MS` if the known workflow legitimately takes longer
than four minutes. A timeout does not delete the ComfyUI job or its output.

### Images are noisy

Launch ComfyUI with the existing `--fp32-vae` argument. Fabrexa Canvas does not
change VAE precision or workflow stages.

## Future extension points

Separate workflow mappings can later support presets, regeneration,
image-to-image workflows, and character-aware generation without changing the
current scene-direction or GPU-handoff boundaries.
