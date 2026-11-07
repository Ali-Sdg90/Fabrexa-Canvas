import assert from "node:assert/strict";
import test from "node:test";

import {
  cloneAndInjectWorkflow,
  extractOutputImage,
  validateWorkflowMappings,
} from "../src/services/comfyui.service.js";
import { WorkflowError } from "../src/utils/errors.js";
import { generateSeed } from "../src/utils/seed.js";
import { createWorkflow, workflowMappings } from "./helpers.js";

test("workflow injection clones the workflow and changes only prompt and seed", () => {
  const original = createWorkflow();
  const originalSnapshot = structuredClone(original);

  const injected = cloneAndInjectWorkflow(original, workflowMappings, {
    prompt: "A moonlit gothic castle",
    seed: 123456789,
  });

  assert.notEqual(injected, original);
  assert.deepEqual(original, originalSnapshot);
  assert.equal(injected["10"].inputs.text, "A moonlit gothic castle");
  assert.equal(injected["20"].inputs.seed, 123456789);
  assert.equal(injected["11"].inputs.text, "existing negative prompt");
  assert.equal(injected["20"].inputs.steps, 20);
  assert.equal(injected["20"].inputs.cfg, 5);
  assert.equal(injected["20"].inputs.sampler_name, "dpmpp_2m");
  assert.equal(injected["20"].inputs.scheduler, "karras");
  assert.deepEqual(injected["30"].inputs, { width: 832, height: 1152, batch_size: 1 });
  assert.deepEqual(injected["40"], original["40"]);
});

test("workflow mapping validation reports missing and incorrect nodes", () => {
  const workflow = createWorkflow();
  assert.equal(validateWorkflowMappings(workflow, workflowMappings), true);

  assert.throws(
    () =>
      validateWorkflowMappings(workflow, {
        ...workflowMappings,
        positivePromptNodeId: "999",
      }),
    (error) => error instanceof WorkflowError && /999/.test(error.message),
  );

  workflow["40"].class_type = "PreviewImage";
  assert.throws(
    () => validateWorkflowMappings(workflow, workflowMappings),
    (error) => error instanceof WorkflowError && /SaveImage/.test(error.message),
  );
});

test("generateSeed uses a bounded positive 32-bit range", () => {
  let receivedMinimum;
  let receivedMaximum;
  const seed = generateSeed((minimum, maximum) => {
    receivedMinimum = minimum;
    receivedMaximum = maximum;
    return maximum - 1;
  });

  assert.equal(receivedMinimum, 1);
  assert.equal(receivedMaximum, 0x1_0000_0000);
  assert.equal(seed, 0xffff_ffff);
});

test("extractOutputImage selects the mapped SaveImage output", () => {
  const historyEntry = {
    outputs: {
      40: {
        images: [
          { filename: "first.png", subfolder: "", type: "output" },
          { filename: "final.png", subfolder: "Fabrexa", type: "output" },
        ],
      },
      99: { images: [{ filename: "preview.png", type: "temp" }] },
    },
  };

  assert.deepEqual(extractOutputImage(historyEntry, "40"), {
    filename: "final.png",
    subfolder: "Fabrexa",
    type: "output",
  });
});
