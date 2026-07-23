import { useEffect, useState } from "react";
import { t } from "../i18n";
import { store, type StudioState } from "../ws";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

interface Props {
  state: StudioState;
  onToggleSessions: () => void;
  onToggleArtifacts: () => void;
}

export default function TopBar({ state, onToggleSessions, onToggleArtifacts }: Props) {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  const [modelPicker, setModelPicker] = useState(false);
  const [modelQuery, setModelQuery] = useState("");

  useEffect(() => {
    if (modelPicker) {
      store.send({ type: "list_models" });
      setModelQuery("");
    }
  }, [modelPicker]);

  const q = modelQuery.toLowerCase();
  const filteredModels = state.models
    .filter((m) => !q || `${m.provider}/${m.id}`.toLowerCase().includes(q) || (m.name ?? "").toLowerCase().includes(q))
    .slice(0, 30);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("pi-studio.theme", next);
  };

  const modelLabel = state.model ? `${state.model.provider ?? ""}/${state.model.id ?? state.model.name ?? "?"}` : "—";
  const ctxPct = state.contextUsage?.percent;

  return (
    <header className="topbar">
      <img className="logo" src="./logo.svg" alt="pi" />
      <span className="brand">
        pi<span>-studio</span>
      </span>
      <span className={`status-line`}>{state.connected ? t("status.connected") : t("status.disconnected")}</span>
      {state.sessionName && <span className="session-name" title={state.sessionFile}>{state.sessionName}</span>}
      <span className="spacer" />
      {typeof ctxPct === "number" && (
        <span className="ctx-usage" title={t("topbar.ctx")}>
          {ctxPct.toFixed(0)}% ctx
        </span>
      )}
      <div style={{ position: "relative" }}>
        <button onClick={() => setModelPicker((v) => !v)} title={t("model.picker")}>
          {modelLabel}
        </button>
        {modelPicker && (
          <div
            className="slash-menu"
            style={{ top: "calc(100% + 6px)", bottom: "auto", left: "auto", right: 0, minWidth: 360, maxHeight: 420 }}
          >
            <div style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "var(--panel)" }}>
              <input
                type="text"
                autoFocus
                value={modelQuery}
                onChange={(e) => setModelQuery(e.target.value)}
                placeholder={t("model.search")}
                style={{ width: "100%" }}
              />
            </div>
            {filteredModels.length === 0 && <div className="empty-state">…</div>}
            {filteredModels.map((m) => (
              <div
                key={`${m.provider}/${m.id}`}
                className="slash-item"
                onClick={() => {
                  store.send({ type: "set_model", provider: m.provider, modelId: m.id });
                  setModelPicker(false);
                }}
              >
                <span className="name">
                  {m.provider}/{m.id}
                </span>
                <span className="desc">{m.name ?? ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <select
        value={state.thinkingLevel}
        title={t("model.thinking")}
        onChange={(e) => store.send({ type: "set_thinking", level: e.target.value })}
      >
        {THINKING_LEVELS.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      <button onClick={onToggleSessions}>{t("topbar.sessions")}</button>
      <button onClick={onToggleArtifacts}>{t("topbar.artifacts")}</button>
      <button
        onClick={() => {
          if (window.confirm(t("topbar.newSession") + " ?")) store.send({ type: "new_session" });
        }}
      >
        +
      </button>
      <button onClick={toggleTheme} title={t("topbar.theme")}>
        {theme === "dark" ? "☀" : "☾"}
      </button>
    </header>
  );
}
