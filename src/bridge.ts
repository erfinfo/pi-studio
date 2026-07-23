/**
 * Hub partagé entre l'extension pi (extensions/studio.ts) et le serveur web.
 * L'extension y dépose ses références (pi, ctx de commande) et y publie les
 * événements; le serveur les consomme. Module-level par design: le serveur est
 * un singleton qui survit aux remplacements de session.
 */

export interface StreamingState {
  active: boolean;
  text: string;
  thinking: string;
}

export interface ArtifactEntry {
  path: string;
  tool: string;
  timestamp: string;
  isError: boolean;
  patch?: string;
  diff?: string;
}

export interface HubState {
  /** ExtensionAPI de la session active (mis à jour à chaque factory run). */
  pi: unknown | null;
  /** Contexte de commande stashé (méthodes de contrôle de session). */
  ctx: unknown | null;
  /** Répertoire de travail de la session au démarrage du serveur. */
  cwd: string;
  /** Listeners d'événements pi (alimentés par l'extension). */
  listeners: Set<(event: unknown) => void>;
  /** État du stream en cours (pour resync des clients). */
  streaming: StreamingState;
  /** Fichiers touchés par les outils (pour le panneau Artifacts). */
  artifacts: Map<string, ArtifactEntry>;
  /** Args des outils en cours, indexés par toolCallId (pour corrélation). */
  pendingToolArgs: Map<string, Record<string, unknown>>;
}

export const hub: HubState = {
  pi: null,
  ctx: null,
  cwd: process.cwd(),
  listeners: new Set(),
  streaming: { active: false, text: "", thinking: "" },
  artifacts: new Map(),
  pendingToolArgs: new Map(),
};

export function emitToWeb(event: unknown): void {
  for (const listener of hub.listeners) {
    try {
      listener(event);
    } catch {
      // Un listener en erreur ne doit jamais briser l'agent.
    }
  }
}

const ARTIFACT_TOOLS = new Set(["write", "edit", "read"]);

function trackArtifact(tool: string, args: Record<string, unknown> | undefined, result: unknown, isError: boolean): void {
  const path = typeof args?.path === "string" ? args.path : undefined;
  if (!path) return;
  const details = (result as { details?: { patch?: string; diff?: string } } | null)?.details;
  hub.artifacts.set(path, {
    path,
    tool,
    timestamp: new Date().toISOString(),
    isError,
    patch: details?.patch,
    diff: typeof details?.diff === "string" ? details.diff : undefined,
  });
}

/**
 * Met à jour l'état interne du hub à partir d'un événement pi forwardé.
 * Appelé par l'extension avant le broadcast.
 */
export function trackEvent(eventName: string, data: unknown): void {
  const ev = data as Record<string, unknown> | undefined;
  switch (eventName) {
    case "agent_start":
      hub.streaming = { active: true, text: "", thinking: "" };
      hub.pendingToolArgs.clear();
      break;
    case "agent_end":
    case "agent_settled":
      hub.streaming.active = false;
      break;
    case "message_update": {
      const ame = ev?.assistantMessageEvent as { type?: string; delta?: string } | undefined;
      if (ame?.type === "text_delta" && typeof ame.delta === "string") {
        hub.streaming.text += ame.delta;
      } else if (ame?.type === "thinking_delta" && typeof ame.delta === "string") {
        hub.streaming.thinking += ame.delta;
      }
      break;
    }
    case "tool_execution_start": {
      const id = ev?.toolCallId as string | undefined;
      const args = (ev?.args ?? ev?.input) as Record<string, unknown> | undefined;
      if (id && args) hub.pendingToolArgs.set(id, args);
      break;
    }
    case "tool_execution_end": {
      const id = ev?.toolCallId as string | undefined;
      const tool = ev?.toolName as string | undefined;
      if (tool && ARTIFACT_TOOLS.has(tool)) {
        trackArtifact(tool, id ? hub.pendingToolArgs.get(id) : undefined, ev?.result, Boolean(ev?.isError));
      }
      if (id) hub.pendingToolArgs.delete(id);
      break;
    }
  }
}
