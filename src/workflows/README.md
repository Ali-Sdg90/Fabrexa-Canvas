# Workflow file

Export the existing working ComfyUI workflow in **API format** and save it in
this directory as `workflow_api.json`.

Keep the committed checkpoint input empty. Configure the actual local filename
with `COMFYUI_CHECKPOINT_NAME` in the ignored `.env`; the bot injects it into the
mapped checkpoint loader at runtime.

Do not replace the existing SaveImage node or change the checkpoint, negative
prompt, sampler, scheduler, resolution, optional CLIP skip, denoise, or VAE setup for the
bot. Configure the exact positive-prompt, primary and additional seed, and final
SaveImage node IDs in `.env`. The root README contains the full export and
mapping instructions.
