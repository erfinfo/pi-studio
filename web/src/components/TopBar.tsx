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
      <div className="topbar-inner">
        <div className="brand-cluster">
          <img className="logo" src="./logo.svg" alt="pi" />
          <span className="brand">
            pi<span>-studio</span>
          </span>
        </div>
        <span className={`connection-status ${state.connected ? "online" : "offline"}`}>
          <span className="connection-dot" />
          {state.connected ? t("status.connected") : t("status.disconnected")}
        </span>
        {state.sessionName && (
          <span className="session-name" title={state.sessionFile}>
            {state.sessionName}
          </span>
        )}
        <span className="spacer" />
        <nav className="topbar-actions" aria-label="Contrôles pi-studio">
          {typeof ctxPct === "number" && (
            <span className="ctx-usage" title={t("topbar.ctx")}>
              <span>{ctxPct.toFixed(0)}%</span> ctx
            </span>
          )}
          <div className="model-control">
            <button className="toolbar-button model-button mono" onClick={() => setModelPicker((v) => !v)} title={t("model.picker")}>
              <span className="model-label">{modelLabel}</span>
              <span className="chevron">⌄</span>
            </button>
            {modelPicker && (
              <div className="slash-menu model-menu">
                <div className="model-search">
                  <input
                    type="text"
                    autoFocus
                    value={modelQuery}
                    onChange={(e) => setModelQuery(e.target.value)}
                    placeholder={t("model.search")}
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
            className="thinking-select"
            value={state.thinkingLevel}
            title={t("model.thinking")}
            aria-label={t("model.thinking")}
            onChange={(e) => store.send({ type: "set_thinking", level: e.target.value })}
          >
            {THINKING_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <button className="toolbar-button" onClick={onToggleSessions}>{t("topbar.sessions")}</button>
          <button className="toolbar-button" onClick={onToggleArtifacts}>{t("topbar.artifacts")}</button>
          <button
            className="toolbar-button icon-button"
            title={t("topbar.newSession")}
            aria-label={t("topbar.newSession")}
            onClick={() => {
              if (window.confirm(t("topbar.newSession") + " ?")) store.send({ type: "new_session" });
            }}
          >
            +
          </button>
          <button className="toolbar-button icon-button" onClick={toggleTheme} title={t("topbar.theme")} aria-label={t("topbar.theme")}>
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </nav>
      </div>
    </header>
  );
}
