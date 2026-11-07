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
  assert.match(calls[2].text, /Model: CyberRealistic Pony V18/);
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
