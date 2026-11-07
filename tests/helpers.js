export const workflowMappings = Object.freeze({
  positivePromptNodeId: "10",
  positivePromptInput: "text",
  checkpointNodeId: "1",
  checkpointInput: "ckpt_name",
  seedNodeId: "20",
  seedInput: "seed",
  additionalSeedMappings: Object.freeze([]),
  saveImageNodeId: "40",
});

export function createWorkflow() {
  return {
    1: {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: "" },
    },
    10: {
      class_type: "CLIPTextEncode",
      inputs: { text: "original positive prompt", clip: ["1", 1] },
    },
    11: {
      class_type: "CLIPTextEncode",
      inputs: { text: "existing negative prompt", clip: ["1", 1] },
    },
    20: {
      class_type: "KSampler",
      inputs: {
        seed: 7,
        steps: 20,
        cfg: 5,
        sampler_name: "dpmpp_2m",
        scheduler: "karras",
        denoise: 1,
        positive: ["10", 0],
        negative: ["11", 0],
        latent_image: ["30", 0],
      },
    },
    30: {
      class_type: "EmptyLatentImage",
      inputs: { width: 832, height: 1152, batch_size: 1 },
    },
    40: {
      class_type: "SaveImage",
      inputs: { filename_prefix: "FabrexaCanvas", images: ["50", 0] },
    },
  };
}

export const silentLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {},
});
