import { t } from "../i18n";
import { store, type ActivityRun, type ActivityRunStatus, type ActivityStep, type ActivityStepStatus, type StudioState } from "../ws";

interface Props {
  state: StudioState;
  onClose: () => void;
}

const RUN_STATUS_KEYS: Record<ActivityRunStatus, string> = {
  running: "activity.status.running",
  completed: "activity.status.completed",
  completed_with_errors: "activity.status.completedWithErrors",
  interrupted: "activity.status.interrupted",
};

const STEP_STATUS_KEYS: Record<ActivityStepStatus, string> = {
  running: "activity.status.running",
  completed: "activity.status.completed",
  failed: "activity.status.failed",
  interrupted: "activity.status.interrupted",
};

export function formatActivityDuration(durationMs?: number): string {
  if (typeof durationMs !== "number") return "—";
  if (durationMs < 1_000) return `${durationMs} ms`;
  const seconds = Math.floor(durationMs / 1_000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds > 0 ? `${minutes} min ${remainingSeconds} s` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours} h ${remainingMinutes} min` : `${hours} h`;
}

function formatDate(value?: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-CA", {
    timeZone: "America/Montreal",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDetail(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function StatusBadge({ status, kind }: { status: ActivityRunStatus | ActivityStepStatus; kind: "run" | "step" }) {
  const key = kind === "run" ? RUN_STATUS_KEYS[status as ActivityRunStatus] : STEP_STATUS_KEYS[status as ActivityStepStatus];
  return <span className={`activity-status status-${status}`}>{t(key)}</span>;
}

function ActivityDetail({ label, value }: { label: string; value: unknown }) {
  if (typeof value === "undefined") return null;
  return (
    <details className="activity-detail">
      <summary>{label}</summary>
      <pre className="mono">{formatDetail(value)}</pre>
    </details>
  );
}

function ActivityStepRow({ step }: { step: ActivityStep }) {
  return (
    <li className={`activity-step step-${step.status}`}>
      <div className="activity-step-head">
        <span className="activity-step-name">{step.kind === "agent" ? t("activity.agent") : step.toolName ?? t("activity.tool")}</span>
        <StatusBadge status={step.status} kind="step" />
      </div>
      <div className="activity-meta">
        <span>{formatDate(step.startedAt)}</span>
        <span>{formatActivityDuration(step.durationMs)}</span>
        {step.recovered && <span>{t("activity.recovered")}</span>}
      </div>
      <ActivityDetail label={t("activity.arguments")} value={step.arguments} />
      <ActivityDetail label={t("activity.output")} value={step.output} />
      <ActivityDetail label={t("activity.error")} value={step.error} />
    </li>
  );
}

function ActivityRunCard({ run }: { run: ActivityRun }) {
  return (
    <details className={`activity-run run-${run.status}`} open={run.status === "running"}>
      <summary>
        <span className="activity-run-summary">
          <span className="activity-run-title">
            <StatusBadge status={run.status} kind="run" />
            <span>{formatDate(run.startedAt)}</span>
          </span>
          <span className="activity-meta">
            <span>{formatActivityDuration(run.durationMs)}</span>
            <span>{run.toolCount} {run.toolCount === 1 ? t("activity.oneTool") : t("activity.tools")}</span>
            <span>{run.errorCount} {run.errorCount === 1 ? t("activity.oneError") : t("activity.errors")}</span>
          </span>
        </span>
      </summary>
      {run.interruptionReason && <div className="activity-interruption">{run.interruptionReason}</div>}
      <ol className="activity-steps">
        {run.steps.map((step) => <ActivityStepRow key={step.id} step={step} />)}
      </ol>
    </details>
  );
}

export default function ActivityPanel({ state, onClose }: Props) {
  const { activity } = state;
  const clear = () => {
    if (window.confirm(t("activity.clearConfirm"))) store.send({ type: "clear_activity" });
  };

  return (
    <aside className="sidepanel activity-panel" aria-label={t("activity.title")}>
      <div className="panel-head">
        <span>{t("activity.title")}</span>
        <span className="panel-actions">
          <button className="danger" onClick={clear} disabled={activity.isRunning || activity.runs.length === 0} title={activity.isRunning ? t("activity.clearDisabled") : t("activity.clear")}>
            {t("activity.clear")}
          </button>
          <button onClick={onClose}>{t("activity.close")}</button>
        </span>
      </div>
      <div className="activity-privacy" role="note">{t("activity.privacy")}</div>
      <div className="panel-body">
        {activity.persistenceError && <div className="activity-storage-error" role="alert">{t("activity.storageError")}: {activity.persistenceError}</div>}
        {activity.runs.length === 0 && <div className="empty-state">{t("activity.empty")}</div>}
        {activity.runs.map((run) => <ActivityRunCard key={run.id} run={run} />)}
      </div>
    </aside>
  );
}
