import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearActivity,
  enableActivity,
  getActivityState,
  markActivityAbortRequested,
  resetActivityForTests,
  switchActivityProject,
  trackActivityEvent,
} from "../src/activity/runtime.js";

const roots: string[] = [];
function root(): string {
  const value = mkdtempSync(join(tmpdir(), "pi-studio-runtime-"));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await resetActivityForTests();
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("activity runtime", () => {
  it("ne journalise rien avant l’activation explicite", async () => {
    expect(await trackActivityEvent("agent_start", {})).toBe(false);
    expect(getActivityState().runs).toEqual([]);
  });

  it("capture un run complet avec outils parallèles", async () => {
    const dir = root();
    await enableActivity(join(dir, "project"), { agentDir: join(dir, "agent") });

    await trackActivityEvent("agent_start", {}, "session.jsonl");
    await trackActivityEvent("tool_execution_start", { toolCallId: "a", toolName: "read", args: { path: "a" } });
    await trackActivityEvent("tool_execution_start", { toolCallId: "b", toolName: "bash", args: { command: "false" } });
    await trackActivityEvent("tool_execution_end", { toolCallId: "b", toolName: "bash", result: { content: "erreur" }, isError: true });
    await trackActivityEvent("tool_execution_end", { toolCallId: "a", toolName: "read", result: { content: "ok" }, isError: false });
    await trackActivityEvent("agent_settled", {});

    const run = getActivityState().runs[0]!;
    expect(run.sessionFile).toBe("session.jsonl");
    expect(run.status).toBe("completed_with_errors");
    expect(run.toolCount).toBe(2);
    expect(run.errorCount).toBe(1);
  });

  it("marque une interruption demandée depuis le web", async () => {
    const dir = root();
    await enableActivity(join(dir, "project"), { agentDir: join(dir, "agent") });
    await trackActivityEvent("agent_start", {});
    markActivityAbortRequested();
    await trackActivityEvent("agent_settled", {});
    expect(getActivityState().runs[0]?.status).toBe("interrupted");
  });

  it("refuse l’effacement pendant un run et l’autorise ensuite", async () => {
    const dir = root();
    await enableActivity(join(dir, "project"), { agentDir: join(dir, "agent") });
    await trackActivityEvent("agent_start", {});
    await expect(clearActivity()).rejects.toThrow(/pendant une exécution/);
    await trackActivityEvent("agent_settled", {});
    await clearActivity();
    expect(getActivityState().runs).toEqual([]);
  });

  it("isole l’historique lors d’un changement de projet", async () => {
    const dir = root();
    await enableActivity(join(dir, "project-a"), { agentDir: join(dir, "agent") });
    await trackActivityEvent("agent_start", {});
    await trackActivityEvent("agent_settled", {});
    expect(getActivityState().runs).toHaveLength(1);

    await switchActivityProject(join(dir, "project-b"));
    expect(getActivityState().runs).toEqual([]);

    await switchActivityProject(join(dir, "project-a"));
    expect(getActivityState().runs).toHaveLength(1);
  });
});
