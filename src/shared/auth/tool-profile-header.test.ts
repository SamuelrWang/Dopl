/**
 * `X-Dopl-Tool-Profile` — the reader, and the two properties it owes the MCP
 * server (2026-09-02, MCP v2 A3; the tri-state below is wave B slice B5).
 *
 * ⚠ IT IS A SHAPE CHECK, NOT A VOCABULARY CHECK, and that asymmetry with its two
 * siblings (`runtime-header.ts`, `session-header.ts` enumerate; this one does
 * not) is the thing worth pinning: the profile names live in ONE place,
 * `packages/mcp-server/src/gating.ts › TOOL_PROFILES`, which is also where a
 * name this server cannot place falls to the narrowest profile. A second list
 * here would be a hand-mirror whose only effect is drift.
 *
 * ⚠ SO WHAT THIS MODULE OWES IS THE DIFFERENCE BETWEEN **NO HEADER** AND **A
 * HEADER I CANNOT READ**. The first is the only answer that serves the whole
 * surface; the second must reach the server as a claim, so it can take its
 * floor. They were the same value until this slice, which is the whole of the
 * duplicate-header defect below.
 */

import { describe, it, expect } from "vitest";
import {
  TOOL_PROFILE_HEADER,
  UNREADABLE_TOOL_PROFILE,
  readToolProfileHeader,
} from "./tool-profile-header";

function req(...values: string[]): { headers: Headers } {
  const headers = new Headers();
  // ⚠ `append`, not `set`: repeated fields are the subject of half this file and
  // `Headers` folds them exactly as a proxy's would.
  for (const value of values) headers.append(TOOL_PROFILE_HEADER, value);
  return { headers };
}

describe("readToolProfileHeader", () => {
  it("reads a profile name back verbatim, enumerating none of them", () => {
    // ⚠ `courier` is in this list ON PURPOSE and it is not a profile: this
    // module has no vocabulary, so a name it has never heard of is read and
    // handed on unchanged. What refuses it is the server's table.
    for (const value of ["read_only", "dopl_only", "channel_agent", "full", "courier"]) {
      expect(readToolProfileHeader(req(value))).toBe(value);
    }
  });

  it("is undefined ONLY when no header was sent", () => {
    // ⚠ The one "no claim" answer, and the only one that serves everything: the
    // OAuth connector, the stdio binary and any desktop older than this header.
    expect(readToolProfileHeader(req())).toBeUndefined();
  });

  it("a header that is PRESENT but unreadable is a claim, not an absence", () => {
    // 🔒 THE DIRECTION THAT MAY NOT FAIL. Each of these used to answer
    // `undefined` — indistinguishable from "no header", which is the WIDEST
    // answer this value can produce. ⚠ SURROUNDING WHITESPACE IS NOT ON THIS
    // LIST because it can never reach the reader: `Headers` strips leading and
    // trailing OWS per the Fetch spec, so `" dopl_only"` arrives as `dopl_only`.
    for (const bad of ["", "DOPL_ONLY", "dopl-only", "_private", "9lives", "a".repeat(33)]) {
      expect(readToolProfileHeader(req(bad)), bad).toBe(UNREADABLE_TOOL_PROFILE);
      expect(readToolProfileHeader(req(bad)), bad).not.toBeUndefined();
    }
  });

  it("SECURITY: a DUPLICATED header never un-narrows the request", () => {
    // 🔒 THE DEFECT (2026-09-02). `Headers.get` folds repeated fields into
    // `"a, b"`, the joined string fails the shape test, and `undefined` meant NO
    // NARROWING. So a second copy of this header — from a proxy that appends
    // rather than replaces, or from anything that can add one — silently removed
    // the narrowing instead of being refused by it.
    //
    // ⚠ IDENTICAL IS ONE CLAIM, DIFFERING IS NONE. A proxy re-sending the same
    // value asked for exactly the narrowing the sender did and keeps it; two
    // different values are two claims this layer cannot choose between, so it
    // reports neither and the server takes its floor.
    expect(readToolProfileHeader(req("dopl_only", "dopl_only"))).toBe("dopl_only");
    expect(readToolProfileHeader(req("dopl_only", "full"))).toBe(UNREADABLE_TOOL_PROFILE);
    expect(readToolProfileHeader(req("full", "dopl_only"))).toBe(UNREADABLE_TOOL_PROFILE);
    // A comma-joined value and two real header lines are the same bytes on the
    // wire and get the same answer.
    expect(readToolProfileHeader(req("dopl_only, dopl_only"))).toBe("dopl_only");
    expect(readToolProfileHeader(req("courier, full"))).toBe(UNREADABLE_TOOL_PROFILE);
    expect(readToolProfileHeader(req(",full"))).toBe(UNREADABLE_TOOL_PROFILE);
  });

  it("SECURITY: an inherited object key never survives the read as one", () => {
    // ⚠ The value becomes a lookup key. `__proto__` is refused by shape here;
    // `constructor` is a legal profile NAME and is deliberately let through,
    // because the fix for it belongs where the lookup happens — `gating.ts`
    // resolves any unplaceable name to the narrowest profile before indexing
    // anything. Pinned so the two halves of that argument cannot drift apart.
    expect(readToolProfileHeader(req("__proto__"))).toBe(UNREADABLE_TOOL_PROFILE);
    expect(readToolProfileHeader(req("constructor"))).toBe("constructor");
  });
});
