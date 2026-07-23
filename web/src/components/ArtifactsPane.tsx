import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { t } from "../i18n";
import { store, type Artifact, type StudioState } from "../ws";

interface Props {
  state: StudioState;
  onClose: () => void;
}

interface FileContent {
  path: string;
  content?: string;
  base64?: string;
  mime?: string;
  error?: string;
}

function DiffView({ patch }: { patch: string }) {
  return (
    <pre className="mono" style={{ fontSize: 12, margin: 0 }}>
      {patch.split("\n").map((line, i) => {
        let cls = "";
        if (line.startsWith("+") && !line.startsWith("+++")) cls = "diff-add";
        else if (line.startsWith("-") && !line.startsWith("---")) cls = "diff-del";
        else if (line.startsWith("@@")) cls = "diff-hunk";
        return (
          <div key={i} className={cls}>
            {line}
          </div>
        );
      })}
    </pre>
  );
}

function Preview({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  const [file, setFile] = useState<FileContent | null>(null);
  const [tab, setTab] = useState<"preview" | "diff">("preview");

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as FileContent;
      if (detail.path === artifact.path) setFile(detail);
    };
    window.addEventListener("pi-studio:file", handler);
    store.send({ type: "read_file", path: artifact.path });
    return () => window.removeEventListener("pi-studio:file", handler);
  }, [artifact.path]);

  const isMarkdown = /\.(md|markdown)$/i.test(artifact.path);
  const hasDiff = Boolean(artifact.patch);

  return (
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="preview-head">
          <span className="mono" style={{ fontSize: 13 }}>{artifact.path}</span>
          <span style={{ display: "flex", gap: "0.4rem" }}>
            {hasDiff && (
              <>
                <button onClick={() => setTab("preview")} disabled={tab === "preview"}>
                  {t("artifacts.preview")}
                </button>
                <button onClick={() => setTab("diff")} disabled={tab === "diff"}>
                  {t("artifacts.diff")}
                </button>
              </>
            )}
            <button onClick={onClose}>✕</button>
          </span>
        </div>
        <div className="preview-body">
          {tab === "diff" && artifact.patch ? (
            <DiffView patch={artifact.patch} />
          ) : !file ? (
            <div className="empty-state">…</div>
          ) : file.error ? (
            <div className="error-banner">{file.error}</div>
          ) : file.base64 ? (
            <img src={`data:${file.mime};base64,${file.base64}`} alt={artifact.path} />
          ) : isMarkdown ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{file.content ?? ""}</ReactMarkdown>
          ) : (
            <pre className="mono" style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
              {file.content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ArtifactsPane({ state, onClose }: Props) {
  const [selected, setSelected] = useState<Artifact | null>(null);

  return (
    <aside className="sidepanel">
      <div className="panel-head">
        <span>{t("artifacts.title")}</span>
        <button onClick={onClose}>{t("artifacts.close")}</button>
      </div>
      <div className="panel-body">
        {state.artifacts.length === 0 && <div className="empty-state">{t("artifacts.empty")}</div>}
        {state.artifacts.map((a) => (
          <div key={a.path} className="artifact-item" onClick={() => setSelected(a)}>
            <div className="path mono" style={{ fontSize: 13 }}>{a.path}</div>
            <div className="meta">
              <span className="tool">{a.tool}</span>
              {a.patch && <span>diff</span>}
              {a.isError && <span className="err">erreur</span>}
              <span>{new Date(a.timestamp).toLocaleTimeString("fr-CA")}</span>
            </div>
          </div>
        ))}
      </div>
      {selected && <Preview artifact={selected} onClose={() => setSelected(null)} />}
    </aside>
  );
}
