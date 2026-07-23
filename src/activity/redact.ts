export const REDACTED = "[REDACTED]";
const TRUNCATED = "[TRUNCATED]";
const MAX_STRING_BYTES = 64 * 1024;
const MAX_DEPTH = 12;

export interface SanitizeOptions {
  maxStringBytes?: number;
  maxDepth?: number;
}

export interface PayloadOptions extends SanitizeOptions {
  maxBytes?: number;
}

const SENSITIVE_KEYS = [
  "token",
  "password",
  "passwd",
  "secret",
  "apikey",
  "authorization",
  "cookie",
  "credential",
  "privatekey",
];

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_KEYS.some((candidate) => normalized.includes(candidate));
}

function redactString(input: string): string {
  return input
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi, REDACTED)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(
      /\b(?:API[_-]?KEY|ACCESS[_-]?TOKEN|AUTHORIZATION|PASSWORD|PASSWD|SECRET|COOKIE)\s*[:=]\s*([^\s,;&#]+)/gi,
      (match) => `${match.slice(0, Math.max(match.indexOf(":"), match.indexOf("=")) + 1)}${REDACTED}`,
    )
    .replace(/([?&](?:access_token|auth_token|api_key|apikey|password|secret)=)[^&#\s]+/gi, `$1${REDACTED}`);
}

function truncateUtf8(input: string, maxBytes: number): string {
  if (Buffer.byteLength(input, "utf8") <= maxBytes) return input;
  const markerBytes = Buffer.byteLength(TRUNCATED, "utf8");
  if (maxBytes <= markerBytes) return TRUNCATED.slice(0, maxBytes);
  const prefix = Buffer.from(input, "utf8").subarray(0, maxBytes - markerBytes).toString("utf8").replace(/\uFFFD$/u, "");
  return `${prefix}${TRUNCATED}`;
}

export function sanitizeForActivity(value: unknown, options: SanitizeOptions = {}): unknown {
  const maxStringBytes = options.maxStringBytes ?? MAX_STRING_BYTES;
  const maxDepth = options.maxDepth ?? MAX_DEPTH;
  const seen = new WeakSet<object>();

  function visit(current: unknown, depth: number, key?: string): unknown {
    if (key && isSensitiveKey(key)) return REDACTED;
    if (typeof current === "string") return truncateUtf8(redactString(current), maxStringBytes);
    if (current === null || typeof current === "number" || typeof current === "boolean") return current;
    if (typeof current === "bigint") return current.toString();
    if (typeof current === "undefined") return "[Undefined]";
    if (typeof current === "function") return "[Function]";
    if (typeof current === "symbol") return "[Symbol]";
    if (depth >= maxDepth) return "[Max depth]";
    if (current instanceof Date) return current.toISOString();
    if (current instanceof Error) {
      return {
        name: current.name,
        message: truncateUtf8(redactString(current.message), maxStringBytes),
        stack: current.stack ? truncateUtf8(redactString(current.stack), maxStringBytes) : undefined,
      };
    }
    if (typeof current !== "object") return String(current);
    if (seen.has(current)) return "[Circular]";
    seen.add(current);

    if (Array.isArray(current)) return current.map((item) => visit(item, depth + 1));

    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(current)) {
      if (typeof childValue === "undefined") continue;
      output[childKey] = visit(childValue, depth + 1, childKey);
    }
    return output;
  }

  return visit(value, 0);
}

export function sanitizeActivityPayload(value: unknown, options: PayloadOptions = {}): unknown {
  const maxBytes = options.maxBytes ?? MAX_STRING_BYTES;
  const sanitized = sanitizeForActivity(value, options);
  const json = JSON.stringify(sanitized);
  if (Buffer.byteLength(json, "utf8") <= maxBytes) return sanitized;

  let budget = maxBytes;
  let preview = truncateUtf8(json, budget);
  while (Buffer.byteLength(JSON.stringify(preview), "utf8") > maxBytes && budget > Buffer.byteLength(TRUNCATED, "utf8")) {
    const excess = Buffer.byteLength(JSON.stringify(preview), "utf8") - maxBytes;
    budget = Math.max(Buffer.byteLength(TRUNCATED, "utf8"), budget - Math.max(1, excess));
    preview = truncateUtf8(json, budget);
  }
  return preview;
}

export function safeActivityJson(value: unknown, options?: SanitizeOptions): string {
  return JSON.stringify(sanitizeForActivity(value, options));
}
