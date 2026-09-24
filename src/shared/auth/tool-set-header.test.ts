import { describe, expect, it } from "vitest";
import { readToolSetClaim, TOOL_SET_HEADER } from "./tool-set-header";

const req = (url: string, header?: string) =>
  new Request(url, { headers: header === undefined ? {} : { [TOOL_SET_HEADER]: header } });

describe("readToolSetClaim", () => {
  it("reads the header first", () => {
    expect(readToolSetClaim(req("https://x/api/mcp?tools=legacy", "granular"))).toBe("granular");
  });

  it("falls back to ?tools=", () => {
    expect(readToolSetClaim(req("https://x/api/mcp?tools=granular"))).toBe("granular");
  });

  it("claims nothing when neither is sent", () => {
    expect(readToolSetClaim(req("https://x/api/mcp"))).toBeUndefined();
  });
});
