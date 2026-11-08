# Configuration

Fabrexa Canvas reads configuration from `.env` at startup. Copy
[`.env.example`](../.env.example) to `.env` and keep the real file uncommitted.
Invalid required values, unsafe service URLs, invalid limits, and broken
workflow mappings stop startup with a specific error.

## Telegram

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Yes | None | Token issued by BotFather |
| `ALLOWED_TELEGRAM_USER_IDS` | Yes | None | Comma-separated positive numeric IDs allowed to use the bot |
| `TELEGRAM_ACTION_INTERVAL_MS` | No | `4000` | Interval for repeated Telegram chat actions during a job |

`ALLOWED_TELEGRAM_USER_ID` remains a legacy single-account alternative when the
plural variable is absent. Duplicate, zero, or non-numeric IDs are rejected.

## ComfyUI connection and workflow

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `COMFYUI_BASE_URL` | No | `http://127.0.0.1:8188` | Local ComfyUI API origin |
| `COMFYUI_WORKFLOW_PATH` | No | `./src/workflows/workflow_api.json` | API-format workflow path |
| `COMFYUI_CHECKPOINT_NAME` | Yes | None | Private checkpoint filename injected at runtime |
| `COMFYUI_POSITIVE_PROMPT_NODE_ID` | Yes | Example in `.env.example` | Positive text node ID |
| `COMFYUI_POSITIVE_PROMPT_INPUT` | Yes | `text` | Positive text input name |
| `COMFYUI_CHECKPOINT_NODE_ID` | Yes | Example in `.env.example` | `CheckpointLoaderSimple` node ID |
| `COMFYUI_CHECKPOINT_INPUT` | Yes | `ckpt_name` | Checkpoint input name |
| `COMFYUI_SEED_NODE_ID` | Yes | Example in `.env.example` | Primary seed node ID |
| `COMFYUI_SEED_INPUT` | Yes | `seed` | Primary seed input name |
| `COMFYUI_ADDITIONAL_SEED_MAPPINGS` | No | Empty | Comma-separated `nodeId:inputName` mappings |
| `COMFYUI_SAVE_IMAGE_NODE_ID` | Yes | Example in `.env.example` | Final `SaveImage` node ID |

Relative file paths resolve from the project root. The ComfyUI URL must use
plain HTTP and a loopback hostname: `127.0.0.1`, `localhost`, or `::1`. URLs with
credentials or extra paths are rejected.

## Timeouts and polling

| Variable | Default | Purpose |
| --- | --- | --- |
| `COMFYUI_POLL_INTERVAL_MS` | `2000` | Completion-history polling interval |
| `COMFYUI_TIMEOUT_MS` | `240000` | Maximum whole-generation wait |
| `COMFYUI_REQUEST_TIMEOUT_MS` | `10000` | Timeout for one ComfyUI HTTP request |
| `COMFYUI_IDLE_TIMEOUT_MS` | `300000` | Maximum wait for unrelated ComfyUI work to finish |
| `COMFYUI_CLEANUP_TIMEOUT_MS` | `30000` | Maximum wait for pre-Ollama model cleanup |
| `COMFYUI_CLEANUP_POLL_INTERVAL_MS` | `1000` | Queue and VRAM sampling interval during cleanup |
| `COMFYUI_CLEANUP_MIN_RELEASE_MB` | `64` | Minimum observed VRAM release accepted as progress |
| `COMFYUI_CLEANUP_FREE_RATIO` | `0.7` | Free-VRAM ratio accepted as ready |
| `COMFYUI_CLEANUP_STABLE_SAMPLES` | `2` | Consecutive stable samples required |

Increase a timeout only after confirming the related local service is healthy
and legitimately slow. Longer timeouts do not fix a broken workflow, missing
node, or model that cannot fit in memory.

## Prompt enhancement and Ollama

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PROMPT_ENHANCEMENT_AVAILABLE` | No | `true` | Expose enhanced mode to Telegram users |
| `PROMPT_ENHANCEMENT_FALLBACK_TO_RAW` | No | `false` | Use the original prompt only after invalid model text |
| `PROMPT_ENHANCEMENT_MAX_LENGTH` | No | `2400` | Maximum accepted enhanced prompt length |
| `OLLAMA_BASE_URL` | No | `http://127.0.0.1:11434` | Local Ollama API origin |
| `OLLAMA_MODEL` | No | Value in `.env.example` | Exact locally installed model name |
| `OLLAMA_AUTO_START` | No | `true` | Start `ollama serve` when the API is unavailable |
| `OLLAMA_EXECUTABLE_PATH` | No | `ollama` | Command or full path to `ollama.exe` |
| `OLLAMA_SYSTEM_PROMPT_PATH` | No | `./src/prompts/scene-director.txt` | Scene-director system prompt |
| `OLLAMA_TEMPERATURE` | No | `0.35` | Sampling temperature |
| `OLLAMA_TOP_P` | No | `0.9` | Nucleus sampling value |
| `OLLAMA_NUM_PREDICT` | No | `700` | Maximum generated tokens |
| `OLLAMA_NUM_CTX` | No | `8192` | Context window |

Ollama uses these lifecycle controls:

| Variable | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_STARTUP_TIMEOUT_MS` | `30000` | Wait for API readiness after auto-start |
| `OLLAMA_REQUEST_TIMEOUT_MS` | `180000` | Inference request timeout |
| `OLLAMA_UNLOAD_TIMEOUT_MS` | `30000` | Wait for model-unload verification |
| `OLLAMA_POLL_INTERVAL_MS` | `500` | Readiness, residency, and handoff polling interval |

The Ollama URL has the same loopback-only restriction as ComfyUI. The app does
not stop an externally managed Ollama server; it unloads only the configured
model when this service loaded it for inference.

## Request, queue, and update limits

| Variable | Default | Purpose |
| --- | --- | --- |
| `GENERATION_SEED` | Empty | Fixed non-negative seed; empty creates a new seed per request |
| `GENERATION_QUEUE_MAX_SIZE` | `5` | Maximum active plus waiting generation jobs |
| `PROMPT_MAX_LENGTH` | `3500` | Maximum incoming prompt length |
| `UPDATE_DEDUP_TTL_MS` | `600000` | Lifetime of a seen Telegram update ID |
| `UPDATE_DEDUP_MAX_SIZE` | `1000` | Maximum in-memory update IDs retained |

A fixed seed is copied to the primary and every additional mapped seed input.
The queue accepts one active job and up to the configured total size; overflow
receives a user-facing queue-full response.

## Persistence and logging

| Variable | Default | Purpose |
| --- | --- | --- |
| `ACTIVITY_LOG_PATH` | `./data/activity-log.json` | Operational event history |
| `ACTIVITY_LOG_TIME_ZONE` | `Asia/Tehran` | IANA time zone for local timestamps |
| `USER_DATA_ROOT` | `./data/users` | Per-account preferences and histories |
| `GLOBAL_MEMORY_PATH` | `./data/global-memory.json` | Combined authorized-account history |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |

Changing a data path does not automatically update `.gitignore`. Add the custom
path yourself before running the bot if it is inside the repository.

## Display-only generation metadata

`src/config/generation.config.js` contains the settings shown in Telegram, such
as resolution, steps, CFG, sampler, and scheduler. It does not write those
values into the workflow. Keep this metadata aligned with the real ComfyUI
workflow so status messages remain accurate.
