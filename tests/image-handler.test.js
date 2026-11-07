import assert from "node:assert/strict";
import test from "node:test";

import { createImageHandler } from "../src/bot/handlers/image.handler.js";
import { MEDIA_ATTRIBUTION_HTML } from "../src/bot/messages.js";
import { GENERATION_SETTINGS } from "../src/config/generation.config.js";
import { GenerationQueue } from "../src/services/generation-queue.service.js";
import { silentLogger } from "./helpers.js";

test("image handler types while generating, then uploads only a photo", async () => {
  const calls = [];
  const activityEvents = [];
  const backgroundTasks = [];
  const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const generationQueue = new GenerationQueue({ maxSize: 2, logger: silentLogger });
  const handler = createImageHandler({
    generationService: {
      prepareRequest(prompt) {
        return { prompt, seed: 12345 };
      },
      async generate() {
        return {
          buffer: imageBuffer,
          filename: "FabrexaCanvas_00001_.png",
          promptId: "prompt-1",
          prompt: "A <mysterious> & detailed castle",
          enhanced: false,
          fallbackUsed: false,
          timings: { totalMs: 4321 },
          durationMs: 4321,
        };
      },
    },
    generationQueue,
    generationSettings: GENERATION_SETTINGS,
    promptMaxLength: 1500,
    actionIntervalMs: 4000,
    activityLogService: {
      async append(event) {
        activityEvents.push(event);
      },
    },
    logger: silentLogger,
    backgroundTaskRunner: (task) => backgroundTasks.push(task),
  });
  const context = {
    update: { update_id: 77 },
    message: { text: "A <mysterious> & detailed castle" },
    from: { id: 123, username: "owner", first_name: "Ali" },
    chat: { id: 123 },
    telegram: {
      async editMessageText(_chatId, _messageId, _inlineMessageId, text, options) {
        calls.push({ type: "edit", text, options });
      },
      async sendChatAction(_chatId, action) {
        calls.push({ type: "action", action });
      },
    },
    async reply(text, options) {
      calls.push({ type: "reply", text, options });
      return { chat: { id: 123 }, message_id: 10 };
    },
    async replyWithPhoto(photo, options) {
      calls.push({ type: "photo", photo, options });
    },
  };

  await handler(context);
  await Promise.all(backgroundTasks);

  assert.deepEqual(
    calls.map((call) => call.type),
    ["reply", "action", "edit", "action", "photo"],
  );
  assert.equal(calls[0].options.parse_mode, "HTML");
  assert.match(
    calls[0].text,
    /<blockquote expandable>A &lt;mysterious&gt; &amp; detailed castle<\/blockquote>/,
  );
  assert.match(calls[0].text, /Your image should be ready in about 45 seconds\./);
  assert.equal(calls[1].action, "typing");
  assert.match(calls[2].text, /^✅ Your image is ready!/);
  assert.match(calls[2].text, /📝 Full Prompt/);
  assert.match(
    calls[2].text,
    /<blockquote expandable>A &lt;mysterious&gt; &amp; detailed castle<\/blockquote>/,
  );
  assert.doesNotMatch(calls[2].text, /^Model:/m);
  assert.match(calls[2].text, /Seed: 12345/);
  assert.match(calls[2].text, /⏱ Completed in 4\.3 seconds\./);
  assert.match(calls[2].text, /The image has been created and will be sent shortly\.$/);
  assert.equal(calls[2].options.parse_mode, "HTML");
  assert.equal(calls[3].action, "upload_photo");
  assert.equal(calls[4].photo.source, imageBuffer);
  assert.deepEqual(calls[4].options, {
    caption: MEDIA_ATTRIBUTION_HTML,
    parse_mode: "HTML",
  });
  assert.deepEqual(
    activityEvents.map((event) => event.event),
    ["prompt_received", "image_generated"],
  );
  assert.equal(activityEvents[1].filename, "FabrexaCanvas_00001_.png");
});

