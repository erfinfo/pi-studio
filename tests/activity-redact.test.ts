import { describe, expect, it } from "vitest";
import { REDACTED, sanitizeActivityPayload, sanitizeForActivity, safeActivityJson } from "../src/activity/redact.js";

describe("sanitizeForActivity", () => {
  it("redige récursivement les clés sensibles sans tenir compte de la casse", () => {
    const result = sanitizeForActivity({
      api_key: "abc",
      nested: { Password: "secret", safe: "visible" },
      list: [{ authorization: "Basic xyz" }],
    });

    expect(result).toEqual({
      api_key: REDACTED,
      nested: { Password: REDACTED, safe: "visible" },
      list: [{ authorization: REDACTED }],
    });
  });

  it("redige les Bearer tokens, blocs PEM, variables et paramètres URL", () => {
    const value = [
      "Authorization: Bearer abc.def.ghi",
      "API_KEY=super-secret",
      "https://example.test/path?access_token=abcdef&ok=1",
      "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
    ].join("\n");

    const result = String(sanitizeForActivity(value));

    expect(result).not.toContain("abc.def.ghi");
    expect(result).not.toContain("super-secret");
    expect(result).not.toContain("access_token=abcdef");
    expect(result).not.toContain("abc123");
    expect(result).toContain(REDACTED);
    expect(result).toContain("ok=1");
  });

  it("tolère les cycles, bigint, Error et valeurs non sérialisables", () => {
    const circular: Record<string, unknown> = { count: 12n, error: new Error("boom") };
    circular.self = circular;
    circular.fn = () => undefined;

    const json = safeActivityJson(circular);

    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).toContain("12");
    expect(json).toContain("boom");
    expect(json).toContain("[Circular]");
    expect(json).toContain("[Function]");
  });

  it("redige avant de tronquer et marque explicitement la troncature", () => {
    const result = String(
      sanitizeForActivity(`prefix API_KEY=do-not-leak ${"x".repeat(200)}`, { maxStringBytes: 64 }),
    );

    expect(result).not.toContain("do-not-leak");
    expect(result).toContain(REDACTED);
    expect(result).toContain("[TRUNCATED]");
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(64);
  });

  it("limite aussi la taille totale d’un payload structuré", () => {
    const result = sanitizeActivityPayload({ rows: Array.from({ length: 50 }, (_, index) => ({ index, value: "x".repeat(20) })) }, { maxBytes: 128 });
    expect(typeof result).toBe("string");
    expect(String(result)).toContain("[TRUNCATED]");
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(130);
  });

  it("omet les propriétés undefined au lieu de les transformer en texte", () => {
    expect(sanitizeForActivity({ optional: undefined, present: true })).toEqual({ present: true });
  });

  it("limite la profondeur des objets", () => {
    const result = sanitizeForActivity({ a: { b: { c: { d: true } } } }, { maxDepth: 2 });
    expect(JSON.stringify(result)).toContain("[Max depth]");
  });
});
