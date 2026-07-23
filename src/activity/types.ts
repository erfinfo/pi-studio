export type ActivityRunStatus = "running" | "completed" | "completed_with_errors" | "interrupted";
export type ActivityStepStatus = "running" | "completed" | "failed" | "interrupted";

export interface ActivityStep {
  id: string;
  kind: "agent" | "tool";
  toolCallId?: string;
  toolName?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  status: ActivityStepStatus;
  arguments?: unknown;
  output?: unknown;
  error?: unknown;
  recovered?: boolean;
}

export interface ActivityRun {
  id: string;
  projectPath: string;
  sessionFile?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status: ActivityRunStatus;
  toolCount: number;
  errorCount: number;
  interruptionReason?: string;
  steps: ActivityStep[];
}

interface JournalBase {
  version: 1;
  runId: string;
  at: number;
}

export interface RunStartedEvent extends JournalBase {
  type: "run_started";
  projectPath: string;
  sessionFile?: string;
}

export interface ToolStartedEvent extends JournalBase {
  type: "tool_started";
  toolCallId: string;
  toolName: string;
  arguments?: unknown;
}

export interface ToolFinishedEvent extends JournalBase {
  type: "tool_finished";
  toolCallId: string;
  toolName?: string;
  status: "completed" | "failed";
  output?: unknown;
  error?: unknown;
}

export interface RunFinishedEvent extends JournalBase {
  type: "run_finished";
  status: "completed" | "completed_with_errors";
}

export interface RunInterruptedEvent extends JournalBase {
  type: "run_interrupted";
  reason: string;
}

export type ActivityJournalEvent =
  | RunStartedEvent
  | ToolStartedEvent
  | ToolFinishedEvent
  | RunFinishedEvent
  | RunInterruptedEvent;
