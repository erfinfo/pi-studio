import { ActivityStore } from "./store.js";
import { ActivityTracker } from "./tracker.js";
import type { ActivityRun } from "./types.js";

export interface ActivityRuntimeState {
  runs: ActivityRun[];
  persistenceError?: string;
  projectPath?: string;
  isRunning: boolean;
}

interface RuntimeOptions {
  agentDir?: string;
}

let store: ActivityStore | null = null;
let tracker: ActivityTracker | null = null;
let enabled = false;
let persistenceError: string | undefined;
let options: RuntimeOptions = {};

export async function enableActivity(cwd: string, runtimeOptions: RuntimeOptions = {}): Promise<void> {
  enabled = true;
  options = runtimeOptions;
  await switchActivityProject(cwd);
}

export async function switchActivityProject(cwd: string): Promise<void> {
  if (!enabled) return;
  const candidate = new ActivityStore({ cwd, agentDir: options.agentDir });
  if (store?.projectPath === candidate.projectPath) return;

  if (tracker?.isRunning) {
    tracker.markAbortRequested();
    await tracker.finishRun().catch(() => {});
  }

  try {
    await candidate.initialize();
    store = candidate;
    tracker = new ActivityTracker(candidate);
    persistenceError = undefined;
  } catch (error) {
    store = null;
    tracker = null;
    persistenceError = error instanceof Error ? error.message : String(error);
  }
}

export async function trackActivityEvent(eventName: string, data: unknown, sessionFile?: string): Promise<boolean> {
  if (!tracker) return false;
  const event = data as Record<string, unknown> | undefined;
  try {
    switch (eventName) {
      case "agent_start":
        await tracker.startRun(sessionFile);
        return true;
      case "tool_execution_start":
        await tracker.startTool(
          String(event?.toolCallId ?? ""),
          String(event?.toolName ?? "outil"),
          event?.args ?? event?.input,
        );
        return true;
      case "tool_execution_end":
        await tracker.finishTool(
          String(event?.toolCallId ?? ""),
          event?.result,
          Boolean(event?.isError),
          event?.toolName ? String(event.toolName) : undefined,
        );
        return true;
      case "agent_settled":
        await tracker.finishRun();
        return true;
      default:
        return false;
    }
  } catch (error) {
    persistenceError = error instanceof Error ? error.message : String(error);
    return true;
  }
}

export function markActivityAbortRequested(): void {
  tracker?.markAbortRequested();
}

export function getActivityState(): ActivityRuntimeState {
  return {
    runs: store?.listRuns() ?? [],
    persistenceError,
    projectPath: store?.projectPath,
    isRunning: tracker?.isRunning ?? false,
  };
}

export async function clearActivity(): Promise<void> {
  if (!store) return;
  if (tracker?.isRunning) throw new Error("impossible d’effacer l’activité pendant une exécution");
  try {
    await store.clear();
    persistenceError = undefined;
  } catch (error) {
    persistenceError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

export async function resetActivityForTests(): Promise<void> {
  if (tracker?.isRunning) {
    tracker.markAbortRequested();
    await tracker.finishRun().catch(() => {});
  }
  store = null;
  tracker = null;
  enabled = false;
  persistenceError = undefined;
  options = {};
}
