import { t } from "../i18n";
import { store, type StudioState } from "../ws";

interface Props {
  state: StudioState;
  onClose: () => void;
}

export default function SessionsPanel({ state, onClose }: Props) {
  return (
    <aside className="sidepanel">
      <div className="panel-head">
        <span>{t("sessions.title")}</span>
        <button onClick={onClose}>{t("sessions.close")}</button>
      </div>
      <div className="panel-body">
        {state.sessions.length === 0 && <div className="empty-state">{t("sessions.empty")}</div>}
        {state.sessions.map((s) => (
          <div
            key={s.path}
            className="session-item"
            onClick={() => {
              store.send({ type: "resume_session", path: s.path });
              onClose();
            }}
          >
            <div className="name">{s.name || s.firstMessage || s.id}</div>
            <div className="meta">
              <span>{s.modified ? new Date(s.modified).toLocaleString("fr-CA") : ""}</span>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
