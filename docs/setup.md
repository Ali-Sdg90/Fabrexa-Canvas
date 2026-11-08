# Setup

This guide prepares Fabrexa Canvas for a local Windows workstation. The bot
expects Telegram, ComfyUI, and optional Ollama services to remain under the
operator's control.

## Prerequisites

- Windows 10 or 11
- Node.js 22.14 or newer
- Git
- A Telegram bot created through BotFather
- The numeric Telegram ID of each authorized account
- A working local ComfyUI installation
- A ComfyUI workflow that already generates correctly
- Ollama for Windows only when enhanced mode is required

Fabrexa Canvas does not install ComfyUI, checkpoints, custom nodes, Ollama, or
language models.

## Install the project

```powershell
git clone https://github.com/Ali-Sdg90/Fabrexa-Canvas.git
cd Fabrexa-Canvas
npm.cmd install
Copy-Item .env.example .env
```

Use `npm.cmd` in PowerShell if script execution policy blocks npm's PowerShell
wrapper.

## Configure Telegram access

Add the bot token and one or more comma-separated numeric user IDs to `.env`:

```env
TELEGRAM_BOT_TOKEN=your-bot-token
ALLOWED_TELEGRAM_USER_IDS=123456789,987654321
```

Only these IDs can use the bot. An unauthorized `/start` attempt receives the
private-bot message and is still recorded in the local activity log.

## Export the ComfyUI workflow

1. Open the workflow that already produces the intended image in ComfyUI.
2. Confirm it includes the correct checkpoint, sampler, scheduler, resolution,
   negative prompt, and final `SaveImage` node.
3. Enable developer options if the API export action is hidden.
4. Choose **Save (API Format)** or **Export (API)**.
5. Save the result as `src/workflows/workflow_api.json`.

A normal UI workflow is not interchangeable with the API format. The API file
is an object keyed by node IDs, where every node contains `class_type` and
`inputs`.

## Map runtime-controlled nodes

Find the following nodes in the exported JSON and copy their exact IDs and
input names to `.env`:

| Mapping | How to identify it |
| --- | --- |
| Positive prompt | Text-encoding node whose `inputs.text` contains the positive prompt |
| Checkpoint | `CheckpointLoaderSimple` node and its checkpoint input, usually `ckpt_name` |
| Primary seed | Sampler or noise node containing `seed` or `noise_seed` |
| Additional seeds | Any other node whose seed must match the primary request seed |
| Output | Final node whose `class_type` is `SaveImage` |

Example shape, using IDs from your own workflow:

```env
COMFYUI_POSITIVE_PROMPT_NODE_ID=your-positive-node-id
COMFYUI_POSITIVE_PROMPT_INPUT=text
COMFYUI_CHECKPOINT_NODE_ID=your-checkpoint-node-id
COMFYUI_CHECKPOINT_INPUT=ckpt_name
COMFYUI_CHECKPOINT_NAME=your-private-checkpoint.safetensors
COMFYUI_SEED_NODE_ID=your-seed-node-id
COMFYUI_SEED_INPUT=seed
COMFYUI_ADDITIONAL_SEED_MAPPINGS=optional-node-id:seed
COMFYUI_SAVE_IMAGE_NODE_ID=your-save-image-node-id
```

The checkpoint input may remain blank in the committed workflow. The private
filename is injected from ignored `.env` at runtime. Do not put private model
or checkpoint names in committed documentation, Telegram messages, or source
code.

Fabrexa Canvas validates all mapped nodes and inputs before Telegram polling
starts. It does not guess IDs from visual node titles or positions.

## Configure optional enhanced mode

Install Ollama separately and confirm it is available:

```powershell
ollama --version
ollama list
```

Set `OLLAMA_MODEL` to the exact name already shown by `ollama list`. Fabrexa
Canvas never pulls a model automatically.

```env
PROMPT_ENHANCEMENT_AVAILABLE=true
OLLAMA_MODEL=your-installed-model-name
OLLAMA_AUTO_START=true
OLLAMA_EXECUTABLE_PATH=ollama
```

When auto-start is enabled, the bot starts `ollama serve` in a hidden background
process only when an enhanced request needs it. An already-running server is
reused. Direct mode makes no Ollama request.

## Validate the installation

Run the checks before starting local services:

```powershell
npm.cmd run check
```

Then start ComfyUI with the arguments required by the workflow and run:

```powershell
npm.cmd start
```

A successful startup means the app has:

1. Parsed and validated `.env`.
2. Initialized local activity and user-data files.
3. Loaded the ComfyUI API workflow.
4. Validated every configured node mapping.
5. Loaded and validated the scene-director prompt when enhanced mode is enabled.
6. Started Telegram long polling.

Ollama is intentionally not started during application startup.

## First Telegram request

1. Open the bot and send `/start`.
2. Choose **Gemma** or **Direct** mode.
3. Send a text-only image description.
4. Watch the status message progress through the active stages.
5. Confirm the final image arrives and the status shows its final prompt, seed,
   settings, and duration.

For a hardware-level verification of GPU handoff, follow the checklist in
[Operations](./operations.md#enhanced-mode-hardware-check).
