import { describe, expect, it, vi } from "vitest";
import { StudioStore } from "../web/src/ws.js";

describe("StudioStore activity", () => {
  it("restaure l’activité depuis un snapshot et applique les mises à jour", () => {
    const studio = new StudioStore();
    const handle = (message: Record<string, unknown>) =>
      (studio as unknown as { handleMessage(msg: Record<string, unknown>): void }).handleMessage(message);

    handle({
      type: "snapshot",
      activity: { runs: [{ id: "run-1", status: "running", steps: [] }], isRunning: true },
    });
    expect(studio.state.activity.isRunning).toBe(true);
    expect(studio.state.activity.runs[0]?.id).toBe("run-1");

    handle({
      type: "activity_update",
      activity: { runs: [{ id: "run-1", status: "completed", steps: [] }], isRunning: false },
    });
    expect(studio.state.activity.isRunning).toBe(false);
    expect(studio.state.activity.runs[0]?.status).toBe("completed");
  });

  it("efface immédiatement l’activité lors d’un remplacement de session pour éviter une fuite entre projets", () => {
    const studio = new StudioStore();
    studio.state = { ...studio.state, activity: { runs: [{ id: "old", projectPath: "/old", startedAt: new Date().toISOString(), status: "completed", toolCount: 0, errorCount: 0, steps: [] }], isRunning: false } };
    (studio as unknown as { handleMessage(msg: Record<string, unknown>): void }).handleMessage({ type: "session_replaced" });
    expect(studio.state.activity.runs).toEqual([]);
  });

  it("traite l’effacement diffusé par le serveur", () => {
    const studio = new StudioStore();
    (studio as unknown as { handleMessage(msg: Record<string, unknown>): void }).handleMessage({
      type: "activity_cleared",
      activity: { runs: [], isRunning: false },
    });
    expect(studio.state.activity.runs).toEqual([]);
  });
});

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
