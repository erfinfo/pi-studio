/**
 * Actions du bridge : opérations demandées par les clients web et exécutées
 * contre l'API pi via le hub (pi + ctx de commande stashé).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { hub } from "../bridge.js";

// ---------------------------------------------------------------------------
// Types lâches sur l'API pi (les types exacts vivent dans pi-coding-agent;
// on ne dépend que des formes documentées).
// ---------------------------------------------------------------------------

interface PiApi {
  sendUserMessage(text: string, options?: { deliverAs?: "steer" | "followUp" }): void;
  setModel(model: unknown): Promise<boolean>;
  getThinkingLevel(): string;
  setThinkingLevel(level: string): void;
  getCommands(): Array<{ name: string; description?: string; source: string }>;
}

interface ModelRegistry {
  getAvailable(): Array<{ provider: string; id: string; name?: string }>;
  find(provider: string, modelId: string): unknown | undefined;
}

interface SessionManagerLike {
  getBranch(): Array<Record<string, unknown>>;
  getSessionFile(): string | undefined;
  getSessionName(): string | undefined;
}

interface CommandCtx {
  isIdle(): boolean;
  abort(): void;
  cwd: string;
  modelRegistry: ModelRegistry;
  sessionManager: SessionManagerLike;
  getContextUsage(): { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
  newSession(): Promise<{ cancelled: boolean }>;
  switchSession(path: string): Promise<unknown>;
  fork(entryId: string): Promise<{ cancelled: boolean }>;
}

const SESSION_OP_TIMEOUT_MS = 60_000;

function pi(): PiApi {
  if (!hub.pi) throw new Error("extension pi non initialisée");
  return hub.pi as PiApi;
}

function ctx(): CommandCtx {
  if (!hub.ctx) throw new Error("contexte de commande indisponible — lancez /webui dans le TUI");
  return hub.ctx as CommandCtx;
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timeout — confirmation en attente dans le TUI ?")), SESSION_OP_TIMEOUT_MS),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Snapshot / état
// ---------------------------------------------------------------------------

export function getSnapshot(): Record<string, unknown> {
  const c = hub.ctx as CommandCtx | null;
  let messages: unknown[] = [];
  let sessionFile: string | undefined;
  let sessionName: string | undefined;
  if (c) {
    try {
      messages = c.sessionManager
        .getBranch()
        .filter((e) => e.type === "message")
        .map((e) => ({ id: e.id, message: e.message }));
    } catch {
      messages = [];
    }
    try {
      sessionFile = c.sessionManager.getSessionFile();
      sessionName = c.sessionManager.getSessionName();
    } catch {
      // ignore
    }
  }
  let model: unknown = null;
  try {
    const m = (hub.ctx as CommandCtx | null) && (hub.ctx as { model?: unknown }).model;
    model = m ?? null;
  } catch {
    // ignore
  }
  return {
    type: "snapshot",
    cwd: hub.cwd,
    sessionFile,
    sessionName,
    commands: safe(() => pi().getCommands(), []),
    thinkingLevel: safe(() => pi().getThinkingLevel(), "off"),
    model,
    isStreaming: hub.streaming.active,
    streaming: hub.streaming,
    messages,
    artifacts: [...hub.artifacts.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    contextUsage: safe(() => c?.getContextUsage(), undefined),
  };
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export function sendPrompt(text: string, deliverAs?: "steer" | "followUp"): void {
  const streaming = hub.streaming.active || !(hub.ctx as CommandCtx | null)?.isIdle?.();
  const mode = deliverAs ?? (streaming ? "followUp" : undefined);
  pi().sendUserMessage(text, mode ? { deliverAs: mode } : undefined);
}

export function abort(): void {
  ctx().abort();
}

// ---------------------------------------------------------------------------
// Modèle / thinking
// ---------------------------------------------------------------------------

export function listModels(): Array<{ provider: string; id: string; name?: string }> {
  return safe(() => ctx().modelRegistry.getAvailable(), []).map((m) => ({
    provider: m.provider,
    id: m.id,
    name: m.name,
  }));
}

export async function setModel(provider: string, modelId: string): Promise<{ ok: boolean; error?: string }> {
  const model = ctx().modelRegistry.find(provider, modelId);
  if (!model) return { ok: false, error: `modèle introuvable: ${provider}/${modelId}` };
  const ok = await pi().setModel(model);
  return ok ? { ok: true } : { ok: false, error: "aucune clé API pour ce modèle" };
}

export function setThinking(level: string): void {
  pi().setThinkingLevel(level);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

interface SessionListItem {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  firstMessage?: string;
  modified?: string;
}

export async function listSessions(): Promise<SessionListItem[]> {
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const list = await SessionManager.list(hub.cwd);
  return (list as unknown as Array<Record<string, unknown>>).map((s) => ({
    path: String(s.path ?? ""),
    id: String(s.id ?? ""),
    cwd: String(s.cwd ?? ""),
    name: s.name ? String(s.name) : undefined,
    firstMessage: s.firstMessage ? String(s.firstMessage) : undefined,
    modified: s.modified ? String(s.modified) : undefined,
  }));
}

export async function newSession(): Promise<void> {
  const c = ctx();
  if (!c.isIdle()) throw new Error("agent occupé");
  await withTimeout(c.newSession());
}

export async function resumeSession(path: string): Promise<void> {
  const c = ctx();
  if (!c.isIdle()) throw new Error("agent occupé");
  if (!existsSync(path)) throw new Error(`session introuvable: ${path}`);
  await withTimeout(c.switchSession(path));
}

export async function forkSession(entryId: string): Promise<void> {
  const c = ctx();
  if (!c.isIdle()) throw new Error("agent occupé");
  await withTimeout(c.fork(entryId));
}

// ---------------------------------------------------------------------------
// Expansion des slash commands (réplique du pipeline pi, confirmé dans le
// source dist/core/agent-session.js : _expandSkillCommand + expandPromptTemplate)
// ---------------------------------------------------------------------------

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function findSkillDirs(): string[] {
  const dirs: string[] = [];
  const home = homedir();
  dirs.push(join(home, ".pi", "agent", "skills"));
  dirs.push(join(home, ".agents", "skills"));
  // Projet : .pi/skills et .agents/skills de cwd vers la racine git
  let dir = resolve(hub.cwd);
  const seen = new Set<string>();
  for (;;) {
    for (const candidate of [join(dir, ".pi", "skills"), join(dir, ".agents", "skills")]) {
      if (!seen.has(candidate)) {
        seen.add(candidate);
        dirs.push(candidate);
      }
    }
    if (existsSync(join(dir, ".git"))) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

function findSkill(name: string): { filePath: string; baseDir: string } | null {
  for (const root of findSkillDirs()) {
    const filePath = join(root, name, "SKILL.md");
    if (existsSync(filePath)) return { filePath, baseDir: join(root, name) };
  }
  return null;
}

function expandSkillCommand(text: string): string {
  if (!text.startsWith("/skill:")) return text;
  const spaceIndex = text.indexOf(" ");
  const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
  const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();
  const skill = findSkill(skillName);
  if (!skill) return text;
  const content = readFileSync(skill.filePath, "utf-8");
  const body = stripFrontmatter(content).trim();
  const block = `<skill name="${skillName}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
  return args ? `${block}\n\n${args}` : block;
}

function promptDirs(): string[] {
  const home = homedir();
  return [join(home, ".pi", "agent", "prompts"), join(hub.cwd, ".pi", "prompts")];
}

// Port fidèle de dist/core/prompt-templates.js (parseCommandArgs +
// substituteArgs) — non exportés publiquement par pi, d'où la réplication.
export function parseCommandArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];
    if (inQuote) {
      if (char === inQuote) inQuote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) args.push(current);
  return args;
}

export function substituteArgs(content: string, args: string[]): string {
  const allArgs = args.join(" ");
  return content.replace(
    /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
    (_match, defaultTarget, defaultValue, sliceStart, sliceLength, simple) => {
      if (defaultTarget) {
        const value =
          defaultTarget === "@" || defaultTarget === "ARGUMENTS" ? allArgs : args[Number.parseInt(defaultTarget, 10) - 1];
        return value ? value : defaultValue;
      }
      if (sliceStart) {
        let start = Number.parseInt(sliceStart, 10) - 1;
        if (start < 0) start = 0;
        if (sliceLength) {
          const length = Number.parseInt(sliceLength, 10);
          return args.slice(start, start + length).join(" ");
        }
        return args.slice(start).join(" ");
      }
      if (simple === "ARGUMENTS" || simple === "@") return allArgs;
      const index = Number.parseInt(simple, 10) - 1;
      return args[index] ?? "";
    },
  );
}

function expandPromptTemplate(text: string): string {
  if (!text.startsWith("/")) return text;
  const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) return text;
  const name = match[1];
  const argsString = match[2] ?? "";
  for (const dir of promptDirs()) {
    const file = join(dir, `${name}.md`);
    if (!existsSync(file)) continue;
    const body = readFileSync(file, "utf-8");
    return substituteArgs(body, parseCommandArgs(argsString));
  }
  return text;
}

/**
 * Retourne le texte expansé si c'est une commande skill/template connue,
 * sinon le texte original. Les commandes d'extensions tierces ne sont pas
 * expansables ici (limitation v1 documentée).
 */
