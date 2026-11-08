# Security and privacy

Fabrexa Canvas is a private local automation tool, not a public bot platform.
Its security model assumes one trusted Windows workstation, a controlled
Telegram bot token, a small allowlist of Telegram users, and local-only AI
services.

## Trust boundaries

```text
Telegram cloud
  -> authenticated bot token
  -> explicit Telegram user-ID allowlist
  -> Fabrexa Canvas on the trusted workstation
  -> loopback-only ComfyUI and Ollama APIs
  -> local workflow, models, outputs, and JSON histories
```

The bot still communicates with Telegram to receive messages and deliver
images. Prompts and uploaded results therefore pass through Telegram. ComfyUI,
Ollama, models, workflow files, and project persistence remain local.

## Secrets

Keep these values in ignored `.env` only:

- Telegram bot token
- Private checkpoint filename
- Private local model identifiers when they should not be public
- Any custom path that reveals sensitive local information

`.env.example` should contain only safe placeholders and public defaults. Never
paste the real `.env` into an issue, pull request, log excerpt, or screenshot.

The logger receives configured secret values as redactions and also masks
credential-like field names. Redaction is defense in depth, not permission to
log secrets intentionally.

## Telegram authorization

Every update passes through the allowlist middleware before normal bot
handlers. IDs are compared as exact strings to avoid numeric-coercion errors.
Unauthorized `/start` attempts are denied and recorded locally for visibility.

The allowlist protects bot functionality, but control of the Telegram bot token
remains critical. Rotate the token through BotFather if it is exposed.

## Local service restriction

ComfyUI and Ollama URLs must use HTTP with `127.0.0.1`, `localhost`, or `::1`.
Credentials, remote hosts, and URL paths are rejected during configuration
validation. This prevents the project from being casually reconfigured to send
prompts or workflow data to a remote service.

Do not expose ComfyUI or Ollama ports to the local network or internet as part
of this project's normal operation.

## Workflow and file safety

- Workflow mappings are validated before polling begins.
- Each request uses a cloned workflow object.
- Only mapped runtime inputs are changed.
- Output metadata is validated before it becomes a ComfyUI `/view` request.
- The project does not create a duplicate generated-image file.
- JSON writes use unique temporary files and atomic rename.
- Invalid existing JSON is rejected rather than silently reset.

The ComfyUI workflow and its custom nodes are executable local dependencies.
Review third-party nodes and model sources before installing them.

## Sensitive local data

The following can contain personal or sensitive information:

- `.env`
- `data/activity-log.json`
- `data/global-memory.json`
- `data/users/<telegram-id>/preferences.json`
- `data/users/<telegram-id>/chats.json`
- ComfyUI output images and metadata
- Application or ComfyUI logs collected during diagnosis

Default project data paths are ignored by Git. If a path is changed, update
`.gitignore` before running the bot. Store backups encrypted and delete them
according to your own retention policy.

## Known limits

- Telegram itself is outside the local trust boundary.
- Local JSON files are not encrypted by the application.
- Anyone with access to the Windows account may be able to read runtime data.
- The allowlist is identity-based and does not add a second Telegram challenge.
- There is no database-level multi-process locking.
- Dependency and custom-node security still require normal supply-chain review.
- This project does not sandbox ComfyUI workflows or Ollama models.

For a personal workstation, Windows account security, disk encryption, token
rotation, trusted model sources, and limited filesystem access remain operator
responsibilities.

## Reporting a security issue

Do not open a public issue containing tokens, Telegram IDs, private prompts,
checkpoint names, or local paths. Revoke exposed credentials first, preserve
the minimum evidence needed for diagnosis, and contact the repository owner
privately through the contact method listed on their GitHub profile.
