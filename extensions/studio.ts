/**
 * pi-studio — extension pi qui expose l'agent via une interface web locale.
 *
 * Commandes :
 *   /webui [--port N] [--lan] [--no-open]   Démarre le serveur web et ouvre le navigateur
 *   /studio                                  Alias de /webui
 *
 * Le serveur est un singleton : une seule instance par processus pi, il survit
 * aux /new, /resume et /fork (les événements sont ré-abonnés à chaque session).
 */

import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { emitToWeb, hub, trackEvent } from "../src/bridge.js";
import { ensureStudioServer } from "../src/server/index.js";

const DEFAULT_PORT = 4173;

/** Événements pi forwardés tels quels aux clients web. */
const FORWARDED_EVENTS = [
  "agent_start",
  "agent_end",
  "agent_settled",
  "message_start",
  "message_update",
  "message_end",
  "turn_start",
  "turn_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "model_select",
  "thinking_level_select",
  "queue_update",
  "session_before_compact",
  "session_compact",
  "session_info_changed",
] as const;

interface WebuiArgs {
  port: number;
  lan: boolean;
  open: boolean;
}

function parseArgs(args: string): WebuiArgs {
  const parts = args.split(/\s+/).filter(Boolean);
  let port = DEFAULT_PORT;
  let lan = false;
  let open = true;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "--port" && parts[i + 1]) {
      port = Number.parseInt(parts[++i], 10) || DEFAULT_PORT;
    } else if (parts[i] === "--lan") {
      lan = true;
    } else if (parts[i] === "--no-open") {
      open = false;
    }
  }
  return { port, lan, open };
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Silencieux : l'URL est affichée dans la notification.
  }
}

async function launch(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const opts = parseArgs(args);
  // Stash du contexte de commande : les opérations de session (new, resume,
  // fork) ne sont disponibles que sur ce type de contexte. Les getters sont
  // résolus à l'appel, le ctx reste valide après le retour du handler.
  hub.ctx = ctx;
  hub.cwd = ctx.cwd;

  try {
    const { handle, created } = await ensureStudioServer({ port: opts.port, lan: opts.lan });
    if (!created) {
      ctx.ui.notify(`pi-studio déjà actif : ${handle.url}`, "info");
    } else {
      const mode = opts.lan ? "LAN (partagez l'URL complète, elle contient le token)" : "localhost";
      ctx.ui.notify(`pi-studio actif (${mode}) : ${handle.url}`, "info");
    }
    if (opts.open) openBrowser(handle.url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.ui.notify(`pi-studio : ${message}`, "error");
  }
}

export default function piStudio(pi: ExtensionAPI): void {
  hub.pi = pi;

  // Bridge ask : pi-ask-tool publie ses questions sur le bus partagé,
  // on les forward aux clients web (réponse via message WS ask_answer).
  pi.events.on("pi-studio:ask-question", (data) => {
    emitToWeb({ type: "ask_question", data });
  });

  for (const eventName of FORWARDED_EVENTS) {
    // pi.on est typé par événement; la boucle homogénéise via un cast.
    (pi.on as (name: string, handler: (event: unknown) => Promise<void>) => void)(eventName, async (event: unknown) => {
      trackEvent(eventName, event);
      emitToWeb({ type: "pi_event", event: eventName, data: event });
    });
  }

  pi.registerCommand("webui", {
    description: "Ouvre pi-studio (interface web) — options: --port N, --lan, --no-open",
    handler: launch,
  });
  pi.registerCommand("studio", {
    description: "Alias de /webui",
    handler: launch,
  });
}