test("image handler displays the actual enhanced prompt used by ComfyUI", async () => {
  const edits = [];
  const activityEvents = [];
  const backgroundTasks = [];
  const generationQueue = new GenerationQueue({ maxSize: 2, logger: silentLogger });
  const handler = createImageHandler({
    generationService: {
      enhancementEnabled: true,
      prepareRequest() {
        return { prompt: "A long raw story", seed: 42 };
      },
      async generate(_request, { onStage }) {
        await onStage({ stage: "preparing_image", prompt: "A focused visual prompt" });
        await onStage({ stage: "generating_image", prompt: "A focused visual prompt" });
        return {
          buffer: Buffer.from("png"),
          filename: "result.png",
          promptId: "prompt-2",
          originalPrompt: "A long raw story",
          prompt: "A focused visual prompt",
          enhanced: true,
          fallbackUsed: false,
          timings: { totalMs: 10000 },
          durationMs: 10000,
        };
      },
    },
    generationQueue,
    generationSettings: GENERATION_SETTINGS,
    promptMaxLength: 1500,
    actionIntervalMs: 4000,
    activityLogService: { append: async (event) => activityEvents.push(event) },
    logger: silentLogger,
    backgroundTaskRunner: (task) => backgroundTasks.push(task),
  });
  const context = {
    update: { update_id: 88 },
    message: { text: "A long raw story" },
    from: { id: 123 },
    chat: { id: 123 },
    telegram: {
      async editMessageText(_chatId, _messageId, _inlineMessageId, text) {
        edits.push(text);
      },
      async sendChatAction() {},
    },
    async reply(text) {
      assert.match(text, /Understanding your scene/);
      return { chat: { id: 123 }, message_id: 11 };
    },
    async replyWithPhoto() {},
  };

  await handler(context);
  await Promise.all(backgroundTasks);

  assert.match(edits.at(-1), /A focused visual prompt/);
  assert.doesNotMatch(edits.at(-1), /A long raw story/);
  const generatedEvent = activityEvents.find((event) => event.event === "image_generated");
  assert.equal(generatedEvent.originalPrompt, "A long raw story");
  assert.equal(generatedEvent.prompt, "A focused visual prompt");
  assert.equal(generatedEvent.enhanced, true);
});

test("image handler returns after queueing without waiting for a long generation", async () => {
  const backgroundTasks = [];
  let resolveGeneration;
  const generationResult = new Promise((resolve) => {
    resolveGeneration = resolve;
  });
  let photoDelivered = false;
  const generationQueue = new GenerationQueue({ maxSize: 2, logger: silentLogger });
  const handler = createImageHandler({
    generationService: {
      enhancementEnabled: false,
      prepareRequest(prompt) {
        return { prompt, seed: 7 };
      },
      async generate() {
        return generationResult;
      },
    },
    generationQueue,
    generationSettings: GENERATION_SETTINGS,
    promptMaxLength: 3500,
    actionIntervalMs: 4000,
    activityLogService: { append: async () => undefined },
    logger: silentLogger,
    backgroundTaskRunner: (task) => backgroundTasks.push(task),
  });
  const context = {
    update: { update_id: 99 },
    message: { text: "A long-running scene" },
    from: { id: 123 },
    chat: { id: 123 },
    telegram: {
      async editMessageText() {},
      async sendChatAction() {},
    },
    async reply() {
      return { chat: { id: 123 }, message_id: 12 };
    },
    async replyWithPhoto() {
      photoDelivered = true;
    },
  };

  await handler(context);

  assert.equal(backgroundTasks.length, 1);
  assert.equal(generationQueue.size, 1);
  assert.equal(photoDelivered, false);

  resolveGeneration({
    buffer: Buffer.from("png"),
    filename: "result.png",
    promptId: "prompt-3",
    prompt: "A long-running scene",
    enhanced: false,
    fallbackUsed: false,
    timings: { totalMs: 120000 },
    durationMs: 120000,
  });
  await Promise.all(backgroundTasks);

  assert.equal(photoDelivered, true);
  assert.equal(generationQueue.size, 0);
});
