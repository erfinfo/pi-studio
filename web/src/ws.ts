/**
 * Client WebSocket + store réactif minimal pour pi-studio.
 */

export interface CommandInfo {
  name: string;
  description?: string;
  source: string;
}

export interface Artifact {
  path: string;
  tool: string;
  timestamp: string;
  isError: boolean;
  patch?: string;
  diff?: string;
}

export interface ModelInfo {
  provider: string;
  id: string;
  name?: string;
}

export interface SessionInfo {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  firstMessage?: string;
  modified?: string;
}

export interface ToolItem {
  kind: "tool";
  id: string;
  toolCallId: string;
  name: string;
  args?: unknown;
  status: "running" | "done" | "error";
  output?: string;
}

export interface UserItem {
  kind: "user";
  id: string;
  text: string;
  entryId?: string;
}

export interface AssistantItem {
  kind: "assistant";
  id: string;
  text: string;
  thinking?: string;
}

export type ChatItem = UserItem | AssistantItem | ToolItem;

export interface AskQuestion {
  id: string;
  question: string;
  description?: string;
  options: Array<{ label: string }>;
  multi?: boolean;
  recommended?: number;
}

export interface PendingAsk {
  askId: string;
  questions: AskQuestion[];
}

export interface AskSelection {
  selectedOptions: string[];
  customInput?: string;
}

export interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface StudioState {
  connected: boolean;
  cwd: string;
  sessionFile?: string;
  sessionName?: string;
  commands: CommandInfo[];
  thinkingLevel: string;
  model: { provider?: string; id?: string; name?: string } | null;
  isStreaming: boolean;
  streamText: string;
  streamThinking: string;
  items: ChatItem[];
  artifacts: Artifact[];
  contextUsage?: ContextUsage;
  sessions: SessionInfo[];
  models: ModelInfo[];
  error: string | null;
  ask: PendingAsk | null;
}

const initialState: StudioState = {
  connected: false,
  cwd: "",
  commands: [],
  thinkingLevel: "off",
  model: null,
  isStreaming: false,
  streamText: "",
  streamThinking: "",
  items: [],
  artifacts: [],
  sessions: [],
  models: [],
  error: null,
  ask: null,
};

type Listener = () => void;

class StudioStore {
  state: StudioState = { ...initialState };
  private listeners = new Set<Listener>();
  private ws: WebSocket | null = null;
  private idCounter = 0;

