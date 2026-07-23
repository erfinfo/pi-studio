import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { t } from "../i18n";
import type { AssistantItem, StudioState, ToolItem, UserItem } from "../ws";

function UserBubble({ item }: { item: UserItem }) {
  return (
    <div className="msg user">
      <div className="role">{t("chat.you")}</div>
      <div className="bubble">{item.text}</div>
    </div>
  );
}

function AssistantBubble({ item }: { item: AssistantItem }) {
  return (
    <div className="msg assistant">
      <div className="role">{t("chat.assistant")}</div>
      <div className="bubble">
        {item.thinking && (
          <details className="thinking">
            <summary>{t("chat.thinking")}</summary>
            <div style={{ whiteSpace: "pre-wrap", marginTop: "0.3rem" }}>{item.thinking}</div>
          </details>
        )}
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
      </div>
    </div>
  );
}

function ToolCard({ item }: { item: ToolItem }) {
  const argsText = item.args ? JSON.stringify(item.args).slice(0, 300) : "";
  return (
    <div className="msg">
      <div className="toolcard">
        <div className="tool-head">
          <span className="tool-name">{item.name}</span>
          <span className={`tool-status ${item.status === "error" ? "error" : item.status === "done" ? "ok" : ""}`}>
            {item.status === "running" ? "…" : item.status === "done" ? "✓" : "✗"}
          </span>
        </div>
        {argsText && <pre>{argsText}</pre>}
        {item.output && (
          <details>
            <summary style={{ cursor: "pointer", color: "var(--muted)" }}>output</summary>
            <pre>{item.output.slice(0, 4000)}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

export default function Chat({ state }: { state: StudioState }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state.items.length, state.streamText.length]);

  return (
    <main className="chat">
      {state.items.length === 0 && !state.isStreaming && <div className="empty-state">{t("chat.empty")}</div>}
      {state.items.map((item) => {
        if (item.kind === "user") return <UserBubble key={item.id} item={item} />;
        if (item.kind === "assistant") return <AssistantBubble key={item.id} item={item} />;
        return <ToolCard key={item.id} item={item} />;
      })}
      {(state.streamText || state.streamThinking) && (
        <AssistantBubble
          item={{ kind: "assistant", id: "streaming", text: state.streamText, thinking: state.streamThinking || undefined }}
        />
      )}
      {state.isStreaming && !state.streamText && <div className="status-line">{t("chat.streaming")}</div>}
      <div ref={bottomRef} />
    </main>
  );
}
