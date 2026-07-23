import { randomUUID } from "node:crypto";
import { ActivityStore } from "./store.js";

export interface ActivityTrackerOptions {
  now?: () => number;
  id?: () => string;
}

export class ActivityTracker {
  private readonly now: () => number;
  private readonly id: () => string;
  private activeRunId: string | null = null;
  private errorCount = 0;
  private abortRequested = false;

  constructor(private readonly store: ActivityStore, options: ActivityTrackerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.id = options.id ?? randomUUID;
  }

  get isRunning(): boolean {
    return this.activeRunId !== null;
  }

  async startRun(sessionFile?: string): Promise<string> {
    if (this.activeRunId) {
      await this.store.record({
        version: 1,
        type: "run_interrupted",
        runId: this.activeRunId,
        at: this.now(),
        reason: "Une nouvelle exécution a remplacé l’exécution active",
      });
    }

    const runId = this.id();
    this.activeRunId = runId;
    this.errorCount = 0;
    this.abortRequested = false;
    await this.store.record({
      version: 1,
      type: "run_started",
      runId,
      at: this.now(),
      projectPath: this.store.projectPath,
      sessionFile,
    });
    return runId;
  }

  async startTool(toolCallId: string, toolName: string, args: unknown): Promise<void> {
    const at = this.now();
    const runId = await this.ensureRun();
    await this.store.record({
      version: 1,
      type: "tool_started",
      runId,
      at,
      toolCallId,
      toolName,
      arguments: args,
    });
  }

  async finishTool(toolCallId: string, result: unknown, isError: boolean, toolName?: string): Promise<void> {
    const at = this.now();
    const runId = await this.ensureRun();
    if (isError) this.errorCount += 1;
    await this.store.record({
      version: 1,
      type: "tool_finished",
      runId,
      at,
      toolCallId,
      toolName,
      status: isError ? "failed" : "completed",
      output: result,
      error: isError ? result : undefined,
    });
  }

  markAbortRequested(): void {
    if (this.activeRunId) this.abortRequested = true;
  }

  async finishRun(): Promise<void> {
    const runId = this.activeRunId;
    if (!runId) return;

    if (this.abortRequested) {
      await this.store.record({
        version: 1,
        type: "run_interrupted",
        runId,
        at: this.now(),
        reason: "Interruption demandée depuis Pi Studio",
      });
    } else {
      await this.store.record({
        version: 1,
        type: "run_finished",
        runId,
        at: this.now(),
        status: this.errorCount > 0 ? "completed_with_errors" : "completed",
      });
    }

    this.activeRunId = null;
    this.errorCount = 0;
    this.abortRequested = false;
  }

  private async ensureRun(): Promise<string> {
    if (!this.activeRunId) return this.startRun();
    return this.activeRunId;
  }
}