  private nextId(): string {
    return `item-${++this.idCounter}`;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify(): void {
    for (const l of this.listeners) l();
  }

  private patch(partial: Partial<StudioState>): void {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  connect(): void {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws?token=${token}`);
    this.ws = ws;

    ws.onopen = () => this.patch({ connected: true, error: null });
    ws.onclose = () => {
      this.patch({ connected: false });
      setTimeout(() => this.connect(), 2000);
    };
    ws.onerror = () => {};
    ws.onmessage = (e) => {
      try {
        this.handleMessage(JSON.parse(e.data as string));
      } catch {
        // ignore
      }
    };
  }

  send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  answerAsk(askId: string, selections: AskSelection[]): void {
    this.send({ type: "ask_answer", askId, selections });
    this.patch({ ask: null });
  }

  dismissAsk(): void {
    this.patch({ ask: null });
  }

  sendPrompt(text: string): void {
    if (!text.trim()) return;
    this.pushItem({ kind: "user", id: this.nextId(), text });
    this.send({ type: "prompt", text });
  }

  steer(text: string): void {
    if (!text.trim()) return;
    this.pushItem({ kind: "user", id: this.nextId(), text });
    this.send({ type: "prompt", text, deliverAs: "steer" });
  }

  followUp(text: string): void {
    if (!text.trim()) return;
    this.pushItem({ kind: "user", id: this.nextId(), text });
    this.send({ type: "prompt", text, deliverAs: "followUp" });
  }

  private pushItem(item: ChatItem): void {
    this.patch({ items: [...this.state.items, item] });
  }

  private updateTool(toolCallId: string, updater: (t: ToolItem) => ToolItem): void {
    this.patch({
      items: this.state.items.map((it) =>
        it.kind === "tool" && it.toolCallId === toolCallId ? updater(it) : it,
      ),
    });
  }

  private handleMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "snapshot":
        this.applySnapshot(msg);
        break;
      case "pi_event":
        this.applyPiEvent(msg.event as string, msg.data as Record<string, unknown>);
        break;
      case "artifacts":
        this.patch({ artifacts: msg.artifacts as Artifact[] });
        break;
      case "state_patch":
        this.patch({
          contextUsage: (msg.contextUsage as ContextUsage | undefined) ?? this.state.contextUsage,
          thinkingLevel: msg.thinkingLevel ? String(msg.thinkingLevel) : this.state.thinkingLevel,
          model: (msg.model as StudioState["model"]) ?? this.state.model,
          isStreaming: Boolean(msg.isStreaming),
        });
        break;
      case "sessions":
        this.patch({ sessions: msg.sessions as SessionInfo[] });
        break;
      case "models":
        this.patch({ models: msg.models as ModelInfo[] });
        break;
      case "session_replaced":
        this.patch({ items: [], streamText: "", streamThinking: "", artifacts: [] });
        break;
      case "file_content":
        // géré par le panneau Artifacts via callback direct
        window.dispatchEvent(new CustomEvent("pi-studio:file", { detail: msg }));
        break;
      case "ask_question": {
        const data = msg.data as PendingAsk | undefined;
        if (data?.askId && Array.isArray(data.questions)) {
          this.patch({ ask: { askId: data.askId, questions: data.questions } });
        }
        break;
      }
      case "error":
        this.patch({ error: String(msg.error ?? "erreur inconnue") });
        break;
      default:
        break;
    }
  }

  private applySnapshot(msg: Record<string, unknown>): void {
    const rawMessages = (msg.messages as Array<{ id?: string; message?: unknown }>) ?? [];
    const items: ChatItem[] = [];
    const toolOutputs = new Map<string, { output?: string; isError?: boolean; name?: string }>();

    for (const entry of rawMessages) {
      const m = entry.message as Record<string, unknown>;
      if (!m) continue;
      const role = m.role as string;
      if (role === "user") {
        items.push({ kind: "user", id: this.nextId(), text: extractText(m.content), entryId: entry.id });
      } else if (role === "assistant") {
        const content = Array.isArray(m.content) ? m.content : [];
        let text = "";
        let thinking = "";
        for (const part of content as Array<Record<string, unknown>>) {
          if (part.type === "text") text += String(part.text ?? "");
          else if (part.type === "thinking") thinking += String(part.thinking ?? "");
          else if (part.type === "toolCall") {
            const callId = String(part.id ?? "");
            items.push({
              kind: "tool",
              id: this.nextId(),
              toolCallId: callId,
              name: String(part.name ?? "tool"),
              args: part.arguments,
              status: "done",
            });
          }
        }
        if (text || thinking) {
          items.push({ kind: "assistant", id: this.nextId(), text, thinking: thinking || undefined });
        }
      } else if (role === "toolResult") {
        const callId = String(m.toolCallId ?? "");
        toolOutputs.set(callId, {
          output: extractText(m.content),
          isError: Boolean(m.isError),
          name: String(m.toolName ?? ""),
        });
      }
    }

    // Corréler les sorties d'outils
    for (const item of items) {
      if (item.kind === "tool") {
        const out = toolOutputs.get(item.toolCallId);
        if (out) {
          item.output = out.output;
          item.status = out.isError ? "error" : "done";
        }
      }
    }

    const streaming = msg.streaming as { active: boolean; text: string; thinking: string } | undefined;
    this.patch({
      cwd: String(msg.cwd ?? ""),
      sessionFile: msg.sessionFile ? String(msg.sessionFile) : undefined,
      sessionName: msg.sessionName ? String(msg.sessionName) : undefined,
      commands: (msg.commands as CommandInfo[]) ?? [],
      thinkingLevel: String(msg.thinkingLevel ?? "off"),
      model: (msg.model as StudioState["model"]) ?? null,
      isStreaming: Boolean(msg.isStreaming),
      streamText: streaming?.text ?? "",
      streamThinking: streaming?.thinking ?? "",
      items,
      artifacts: (msg.artifacts as Artifact[]) ?? [],
      contextUsage: msg.contextUsage as ContextUsage | undefined,
    });
  }

  private applyPiEvent(event: string, data: Record<string, unknown>): void {
    switch (event) {
      case "agent_start":
        this.patch({ isStreaming: true, streamText: "", streamThinking: "" });
        break;
      case "agent_end":
      case "agent_settled":
        this.patch({ isStreaming: false });
        break;
      case "message_start": {
        // Nouveau message assistant : vider les buffers de stream
        this.patch({ streamText: "", streamThinking: "" });
        break;
      }
      case "message_update": {
        const ame = data.assistantMessageEvent as { type?: string; delta?: string } | undefined;
        if (ame?.type === "text_delta" && typeof ame.delta === "string") {
          this.patch({ streamText: this.state.streamText + ame.delta });
        } else if (ame?.type === "thinking_delta" && typeof ame.delta === "string") {
          this.patch({ streamThinking: this.state.streamThinking + ame.delta });
        }
        break;
      }
      case "message_end": {
        if (this.state.streamText || this.state.streamThinking) {
          this.pushItem({
            kind: "assistant",
            id: this.nextId(),
            text: this.state.streamText,
            thinking: this.state.streamThinking || undefined,
          });
        }
        this.patch({ streamText: "", streamThinking: "" });
        break;
      }
      case "tool_execution_start": {
        this.pushItem({
          kind: "tool",
          id: this.nextId(),
          toolCallId: String(data.toolCallId ?? ""),
          name: String(data.toolName ?? "tool"),
          args: data.args,
          status: "running",
        });
        break;
      }
      case "tool_execution_end": {
        const result = data.result as { content?: unknown } | undefined;
        this.updateTool(String(data.toolCallId ?? ""), (t) => ({
          ...t,
          status: data.isError ? "error" : "done",
          output: result ? extractText(result.content) : undefined,
        }));
        break;
      }
      case "model_select": {
        const model = data.model as StudioState["model"];
        this.patch({ model: model ?? this.state.model });
        break;
      }
      case "thinking_level_select": {
        const level = (data.level ?? data.thinkingLevel) as string | undefined;
        if (level) this.patch({ thinkingLevel: level });
        break;
      }
      default:
        break;
    }
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown>>)
      .filter((p) => p?.type === "text")
      .map((p) => String(p.text ?? ""))
      .join("");
  }
  return "";
}

export const store = new StudioStore();
