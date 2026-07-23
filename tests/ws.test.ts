import { describe, expect, it, vi } from "vitest";
import { StudioStore } from "../web/src/ws.js";

describe("StudioStore.abort", () => {
  it("affiche immédiatement l'arrêt en cours et n'envoie pas deux demandes", () => {
    const studio = new StudioStore();
    studio.state = { ...studio.state, isStreaming: true };
    const send = vi.spyOn(studio, "send").mockImplementation(() => {});

    studio.abort();
    studio.abort();

    expect(studio.state.isAborting).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ type: "abort" });
  });

  it("retire l'état d'arrêt lorsque l'agent confirme sa fin", () => {
    const studio = new StudioStore();
    studio.state = { ...studio.state, isStreaming: true };
    vi.spyOn(studio, "send").mockImplementation(() => {});

    studio.abort();
    (studio as unknown as { handleMessage(msg: Record<string, unknown>): void }).handleMessage({
      type: "pi_event",
      event: "agent_end",
      data: {},
    });

    expect(studio.state.isStreaming).toBe(false);
    expect(studio.state.isAborting).toBe(false);
  });

  it("ignore une demande d'arrêt lorsque l'agent est inactif", () => {
    const studio = new StudioStore();
    const send = vi.spyOn(studio, "send");

    studio.abort();

    expect(studio.state.isAborting).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
