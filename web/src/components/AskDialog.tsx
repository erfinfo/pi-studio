import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { t } from "../i18n";
import { store, type AskSelection, type PendingAsk } from "../ws";

interface Props {
  ask: PendingAsk;
}

export default function AskDialog({ ask }: Props) {
  const [selections, setSelections] = useState<Record<number, Set<string>>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});

  const toggle = (qi: number, label: string, multi: boolean) => {
    setSelections((prev) => {
      const next = { ...prev };
      const set = new Set(next[qi] ?? []);
      if (multi) {
        if (set.has(label)) set.delete(label);
        else set.add(label);
      } else {
        if (set.has(label)) set.clear();
        else {
          set.clear();
          set.add(label);
        }
      }
      next[qi] = set;
      return next;
    });
  };

  const submit = () => {
    const payload: AskSelection[] = ask.questions.map((_, qi) => {
      const sel = [...(selections[qi] ?? [])];
      const customInput = (custom[qi] ?? "").trim() || undefined;
      return customInput && sel.length === 0 ? { selectedOptions: [], customInput } : { selectedOptions: sel, ...(customInput ? { customInput } : {}) };
    });
    store.answerAsk(ask.askId, payload);
  };

  return (
    <div className="preview-overlay">
      <div className="preview-modal" style={{ maxWidth: 640 }}>
        <div className="preview-head">
          <span>{t("ask.title")}</span>
          <button onClick={() => store.dismissAsk()}>✕</button>
        </div>
        <div className="preview-body">
          {ask.questions.map((q, qi) => (
            <div key={q.id} style={{ marginBottom: "1.2rem" }}>
              <div style={{ fontWeight: 700, marginBottom: "0.4rem" }}>{q.question}</div>
              {q.description && (
                <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: "0.5rem" }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{q.description}</ReactMarkdown>
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                {q.options.map((opt, oi) => {
                  const active = selections[qi]?.has(opt.label) ?? false;
                  return (
                    <button
                      key={opt.label}
                      onClick={() => toggle(qi, opt.label, q.multi ?? false)}
                      style={{
                        textAlign: "left",
                        borderColor: active ? "var(--accent)" : undefined,
                        background: active ? "var(--accent-soft)" : undefined,
                      }}
                    >
                      {active ? "◉ " : "○ "}
                      {opt.label}
                      {q.recommended === oi && <span style={{ color: "var(--muted)", fontSize: 12 }}> ({t("ask.recommended")})</span>}
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                placeholder={t("ask.other")}
                value={custom[qi] ?? ""}
                onChange={(e) => setCustom((prev) => ({ ...prev, [qi]: e.target.value }))}
                style={{ width: "100%", marginTop: "0.4rem" }}
              />
            </div>
          ))}
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button onClick={() => store.dismissAsk()}>{t("ask.cancel")}</button>
            <button className="primary" onClick={submit}>
              {t("ask.submit")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
