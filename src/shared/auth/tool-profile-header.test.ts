/**
 * `X-Dopl-Tool-Profile` — the reader, and the two properties it owes the MCP
 * server (2026-09-02, MCP v2 A3).
 *
 * ⚠ IT IS A SHAPE CHECK, NOT A VOCABULARY CHECK, and that asymmetry with its two
 * siblings (`runtime-header.ts`, `session-header.ts` enumerate; this one does
 * not) is the thing worth pinning: the role names live in ONE place,
 * `packages/mcp-server/src/gating.ts › TOOL_PROFILE_TOOLS`, where an
 * unrecognized one already resolves to "serve everything". A second list here
 * would be a hand-mirror whose only effect is drift.
 *
 * ⚠ SO THE BOUND IS THE SHAPE. The value crosses into a table lookup keyed by a
 * string off the wire, and that is what this file is really guarding.
 */

import { describe, it, expect } from "vitest";
import {
  TOOL_PROFILE_HEADER,
  readToolProfileHeader,
} from "./tool-profile-header";

function req(value?: string): { headers: Headers } {
  const headers = new Headers();
  if (value !== undefined) headers.set(TOOL_PROFILE_HEADER, value);
  return { headers };
}

describe("readToolProfileHeader", () => {
  it("reads the profile names the desktop actually stamps", () => {
    // ⚠ The three `tool-profiles.js › KNOWN_PROFILES` values. They are asserted
    // as SHAPES that survive, not as an allowed set — nothing here rejects a
    // fourth, and wave B adding `courier` must not need an edit in this tree.
    for (const p of ["read_only", "dopl_only", "full", "courier"]) {
      expect(readToolProfileHeader(req(p))).toBe(p);
    }
  });

  it("is undefined when the header is absent or empty", () => {
    expect(readToolProfileHeader(req())).toBeUndefined();
    expect(readToolProfileHeader(req(""))).toBeUndefined();
  });

  it("drops anything that is not a role name, rather than rescuing it", () => {
    // ⚠ No trimming and no case folding — the only sender is our own desktop
    // build, so a near-miss is a bug to notice, not a value to repair. And a
    // dropped value is the SAME answer as no header: serve everything.
    // ⚠ SURROUNDING WHITESPACE IS NOT IN THIS LIST because it can never reach
    // the reader: `Headers` strips leading/trailing OWS from a value per the
    // Fetch spec, so `" dopl_only"` arrives as `dopl_only`. Asserting it as a
    // rejection would be asserting the platform, and would fail.
    for (const bad of [
      "DOPL_ONLY",
      "dopl-only",
      "_private",
      "9lives",
      "a".repeat(33),
    ]) {
      expect(readToolProfileHeader(req(bad)), bad).toBeUndefined();
    }
  });

  it("SECURITY: a DUPLICATED header narrows on the first value, never un-narrows", () => {
    // 🔒 THE DEFECT (2026-09-02). `Headers.get` folds repeated fields into
    // `"a, b"`, the joined string fails the shape test, and `undefined` here
    // means NO NARROWING — the widest answer. So a second copy of this header
    // silently removed the narrowing instead of being refused by it, which is the
    // one direction a fence may never fail.
    // ⚠ Header order is insertion order, so an APPENDED copy is second and has
    // no effect; a proxy re-sending the same value keeps the narrowing it asked
    // for. A comma-joined value and two real headers are indistinguishable here
    // and are the same thing on the wire, so they get the same answer.
    expect(readToolProfileHeader(req("courier, full"))).toBe("courier");
    expect(readToolProfileHeader(req("dopl_only,full"))).toBe("dopl_only");
    // …and a first segment that is not a role name still drops to "no header".
    expect(readToolProfileHeader(req("DOPL_ONLY,full"))).toBeUndefined();
    expect(readToolProfileHeader(req(",full"))).toBeUndefined();
  });

  it("SECURITY: an inherited object key never survives the read", () => {
    // ⚠ The value becomes a lookup key. `__proto__` and `prototype` are refused
    // by shape here; `constructor` is a legal role NAME and is deliberately let
    // through, because the fix for it belongs where the lookup happens — the
    // server's table is a `Map`, which has no inherited keys. Pinned so the two
    // halves of that argument cannot drift apart silently.
    expect(readToolProfileHeader(req("__proto__"))).toBeUndefined();
    expect(readToolProfileHeader(req("constructor"))).toBe("constructor");
  });
});
