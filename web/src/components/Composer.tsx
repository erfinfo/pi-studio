import { useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import { store, type CommandInfo, type StudioState } from "../ws";

export default function Composer({ state }: { state: StudioState }) {
  const [text, setText] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const slashQuery = useMemo(() => {
    if (!text.startsWith("/")) return null;
    const first = text.split(/\s/)[0];
    return first.slice(1);
  }, [text]);

  const matches: CommandInfo[] = useMemo(() => {
    if (slashQuery === null) return [];
    const q = slashQuery.toLowerCase();
    return state.commands.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 12);
  }, [slashQuery, state.commands]);

  const showSlash = slashQuery !== null && matches.length > 0 && !text.includes(" ");

  const submit = (mode: "auto" | "steer" | "followUp") => {
    const value = text.trim();
    if (!value) return;
    if (mode === "steer") store.steer(value);
    else if (mode === "followUp") store.followUp(value);
    else store.sendPrompt(value);
    setText("");
    setSlashIndex(0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlash) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, matches.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && matches.length > 0)) {
        e.preventDefault();
        const chosen = matches[slashIndex] ?? matches[0];
        setText(`/${chosen.name} `);
        setSlashIndex(0);
        return;
      }
      if (e.key === "Escape") {
        setText("");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit("auto");
    }
  };

  return (
    <div className="composer">
      {showSlash && (
        <div className="slash-menu">
          {matches.map((c, i) => (
            <div
              key={`${c.source}-${c.name}`}
              className={`slash-item ${i === slashIndex ? "active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                setText(`/${c.name} `);
                textareaRef.current?.focus();
              }}
            >
              <span className="name">/{c.name}</span>
              <span className="slash-badge">{c.source}</span>
              <span className="desc">{c.description ?? ""}</span>
            </div>
          ))}
        </div>
      )}
      <div className="composer-inner">
        <textarea
          ref={textareaRef}
          value={text}
          placeholder={t("composer.placeholder")}
          rows={Math.min(6, Math.max(2, text.split("\n").length))}
          onChange={(e) => {
            setText(e.target.value);
            setSlashIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="actions">
          {state.isStreaming ? (
            <>
              <button onClick={() => submit("steer")} title="steer">
                {t("composer.steer")}
              </button>
              <button onClick={() => submit("followUp")} title="followUp">
                {t("composer.followUp")}
              </button>
              <button className="danger" onClick={() => store.send({ type: "abort" })}>
                {t("composer.abort")}
              </button>
            </>
          ) : (
            <button className="primary" onClick={() => submit("auto")}>
              {t("composer.send")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
