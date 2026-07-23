import { createHash } from "node:crypto";
import { appendFile, chmod, mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { safeActivityJson, sanitizeActivityPayload, sanitizeForActivity } from "./redact.js";
import type { ActivityJournalEvent, ActivityRun, ActivityStep } from "./types.js";

const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

export interface ActivityStoreOptions {
  cwd: string;
  agentDir?: string;
  now?: () => number;
  maxAgeMs?: number;
  maxBytes?: number;
}

function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function duration(startedAt: string | undefined, endedAt: string): number | undefined {
  if (!startedAt) return undefined;
  const value = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isJournalEvent(value: unknown): value is ActivityJournalEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return event.version === 1 && typeof event.runId === "string" && typeof event.at === "number" &&
    ["run_started", "tool_started", "tool_finished", "run_finished", "run_interrupted"].includes(String(event.type));
}

export class ActivityStore {
  readonly projectPath: string;
  readonly directoryPath: string;
  readonly filePath: string;

  private readonly now: () => number;
  private readonly maxAgeMs: number;
  private readonly maxBytes: number;
  private readonly runs = new Map<string, ActivityRun>();
  private readonly eventsByRun = new Map<string, ActivityJournalEvent[]>();
  private pending: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(options: ActivityStoreOptions) {
    this.projectPath = canonicalPath(options.cwd);
    const id = createHash("sha256").update(this.projectPath).digest("hex");
    this.directoryPath = join(options.agentDir ?? getAgentDir(), "pi-studio", "activity");
    this.filePath = join(this.directoryPath, `${id}.jsonl`);
    this.now = options.now ?? Date.now;
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.directoryPath, { recursive: true, mode: 0o700 });
    await chmod(this.directoryPath, 0o700);
    await writeFile(this.filePath, "", { flag: "a", mode: 0o600 });
    await chmod(this.filePath, 0o600);

    const content = await readFile(this.filePath, "utf8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (isJournalEvent(parsed)) this.applyEvent(parsed);
      } catch {
        // Une ligne incomplète/corrompue ne doit pas empêcher la récupération.
      }
    }
    this.initialized = true;

    const orphanIds = [...this.runs.values()].filter((run) => run.status === "running").map((run) => run.id);
    for (const runId of orphanIds) {
      await this.record({
        version: 1,
        type: "run_interrupted",
        runId,
        at: this.now(),
        reason: "Exécution interrompue avant sa clôture",
      });
    }
    await this.purgeIfNeeded(true);
  }

  listRuns(): ActivityRun[] {
    return [...this.runs.values()]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((run) => structuredClone(run));
  }

  getRun(runId: string): ActivityRun | undefined {
    const run = this.runs.get(runId);
    return run ? structuredClone(run) : undefined;
  }

  record(event: ActivityJournalEvent): Promise<void> {
    if (!this.initialized) return Promise.reject(new Error("ActivityStore non initialisé"));
    const safeEvent = this.sanitizeEvent(event);
    const operation = this.pending.then(async () => {
      await appendFile(this.filePath, `${safeActivityJson(safeEvent)}\n`, { encoding: "utf8", mode: 0o600 });
      this.applyEvent(safeEvent);
      if (safeEvent.type === "run_finished" || safeEvent.type === "run_interrupted") {
        await this.syncFile(this.filePath);
      }
      await this.purgeIfNeeded(false);
    });
    this.pending = operation.catch(() => {});
    return operation;
  }

  async flush(): Promise<void> {
    await this.pending;
  }

  async clear(): Promise<void> {
    await this.flush();
    this.runs.clear();
    this.eventsByRun.clear();
    await this.rewriteJournal();
  }

  private sanitizeEvent(event: ActivityJournalEvent): ActivityJournalEvent {
    if (event.type === "tool_started") {
      const { arguments: args, ...base } = event;
      return { ...(sanitizeForActivity(base) as typeof base), arguments: sanitizeActivityPayload(args) };
    }
    if (event.type === "tool_finished") {
      const { output, error, ...base } = event;
      return {
        ...(sanitizeForActivity(base) as typeof base),
        ...(typeof output === "undefined" ? {} : { output: sanitizeActivityPayload(output) }),
        ...(typeof error === "undefined" ? {} : { error: sanitizeActivityPayload(error) }),
      };
    }
    return sanitizeForActivity(event) as ActivityJournalEvent;
  }

  private applyEvent(event: ActivityJournalEvent): void {
    const existingEvents = this.eventsByRun.get(event.runId) ?? [];
    existingEvents.push(event);
    this.eventsByRun.set(event.runId, existingEvents);

    if (event.type === "run_started") {
      if (this.runs.has(event.runId)) return;
      const startedAt = iso(event.at);
      this.runs.set(event.runId, {
        id: event.runId,
        projectPath: event.projectPath,
        sessionFile: event.sessionFile,
        startedAt,
        status: "running",
        toolCount: 0,
        errorCount: 0,
        steps: [{ id: `${event.runId}:agent`, kind: "agent", startedAt, status: "running" }],
      });
      return;
    }

    const run = this.runs.get(event.runId);
    if (!run) return;

    if (event.type === "tool_started") {
      const existing = run.steps.find((step) => step.toolCallId === event.toolCallId);
      if (!existing) {
        run.steps.push({
          id: `${event.runId}:tool:${event.toolCallId}`,
          kind: "tool",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          startedAt: iso(event.at),
          status: "running",
          arguments: event.arguments,
        });
        run.toolCount += 1;
      }
      return;
    }

    if (event.type === "tool_finished") {
      const endedAt = iso(event.at);
      let step = run.steps.find((item) => item.toolCallId === event.toolCallId);
      if (!step) {
        step = {
          id: `${event.runId}:tool:${event.toolCallId}`,
          kind: "tool",
          toolCallId: event.toolCallId,
          toolName: event.toolName ?? "outil",
          startedAt: endedAt,
          status: event.status,
          recovered: true,
        };
        run.steps.push(step);
        run.toolCount += 1;
      } else {
        step.status = event.status;
        step.durationMs = duration(step.startedAt, endedAt);
      }
      const wasFinished = Boolean(step.endedAt);
      step.endedAt = endedAt;
      step.output = event.output;
      step.error = event.error;
      if (event.status === "failed" && !wasFinished) run.errorCount += 1;
      return;
    }

    const endedAt = iso(event.at);
    run.endedAt = endedAt;
    run.durationMs = duration(run.startedAt, endedAt);
    const agentStep = run.steps.find((step) => step.kind === "agent");
    if (agentStep) {
      agentStep.endedAt = endedAt;
      agentStep.durationMs = duration(agentStep.startedAt, endedAt);
    }
    if (event.type === "run_interrupted") {
      run.status = "interrupted";
      run.interruptionReason = event.reason;
      for (const step of run.steps.filter((item) => item.status === "running")) {
        step.status = "interrupted";
        step.endedAt = endedAt;
        step.durationMs = duration(step.startedAt, endedAt);
      }
    } else {
      run.status = event.status;
      if (agentStep) agentStep.status = "completed";
    }
  }

  private async purgeIfNeeded(forceAgeCheck: boolean): Promise<void> {
    const cutoff = this.now() - this.maxAgeMs;
    let changed = false;
    for (const run of [...this.runs.values()]) {
      if (run.status !== "running" && new Date(run.endedAt ?? run.startedAt).getTime() < cutoff) {
        this.runs.delete(run.id);
        this.eventsByRun.delete(run.id);
        changed = true;
      }
    }

    let fileSize = 0;
    try {
      fileSize = (await stat(this.filePath)).size;
    } catch {
      fileSize = 0;
    }

    if (fileSize > this.maxBytes) {
      const removable = [...this.runs.values()]
        .filter((run) => run.status !== "running")
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      while (fileSize > this.maxBytes && removable.length > 1) {
        const oldest = removable.shift()!;
        this.runs.delete(oldest.id);
        this.eventsByRun.delete(oldest.id);
        changed = true;
        fileSize = this.serializedJournalSize();
      }
    }

    if (changed || forceAgeCheck && fileSize > this.maxBytes) await this.rewriteJournal();
  }

  private serializedJournalSize(): number {
    let bytes = 0;
    for (const events of this.eventsByRun.values()) {
      for (const event of events) bytes += Buffer.byteLength(`${safeActivityJson(event)}\n`, "utf8");
    }
    return bytes;
  }

  private async rewriteJournal(): Promise<void> {
    const lines: string[] = [];
    for (const run of [...this.runs.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
      for (const event of this.eventsByRun.get(run.id) ?? []) lines.push(safeActivityJson(event));
    }
    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tempPath, lines.length > 0 ? `${lines.join("\n")}\n` : "", { mode: 0o600 });
    await chmod(tempPath, 0o600);
    await this.syncFile(tempPath);
    await rename(tempPath, this.filePath);
    await chmod(this.filePath, 0o600);
  }

  private async syncFile(path: string): Promise<void> {
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
