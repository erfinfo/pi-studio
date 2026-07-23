import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityStore } from "../src/activity/store.js";
import { ActivityTracker } from "../src/activity/tracker.js";

const roots: string[] = [];
const DAY = 24 * 60 * 60 * 1000;

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-studio-activity-"));
  roots.push(root);
  return root;
}

function makeStore(options: {
  root?: string;
  now?: () => number;
  maxAgeMs?: number;
  maxBytes?: number;
} = {}) {
  const root = options.root ?? tempRoot();
  return new ActivityStore({
    cwd: join(root, "project"),
    agentDir: join(root, "agent"),
    now: options.now,
    maxAgeMs: options.maxAgeMs,
    maxBytes: options.maxBytes,
  });
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("ActivityStore", () => {
  it("crée le dossier en 0700 et le journal en 0600", async () => {
    const store = makeStore();
    await store.initialize();

    expect(statSync(store.directoryPath).mode & 0o777).toBe(0o700);
    expect(statSync(store.filePath).mode & 0o777).toBe(0o600);
  });

  it("redige les secrets avant leur écriture dans le journal", async () => {
    const store = makeStore({ now: () => 100 });
    await store.initialize();
    await store.record({ version: 1, type: "run_started", runId: "safe", at: 1, projectPath: store.projectPath });
    await store.record({
      version: 1,
      type: "tool_started",
      runId: "safe",
      at: 2,
      toolCallId: "tool-safe",
      toolName: "bash",
      arguments: { command: "curl -H 'Authorization: Bearer raw-secret'", apiKey: "raw-key" },
    });
    await store.flush();

    const journal = readFileSync(store.filePath, "utf8");
    expect(journal).not.toContain("raw-secret");
    expect(journal).not.toContain("raw-key");
    expect(journal).toContain("[REDACTED]");
  });

  it("ignore une dernière ligne JSONL incomplète", async () => {
    const root = tempRoot();
    const store = makeStore({ root });
    await store.initialize();
    await store.record({ version: 1, type: "run_started", runId: "run-1", at: 100, projectPath: store.projectPath });
    await store.flush();
    writeFileSync(store.filePath, `${readFileSync(store.filePath, "utf8")}{\"broken\":`, { mode: 0o600 });

    const reloaded = makeStore({ root });
    await reloaded.initialize();

    expect(reloaded.listRuns()).toHaveLength(1);
    expect(reloaded.listRuns()[0]?.id).toBe("run-1");
    expect(reloaded.listRuns()[0]?.status).toBe("interrupted");
  });

  it("ignore les événements d’une version future", async () => {
    const root = tempRoot();
    const store = makeStore({ root });
    await store.initialize();
    writeFileSync(
      store.filePath,
      `${JSON.stringify({ version: 99, type: "future", runId: "future", at: 1 })}\n`,
      { mode: 0o600 },
    );

    const reloaded = makeStore({ root });
    await reloaded.initialize();

    expect(reloaded.listRuns()).toEqual([]);
  });

  it("récupère un run orphelin comme interrompu au chargement", async () => {
    const root = tempRoot();
    const store = makeStore({ root });
    await store.initialize();
    await store.record({ version: 1, type: "run_started", runId: "orphan", at: 100, projectPath: store.projectPath });
    await store.flush();

    const reloaded = makeStore({ root, now: () => 500 });
    await reloaded.initialize();

    const run = reloaded.listRuns()[0]!;
    expect(run.status).toBe("interrupted");
    expect(run.endedAt).toBe(new Date(500).toISOString());
    expect(readFileSync(reloaded.filePath, "utf8")).toContain("run_interrupted");
  });

  it("purge les runs de plus de 30 jours", async () => {
    let now = 40 * DAY;
    const store = makeStore({ now: () => now, maxAgeMs: 30 * DAY });
    await store.initialize();
    await store.record({ version: 1, type: "run_started", runId: "old", at: 0, projectPath: store.projectPath });
    await store.record({ version: 1, type: "run_finished", runId: "old", at: DAY, status: "completed" });
    await store.record({ version: 1, type: "run_started", runId: "recent", at: 35 * DAY, projectPath: store.projectPath });
    await store.record({ version: 1, type: "run_finished", runId: "recent", at: 36 * DAY, status: "completed" });
    await store.flush();

    expect(store.listRuns().map((run) => run.id)).toEqual(["recent"]);
    expect(readFileSync(store.filePath, "utf8")).not.toContain('"runId":"old"');
  });

  it("supprime les runs complets les plus anciens quand la taille limite est dépassée", async () => {
    const store = makeStore({ maxBytes: 750, now: () => 200 });
    await store.initialize();
    for (const [index, runId] of ["old", "middle", "new"].entries()) {
      await store.record({ version: 1, type: "run_started", runId, at: 100 + index * 10, projectPath: store.projectPath });
      await store.record({
        version: 1,
        type: "tool_finished",
        runId,
        at: 105 + index * 10,
        toolCallId: `tool-${runId}`,
        toolName: "bash",
        status: "completed",
        output: "x".repeat(180),
      });
      await store.record({ version: 1, type: "run_finished", runId, at: 109 + index * 10, status: "completed" });
    }
    await store.flush();

    const ids = store.listRuns().map((run) => run.id);
    expect(ids).toContain("new");
    expect(ids).not.toContain("old");
    expect(statSync(store.filePath).size).toBeLessThanOrEqual(750);
  });
});

describe("ActivityTracker", () => {
  it("corrèle les outils parallèles par toolCallId et conserve leurs durées", async () => {
    let now = 1_000;
    const store = makeStore({ now: () => now });
    await store.initialize();
    const tracker = new ActivityTracker(store, { now: () => now, id: (() => { let i = 0; return () => `id-${++i}`; })() });

    await tracker.startRun("session.jsonl");
    now = 1_010;
    await tracker.startTool("tool-a", "read", { path: "a" });
    now = 1_020;
    await tracker.startTool("tool-b", "bash", { command: "echo ok" });
    now = 1_040;
    await tracker.finishTool("tool-b", { content: [{ type: "text", text: "ok" }] }, false);
    now = 1_070;
    await tracker.finishTool("tool-a", { content: [{ type: "text", text: "a" }] }, false);
    now = 1_100;
    await tracker.finishRun();

    const run = store.listRuns()[0]!;
    expect(run.status).toBe("completed");
    expect(run.durationMs).toBe(100);
    expect(run.steps.filter((step) => step.kind === "tool")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolCallId: "tool-a", durationMs: 60, status: "completed" }),
        expect.objectContaining({ toolCallId: "tool-b", durationMs: 20, status: "completed" }),
      ]),
    );
  });

  it("marque aussi les outils actifs comme interrompus", async () => {
    let now = 100;
    const store = makeStore({ now: () => now });
    await store.initialize();
    const tracker = new ActivityTracker(store, { now: () => now, id: () => "interrupted-run" });

    await tracker.startRun();
    now = 110;
    await tracker.startTool("active-tool", "bash", { command: "sleep 30" });
    tracker.markAbortRequested();
    now = 120;
    await tracker.finishRun();

    const run = store.listRuns()[0]!;
    const tool = run.steps.find((step) => step.toolCallId === "active-tool")!;
    expect(run.status).toBe("interrupted");
    expect(tool.status).toBe("interrupted");
    expect(tool.durationMs).toBe(10);
  });

  it("crée une étape récupérée si la fin d’outil arrive sans début", async () => {
    const store = makeStore({ now: () => 100 });
    await store.initialize();
    const tracker = new ActivityTracker(store, { now: () => 100, id: () => "run" });

    await tracker.startRun();
    await tracker.finishTool("missing", { content: [{ type: "text", text: "boom" }] }, true, "bash");
    await tracker.finishRun();

    const step = store.listRuns()[0]!.steps.find((item) => item.toolCallId === "missing")!;
    expect(step.status).toBe("failed");
    expect(step.durationMs).toBeUndefined();
    expect(store.listRuns()[0]!.status).toBe("completed_with_errors");
  });

  it("préserve l’ordre des écritures concurrentes", async () => {
    let now = 1;
    const store = makeStore({ now: () => now });
    await store.initialize();
    const tracker = new ActivityTracker(store, { now: () => now, id: () => "run" });

    await tracker.startRun();
    now = 2;
    const first = tracker.startTool("first", "read", {});
    now = 3;
    const second = tracker.startTool("second", "read", {});
    await Promise.all([first, second]);
    await store.flush();

    const lines = readFileSync(store.filePath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.filter((line) => line.type === "tool_started").map((line) => line.toolCallId)).toEqual(["first", "second"]);
  });
});
