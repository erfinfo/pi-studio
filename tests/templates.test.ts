import { describe, expect, it } from "vitest";
import { parseCommandArgs, substituteArgs } from "../src/server/actions.js";

// Vérifie la fidélité du port de dist/core/prompt-templates.js (pi v0.81.1)

describe("parseCommandArgs", () => {
  it("sépare sur les espaces", () => {
    expect(parseCommandArgs("a b c")).toEqual(["a", "b", "c"]);
  });
  it("respecte les guillemets doubles", () => {
    expect(parseCommandArgs('a "b c" d')).toEqual(["a", "b c", "d"]);
  });
  it("respecte les guillemets simples", () => {
    expect(parseCommandArgs("a 'b c'")).toEqual(["a", "b c"]);
  });
  it("chaîne vide", () => {
    expect(parseCommandArgs("")).toEqual([]);
  });
});

describe("substituteArgs", () => {
  it("$ARGUMENTS et $@", () => {
    expect(substituteArgs("de $ARGUMENTS fin", ["a", "b"])).toBe("de a b fin");
    expect(substituteArgs("de $@ fin", ["a", "b"])).toBe("de a b fin");
  });
  it("$1 $2 positionnels", () => {
    expect(substituteArgs("$1 puis $2", ["a", "b"])).toBe("a puis b");
  });
  it("$N absent → chaîne vide", () => {
    expect(substituteArgs("[$3]", ["a"])).toBe("[]");
  });
  it("${1:-défaut} avec valeur", () => {
    expect(substituteArgs("${1:-def}", ["x"])).toBe("x");
  });
  it("${1:-défaut} sans valeur", () => {
    expect(substituteArgs("${1:-def}", [])).toBe("def");
  });
  it("${ARGUMENTS:-défaut}", () => {
    expect(substituteArgs("${ARGUMENTS:-def}", [])).toBe("def");
    expect(substituteArgs("${ARGUMENTS:-def}", ["a", "b"])).toBe("a b");
  });
  it("${@:2} slice depuis 2", () => {
    expect(substituteArgs("${@:2}", ["a", "b", "c"])).toBe("b c");
  });
  it("${@:2:1} slice avec longueur", () => {
    expect(substituteArgs("${@:2:1}", ["a", "b", "c"])).toBe("b");
  });
  it("pas de substitution récursive", () => {
    expect(substituteArgs("$1", ["$2"])).toBe("$2");
  });
});
