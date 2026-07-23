import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import ActivityPanel, { formatActivityDuration } from "./ActivityPanel.js";
import type { StudioState } from "../ws.js";

beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: () => "fr", setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 },
    configurable: true,
  });
});

function state(overrides: Partial<StudioState> = {}): StudioState {
  return {
    connected: true,
    cwd: "/tmp/project",
    commands: [],
    thinkingLevel: "off",
    model: null,
    isStreaming: false,
    isAborting: false,
    streamText: "",
    streamThinking: "",
    items: [],
    artifacts: [],
    activity: { runs: [], isRunning: false },
    sessions: [],
    models: [],
    error: null,
    ask: null,
    ...overrides,
  };
}

function render(studioState: StudioState): string {
  return renderToStaticMarkup(React.createElement(ActivityPanel, { state: studioState, onClose: () => {} }));
}

describe("ActivityPanel", () => {
  it("affiche un état vide et l’avertissement de confidentialité", () => {
    const html = render(state());
    expect(html).toContain("Aucune activité enregistrée");
    expect(html).toContain("secret au format inconnu");
  });

  it("affiche les statuts textuels, outils et détails repliables", () => {
    const html = render(state({
      activity: {
        isRunning: false,
        runs: [{
          id: "run-1",
          projectPath: "/tmp/project",
          startedAt: "2026-07-23T14:00:00.000Z",
          endedAt: "2026-07-23T14:00:02.000Z",
          durationMs: 2_000,
          status: "completed_with_errors",
          toolCount: 1,
          errorCount: 1,
          steps: [{
            id: "tool-1",
            kind: "tool",
            toolCallId: "tool-1",
            toolName: "bash",
            status: "failed",
            startedAt: "2026-07-23T14:00:00.000Z",
            endedAt: "2026-07-23T14:00:01.000Z",
            durationMs: 1_000,
            arguments: { command: "false" },
            output: "code 1",
          }],
        }],
      },
    }));

    expect(html).toContain("Terminé avec erreurs");
    expect(html).toContain("bash");
    expect(html).toContain("Arguments");
    expect(html).toContain("Sortie");
    expect(html).toContain("false");
    expect(html).toContain("code 1");
  });

  it("désactive l’effacement pendant une exécution", () => {
    const html = render(state({
      activity: {
        isRunning: true,
        runs: [{ id: "active", projectPath: "/tmp/project", startedAt: new Date().toISOString(), status: "running", toolCount: 0, errorCount: 0, steps: [] }],
      },
    }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Effacer<\/button>/);
  });
});

describe("formatActivityDuration", () => {
  it("formate les millisecondes, secondes, minutes et heures", () => {
    expect(formatActivityDuration(42)).toBe("42 ms");
    expect(formatActivityDuration(2_000)).toBe("2 s");
    expect(formatActivityDuration(62_000)).toBe("1 min 2 s");
    expect(formatActivityDuration(3_660_000)).toBe("1 h 1 min");
  });
});
