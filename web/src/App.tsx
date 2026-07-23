import { useEffect, useState, useSyncExternalStore } from "react";
import ArtifactsPane from "./components/ArtifactsPane";
import AskDialog from "./components/AskDialog";
import Chat from "./components/Chat";
import Composer from "./components/Composer";
import SessionsPanel from "./components/SessionsPanel";
import TopBar from "./components/TopBar";
import { store, type StudioState } from "./ws";

export function useStudio(): StudioState {
  return useSyncExternalStore(store.subscribe, () => store.state);
}

export default function App() {
  const state = useStudio();
  const [showSessions, setShowSessions] = useState(false);
  const [showArtifacts, setShowArtifacts] = useState(false);

  useEffect(() => {
    store.connect();
  }, []);

  return (
    <div className="app">
      <TopBar
        state={state}
        onToggleSessions={() => {
          setShowSessions((v) => {
            if (!v) store.send({ type: "list_sessions" });
            return !v;
          });
          setShowArtifacts(false);
        }}
        onToggleArtifacts={() => {
          setShowArtifacts((v) => !v);
          setShowSessions(false);
        }}
      />
      <div className={`app-body ${showArtifacts || showSessions ? "with-artifacts" : ""}`}>
        <Chat state={state} />
        {showSessions && <SessionsPanel state={state} onClose={() => setShowSessions(false)} />}
        {showArtifacts && <ArtifactsPane state={state} onClose={() => setShowArtifacts(false)} />}
      </div>
      <div>
        {state.error && (
          <div className="error-banner">
            {state.error}{" "}
            <button onClick={() => store.send({ type: "get_snapshot" })} style={{ marginLeft: "0.5rem" }}>
              ↻
            </button>
          </div>
        )}
        <Composer state={state} />
      </div>
      {state.ask && <AskDialog ask={state.ask} />}
    </div>
  );
}
