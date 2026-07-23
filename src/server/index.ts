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
  return url.searchParams.get("token") ?? "";
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
    if (serveStatic(res, "index.html")) return;
  } else if (serveStatic(res, decodeURIComponent(url.pathname))) {
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found");
}

function snapshot(): Record<string, unknown> {
  const pi = hub.pi as { getCommands?: () => unknown[]; getThinkingLevel?: () => string } | null;
  return {
    type: "snapshot",
    cwd: hub.cwd,
    commands: pi?.getCommands?.() ?? [],
    thinkingLevel: pi?.getThinkingLevel?.() ?? "off",
  };
}

function handleWsMessage(raw: string): Record<string, unknown> | null {
  let msg: { type?: string };
  try {
    msg = JSON.parse(raw);
  } catch {
    return { type: "error", error: "json invalide" };
  }
  switch (msg.type) {
    case "ping":
      return { type: "pong" };
    default:
      return { type: "error", error: `type inconnu: ${String(msg.type)}` };
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
    ws.send(JSON.stringify(snapshot()));
    ws.on("message", (data) => {
      const reply = handleWsMessage(data.toString());
      if (reply) ws.send(JSON.stringify(reply));
    });
  });

  // Broadcast des événements pi vers tous les clients connectés.
  const listener = (event: unknown) => {
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
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
