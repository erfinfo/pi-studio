import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { _internals } from "../src/server/index.js";

describe("originAllowed", () => {
  const { originAllowed } = _internals;

  it("accepte localhost en mode local", () => {
    const req = { headers: { origin: "http://127.0.0.1:4173" } } as never;
    expect(originAllowed(req, 4173, false)).toBe(true);
  });
  it("refuse un autre port", () => {
    const req = { headers: { origin: "http://127.0.0.1:9999" } } as never;
    expect(originAllowed(req, 4173, false)).toBe(false);
  });
  it("refuse une origine externe en mode local", () => {
    const req = { headers: { origin: "https://evil.example.com" } } as never;
    expect(originAllowed(req, 4173, false)).toBe(false);
  });
  it("accepte une origine LAN en mode --lan", () => {
    const req = { headers: { origin: "http://192.168.100.10:4173" } } as never;
    expect(originAllowed(req, 4173, true)).toBe(true);
  });
  it("accepte les clients sans Origin (curl), le token reste requis", () => {
    const req = { headers: {} } as never;
    expect(originAllowed(req, 4173, false)).toBe(true);
  });
});

describe("serveStatic anti-traversal", () => {
  const { serveStatic } = _internals;
  const tmp = mkdtempSync(join(tmpdir(), "pi-studio-test-"));

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("refuse la traversée de répertoire", () => {
    const res = {
      code: 0,
      writeHead(code: number) {
        this.code = code;
        return this;
      },
      end() {},
    };
    const served = serveStatic(res as never, "../../../etc/passwd");
    expect(served).toBe(false);
  });
});
