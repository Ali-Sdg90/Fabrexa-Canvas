# Workflow file

Export the existing working ComfyUI workflow in **API format** and save it in
this directory as `workflow_api.json`.

Do not replace the existing SaveImage node or change the checkpoint, negative
prompt, sampler, scheduler, resolution, CLIP skip, denoise, or VAE setup for the
bot. Configure the exact positive-prompt, primary and additional seed, and final
SaveImage node IDs in `.env`. The root README contains the full export and
mapping instructions.
