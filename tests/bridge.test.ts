import { afterEach, describe, expect, it } from "vitest";
import { hub, trackEvent } from "../src/bridge.js";

const originalCtx = hub.ctx;

afterEach(() => {
  hub.streaming = { active: false, text: "", thinking: "" };
  hub.pendingToolArgs.clear();
  hub.ctx = originalCtx;
});

describe("bridge streaming snapshot", () => {
  it("efface les buffers à message_end pour éviter un message fantôme après reconnexion", async () => {
    hub.ctx = null;
    await trackEvent("agent_start", {});
    await trackEvent("message_update", { assistantMessageEvent: { type: "text_delta", delta: "réponse" } });
    await trackEvent("message_update", { assistantMessageEvent: { type: "thinking_delta", delta: "réflexion" } });
    expect(hub.streaming.text).toBe("réponse");
    expect(hub.streaming.thinking).toBe("réflexion");

    await trackEvent("message_end", {});

    expect(hub.streaming.text).toBe("");
    expect(hub.streaming.thinking).toBe("");
  });
});
