/**
 * Serveur HTTP + WebSocket de pi-studio.
 *
 * Sécurité :
 * - bind 127.0.0.1 par défaut (flag --lan pour 0.0.0.0)
 * - token aléatoire obligatoire (query ?token=) sur HTTP et WS
 * - vérification du header Origin sur les upgrade WebSocket
 *
 * Le serveur est un singleton module-level : il survit aux remplacements de
 * session pi (/new, /resume, /fork) et se ré-abonne via le hub.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { emitToWeb, hub } from "../bridge.js";
import * as actions from "./actions.js";

export interface StudioServerOptions {
  port: number;
  lan: boolean;
}

export interface StudioServerHandle {
  url: string;
  port: number;
  token: string;
  close: () => void;
}

const PACKAGE_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const DIST_DIR = join(PACKAGE_ROOT, "web", "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

let current: { handle: StudioServerHandle; server: Server; wss: WebSocketServer } | null = null;

function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

function tokenFrom(req: IncomingMessage): string {
  const url = new URL(req.url ?? "/", "http://localhost");
  const queryToken = url.searchParams.get("token");
  if (queryToken) return queryToken;
  // Fallback cookie : les assets (JS/CSS) sont demandés sans query string.
  const cookie = req.headers.cookie ?? "";
  const match = cookie.match(/(?:^|;\s*)pi_studio_token=([^;]+)/);
  return match?.[1] ?? "";
}

function originAllowed(req: IncomingMessage, port: number, lan: boolean): boolean {
  const origin = req.headers.origin;
  // Clients non-browser (curl, scripts) n'envoient pas d'Origin : on les
  // accepte, le token reste obligatoire.
  if (!origin) return true;
  try {
    const o = new URL(origin);
    const hostOk = lan || o.hostname === "127.0.0.1" || o.hostname === "localhost" || o.hostname === "[::1]";
    return hostOk && o.port === String(port);
  } catch {
    return false;
  }
}

function serveStatic(res: ServerResponse, path: string): boolean {
  const file = normalize(join(DIST_DIR, path));
  if (!file.startsWith(DIST_DIR + sep) && file !== DIST_DIR) return false;
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
  return true;
}

function handleHttp(req: IncomingMessage, res: ServerResponse, token: string): void {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, name: "pi-studio" }));
    return;
  }

  // Tout le reste exige le token (page, assets, API).
  if (tokenFrom(req) !== token) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("pi-studio: token manquant ou invalide");
    return;
  }

  if (url.pathname === "/") {
    // Poser le token en cookie pour les requêtes d'assets qui suivent.
    res.setHeader("set-cookie", `pi_studio_token=${token}; Path=/; HttpOnly; SameSite=Strict`);
    if (serveStatic(res, "index.html")) return;
  } else if (serveStatic(res, decodeURIComponent(url.pathname))) {
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found");
}

// ---------------------------------------------------------------------------
// Routeur WS
// ---------------------------------------------------------------------------

type WsMessage = Record<string, unknown> & { type: string };

async function routeMessage(msg: WsMessage): Promise<Record<string, unknown> | null> {
  switch (msg.type) {
    case "ping":
      return { type: "pong" };
    case "get_snapshot":
      return actions.getSnapshot();
    case "prompt": {
      const text = String(msg.text ?? "");
      if (!text.trim()) return { type: "error", error: "prompt vide" };
      // Les commandes d'extensions tierces ne sont pas invoquables depuis le
      // web (limitation v1) — on le signale plutôt que d'envoyer le texte brut.
      const expanded = actions.expandCommand(text);
      if (expanded.kind === "extension") {
        return {
          type: "error",
          error: "commande d'extension — à lancer dans le TUI (limitation v1)",
        };
      }
      actions.sendPrompt(
        expanded.text,
        msg.deliverAs === "steer" || msg.deliverAs === "followUp" ? msg.deliverAs : undefined,
      );
      return { type: "accepted", what: "prompt" };
    }
    case "abort":
      actions.abort();
      return { type: "accepted", what: "abort" };
    case "set_thinking":
      actions.setThinking(String(msg.level ?? "off"));
      return { type: "accepted", what: "set_thinking" };
    case "list_models":
      return { type: "models", models: actions.listModels() };
    case "set_model": {
      const result = await actions.setModel(String(msg.provider ?? ""), String(msg.modelId ?? ""));
      return result.ok ? { type: "accepted", what: "set_model" } : { type: "error", error: result.error };
    }
    case "list_sessions":
      return { type: "sessions", sessions: await actions.listSessions() };
    case "new_session":
      await actions.newSession();
      return { type: "session_replaced", reason: "new" };
    case "resume_session":
      await actions.resumeSession(String(msg.path ?? ""));
      return { type: "session_replaced", reason: "resume" };
    case "fork":
      await actions.forkSession(String(msg.entryId ?? ""));
      return { type: "session_replaced", reason: "fork" };
    case "read_file":
      return { type: "file_content", path: String(msg.path ?? ""), ...actions.readArtifactFile(String(msg.path ?? "")) };
    default:
      return { type: "error", error: `type inconnu: ${msg.type}` };
  }
}

async function dispatch(ws: WebSocket, raw: string): Promise<void> {
  let msg: WsMessage;
  try {
    msg = JSON.parse(raw) as WsMessage;
  } catch {
    ws.send(JSON.stringify({ type: "error", error: "json invalide" }));
    return;
  }
  try {
    const reply = await routeMessage(msg);
    if (reply && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(reply));
      // Après un remplacement de session, pousser un snapshot frais.
      if (reply.type === "session_replaced") {
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(actions.getSnapshot()));
        }, 500);
      }
    }
  } catch (err) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "error", error: err instanceof Error ? err.message : String(err) }));
    }
  }
}

export async function ensureStudioServer(
  opts: StudioServerOptions,
): Promise<{ handle: StudioServerHandle; created: boolean }> {
  if (current) {
    if (current.handle.port === opts.port) {
      return { handle: current.handle, created: false };
    }
    const err = new Error(
      `pi-studio déjà actif sur le port ${current.handle.port} (${current.handle.url})`,
    ) as NodeJS.ErrnoException;
    err.code = "EADDRINUSE";
    throw err;
  }

  const token = generateToken();
  const bindHost = opts.lan ? "0.0.0.0" : "127.0.0.1";

  const server = createServer((req, res) => handleHttp(req, res, token));
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    if (tokenFrom(req) !== token || !originAllowed(req, opts.port, opts.lan)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket) => {
    ws.send(JSON.stringify(actions.getSnapshot()));
    ws.on("message", (data) => void dispatch(ws, data.toString()));
  });

  // Broadcast des événements pi vers tous les clients connectés.
  const listener = (event: unknown) => {
    const ev = event as { type?: string; event?: string };
    const payloads = [JSON.stringify(event)];
    if (ev.type === "pi_event" && ev.event === "tool_execution_end") {
      payloads.push(
        JSON.stringify({
          type: "artifacts",
          artifacts: [...hub.artifacts.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
        }),
      );
    }
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        for (const payload of payloads) client.send(payload);
      }
    }
  };
  hub.listeners.add(listener);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(opts.port, bindHost, () => {
      server.removeListener("error", rejectPromise);
      resolvePromise();
    });
  });

  const displayHost = opts.lan ? "0.0.0.0" : "127.0.0.1";
  const handle: StudioServerHandle = {
    port: opts.port,
    token,
    url: `http://${displayHost}:${opts.port}/?token=${token}`,
    close: () => {
      hub.listeners.delete(listener);
      wss.close();
      server.close();
      if (current?.handle === handle) current = null;
    },
  };
  current = { handle, server, wss };
  return { handle, created: true };
}

/** Pour les tests uniquement. */
export function _resetForTests(): void {
  current?.handle.close();
  current = null;
}

export const _internals = { DIST_DIR, originAllowed, serveStatic };
