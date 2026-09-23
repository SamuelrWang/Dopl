import { describe, expect, it } from "vitest";

import { between, codeOnly, cssCode, readCode, tsCode } from "./source-text";

describe("tsCode", () => {
  it("blanks line, block and JSX comments but keeps offsets and line numbers", () => {
    const src = [
      "// header",
      "const a = 1; /* inline */ const b = 2;",
      "/** doc",
      " *  more */",
      "const el = <p>{/* jsx */}x</p>;",
    ].join("\n");
    const out = tsCode(src, "x.tsx");
    expect(out).toHaveLength(src.length);
    expect(out.split("\n")).toHaveLength(5);
    expect(out).not.toMatch(/header|inline|doc|more|jsx/);
    expect(out).toContain("const b = 2;");
    expect(out).toContain("<p>{");
  });

  it("leaves comment markers inside strings, templates, regexes and JSX text alone", () => {
    const src = [
      'const url = "https://x.test/*";',
      "const t = `a // b ${1 /* gone */} c /* d */`;",
      "const re = /\\/\\//g;",
      "const el = <a href=\"//cdn\">see http://x.test</a>;",
    ].join("\n");
    const out = tsCode(src, "x.tsx");
    expect(out).toContain('"https://x.test/*"');
    expect(out).toMatch(/`a \/\/ b \$\{1 +\} c \/\* d \*\/`/);
    expect(out).toContain("/\\/\\//g");
    expect(out).toContain("see http://x.test");
  });

  it("throws on source that does not parse", () => {
    expect(() => tsCode("const = ;", "bad.ts")).toThrow(/does not parse/);
  });
});

describe("cssCode", () => {
  it("blanks comments and throws on an unterminated one", () => {
    expect(cssCode(".a { color: red; /* note */ }")).toBe(".a { color: red;            }");
    expect(() => cssCode(".a { /* open")).toThrow(/unterminated/);
  });

  it("is what codeOnly picks for a .css name", () => {
    expect(codeOnly("/* x */.a{}", "a.css")).toBe("       .a{}");
  });
});

describe("readCode", () => {
  it("reads a file relative to a URL with its comments blanked", () => {
    const out = readCode(new URL("./source-text.ts", import.meta.url));
    expect(out).toContain("export function readSource");
    expect(out).not.toContain("fails closed");
  });
});

describe("between", () => {
  it("slices from the start marker to the first end marker after it", () => {
    expect(between("b a x b", "a", "b")).toBe("a x ");
  });

  it("throws when a marker is missing or only precedes the start", () => {
    expect(() => between("abc", "z", "c")).toThrow(/start marker/);
    expect(() => between("b a", "a", "b")).toThrow(/end marker/);
  });
});
