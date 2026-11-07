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
- Explicit workflow node mappings validated during startup
- ComfyUI completion, failure, and timeout detection
- Telegram photo delivery with a linked Fabrexa Canvas attribution
- Local JSON activity history for starts, prompts, and generated filenames
- Periodic `upload_photo` chat activity while ComfyUI is working
- Graceful polling shutdown and structured diagnostic logs
- Automated tests that do not need Telegram, ComfyUI, or a GPU

Fabrexa Canvas does not alter the configured checkpoint, negative prompt,
sampler, scheduler, resolution, or any other workflow setting. Version 1 does
not enhance prompts.

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
    generation.service.js        Generation orchestration
    prompt.service.js            Prompt extension point
  utils/                         Errors, logging, seed and update utilities
  workflows/                     Place the exported API workflow here
tests/                           Unit and mocked integration tests
```

The Telegram layer never edits workflow data. `GenerationService` coordinates
the prompt and ComfyUI layers, while `ComfyUIService` owns all workflow cloning,
mapping validation, HTTP requests, completion polling, and image retrieval.

## Requirements

- Windows with Node.js 22+
- A Telegram bot token from BotFather
- Your numeric Telegram user ID
- ComfyUI running locally at `http://127.0.0.1:8188`
- The working ComfyUI workflow exported in API format
- The existing checkpoint and custom nodes required by that workflow

The current display metadata assumes the established setup:

| Setting | Value |
| --- | --- |
| Model | CyberRealistic Pony V18 |
| Resolution | 832 x 1152 |
| Steps | 20 |
| CFG | 5.0 |
| Sampler | DPM++ 2M |
| Scheduler | Karras |

These values are not written into the workflow. The exported workflow remains
the source of truth, including the existing negative prompt, CLIP skip, denoise,
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

Open `workflow_api.json` in a text editor and find these three nodes:

1. **Positive prompt node:** Find the text-encoding node whose `inputs.text`
   contains the positive prompt. Copy its object key as
   `COMFYUI_POSITIVE_PROMPT_NODE_ID`. In most workflows its input name is
   `text`.
2. **Seed node:** Find the sampler or noise node whose input contains the seed.
   Copy its object key as `COMFYUI_SEED_NODE_ID`. Copy the exact input name,
   commonly `seed` or `noise_seed`, as `COMFYUI_SEED_INPUT`.
   If another processing node also has an independent seed, list it as a
   `nodeId:inputName` pair in `COMFYUI_ADDITIONAL_SEED_MAPPINGS`.
3. **SaveImage node:** Find the final node whose `class_type` is `SaveImage`. Copy its
   object key as `COMFYUI_SAVE_IMAGE_NODE_ID`.

Node IDs are workflow-specific and must not be guessed. The application checks
all mappings before Telegram polling starts and reports the exact missing node
or input.

Example mapping shape only, using your real IDs:

```env
COMFYUI_POSITIVE_PROMPT_NODE_ID=your-positive-node-id
COMFYUI_POSITIVE_PROMPT_INPUT=text
COMFYUI_SEED_NODE_ID=your-seed-node-id
COMFYUI_SEED_INPUT=seed
COMFYUI_ADDITIONAL_SEED_MAPPINGS=optional-node-id:seed
COMFYUI_SAVE_IMAGE_NODE_ID=your-save-image-node-id
```

## Environment variables

Copy `.env.example` to `.env`, then fill in the blank values.

| Variable | Required | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Yes | Token issued by BotFather |
| `ALLOWED_TELEGRAM_USER_ID` | Yes | Only Telegram account allowed to use the bot |
| `COMFYUI_BASE_URL` | Yes | Local ComfyUI URL; remote hosts are rejected |
| `COMFYUI_WORKFLOW_PATH` | Yes | API workflow path, relative to the project root or absolute |
| `COMFYUI_POSITIVE_PROMPT_NODE_ID` | Yes | Positive text node ID |
| `COMFYUI_POSITIVE_PROMPT_INPUT` | Yes | Positive text input name |
| `COMFYUI_SEED_NODE_ID` | Yes | Sampler/noise seed node ID |
| `COMFYUI_SEED_INPUT` | Yes | Seed input name |
| `COMFYUI_ADDITIONAL_SEED_MAPPINGS` | No | Additional `nodeId:inputName` seed mappings, comma-separated |
| `COMFYUI_SAVE_IMAGE_NODE_ID` | Yes | SaveImage node ID used for delivery |
| `COMFYUI_POLL_INTERVAL_MS` | No | History polling interval; default `2000` |
| `COMFYUI_TIMEOUT_MS` | No | Whole-generation timeout; default `240000` |
| `COMFYUI_REQUEST_TIMEOUT_MS` | No | Individual HTTP timeout; default `10000` |
| `GENERATION_QUEUE_MAX_SIZE` | No | Active plus waiting jobs; default `5` |
| `PROMPT_MAX_LENGTH` | No | Maximum prompt characters; default `1500` |
| `ACTIVITY_LOG_PATH` | No | Local JSON activity file; default `./data/activity-log.json` |
| `ACTIVITY_LOG_TIME_ZONE` | No | Local timestamp time zone; default `Asia/Tehran` |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, or `error` |

`COMFYUI_BASE_URL` accepts only loopback hosts (`127.0.0.1`, `localhost`, or
`::1`). Keep ComfyUI bound to localhost.

## Run the bot

Start ComfyUI first, with the same arguments used by the working setup,
including `--fp32-vae`. Then run:

```powershell
npm.cmd start
```

For automatic restart while editing source files:

```powershell
npm.cmd run dev
```

On startup, the app validates the environment, reads the workflow, checks every
node mapping, and only then starts Telegram long polling.

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

While a job is active, Telegram displays the photo-upload activity. When it
finishes, the bot keeps the completed prompt, settings, seed, and duration in
the status message, adds a short delivery notice, and sends only the photo. Its
caption contains only the linked Fabrexa Canvas attribution.

## Activity history

The bot creates `data/activity-log.json` as a JSON array. It records `/start`
attempts, accepted prompts, and successful generations with UTC and Tehran
timestamps, Telegram identity details, prompt text, seed, prompt ID, duration,
and the generated filename where applicable.

The default activity file and its atomic temporary files are ignored by Git.
They can contain private Telegram identity and prompt data and must not be
committed. If `ACTIVITY_LOG_PATH` is changed, add the custom path to
`.gitignore` as well.

## Image storage

The SaveImage node remains active, so ComfyUI writes the original PNG to its
existing configured output directory. Fabrexa Canvas retrieves that same output
through `GET /view` into memory and sends it to Telegram. It does not create a
project copy, move the original, or use the Windows Downloads folder. The same
in-memory PNG is used for the Telegram photo while ComfyUI keeps the original
in its configured output directory.

## Quality checks

```powershell
npm.cmd run check
```

This runs ESLint and the mocked automated test suite. It does not contact
Telegram, ComfyUI, or the GPU.

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

`PromptService` can later support local Ollama enhancement, while separate
workflow mappings can support presets, regeneration, image-to-image workflows,
and character-aware generation. Those features are intentionally not part of
this MVP.