export function expandCommand(text: string): { text: string; kind: "skill" | "template" | "extension" | "plain" } {
  if (!text.startsWith("/")) return { text, kind: "plain" };
  const name = (text.split(/\s/)[0] ?? "").slice(1);
  const commands = safe(() => pi().getCommands(), []);
  const found = commands.find((c) => c.name === name);
  if (found?.source === "extension") return { text, kind: "extension" };
  if (name.startsWith("skill:")) {
    const expanded = expandSkillCommand(text);
    return expanded !== text ? { text: expanded, kind: "skill" } : { text, kind: "plain" };
  }
  const expanded = expandPromptTemplate(text);
  return expanded !== text ? { text: expanded, kind: "template" } : { text, kind: "plain" };
}

// ---------------------------------------------------------------------------
// Fichiers (artifacts)
// ---------------------------------------------------------------------------

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"]);

export function readArtifactFile(path: string): { content?: string; base64?: string; mime?: string; error?: string } {
  const abs = resolve(hub.cwd, path);
  if (!abs.startsWith(resolve(hub.cwd))) return { error: "chemin hors du répertoire de travail" };
  if (!existsSync(abs) || !statSync(abs).isFile()) return { error: "fichier introuvable" };
  const ext = `.${basename(abs).split(".").pop()?.toLowerCase() ?? ""}`;
  if (IMAGE_EXTS.has(ext)) {
    const mime =
      ext === ".svg" ? "image/svg+xml" : ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return { base64: readFileSync(abs).toString("base64"), mime };
  }
  const content = readFileSync(abs, "utf-8");
  return { content: content.length > 500_000 ? content.slice(0, 500_000) : content };
}
