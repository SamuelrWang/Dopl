/**
 * **THE AGENT-COLOUR MODULE** — the sixteen keys, the dispatch narrowing, the defensive
 * read of the 409's `details.free`, and the refusal written from it.
 *
 * ⚠ **WRITTEN BECAUSE THE MODULE HAD NO SUITE AT ALL (2026-09-14 review).** Replacing
 * `asAgentColorKey`'s membership test with a bare `value as AgentColorKey` left all 109
 * mcp-server files green — and that function's own docblock is an argument that it is
 * *"A NARROWING, NEVER A CAST"*. ⚠ Its docblock also cited `agent-color-wire.test.ts` as
 * the gate holding {@link AGENT_COLOR_KEYS} to the union; **no such file exists**, and the
 * real tie is the `satisfies readonly AgentColorKey[]` clause on the declaration (a
 * compile error, not a test). Both were corrected in the same change as this file.
 *
 * ⚠ **THE WIRE SHAPE IS `details.free`**, from
 * `src/features/channels/server/http-mapping.ts › AgentColorTakenError` → 409
 * `AGENT_COLOR_TAKEN`. This package cannot import that tree, so the shape is DUCK-TYPED
 * and the cases below drive the malformed variants a transport or an older server can
 * actually produce.
 */

import { describe, it, expect } from "vitest";
import {
  AGENT_COLOR_KEYS,
  asAgentColorKey,
  colorTaken,
  freeColors,
} from "./channel-ops-launch-color";

/** The 409 as `channel-ops-launch.ts › opLaunchAgent` receives it. */
function taken(details: unknown): unknown {
  return { code: "AGENT_COLOR_TAKEN", details };
}

function text(response: { content: Array<{ text?: string }> }): string {
  return response.content.map((c) => c.text ?? "").join("\n");
}

describe("AGENT_COLOR_KEYS — the bank, in the bank's order", () => {
  it("is the sixteen `agent-NN` keys, 01 through 16, in order", () => {
    // ⚠ ORDER IS THE CONTRACT, not an accident: the refusal offers "the first one
    // in that list" and it must be the key the server would itself have picked.
    expect(AGENT_COLOR_KEYS).toEqual([
      "agent-01", "agent-02", "agent-03", "agent-04",
      "agent-05", "agent-06", "agent-07", "agent-08",
      "agent-09", "agent-10", "agent-11", "agent-12",
      "agent-13", "agent-14", "agent-15", "agent-16",
    ]);
    expect(new Set(AGENT_COLOR_KEYS).size).toBe(16);
  });
});

describe("asAgentColorKey — a narrowing, never a cast", () => {
  it("passes every key through unchanged", () => {
    for (const key of AGENT_COLOR_KEYS) expect(asAgentColorKey(key)).toBe(key);
  });

  it("🔒 answers undefined for anything outside the set", () => {
    // ⚠ THE MUTATION THIS FILE EXISTS FOR: a bare cast returns each of these
    // verbatim, and the SDK then puts a key the server has never heard of on the
    // directive row. Absent and unrecognized are the same answer on purpose —
    // both mean "the server picks the first free one".
    expect(asAgentColorKey(undefined)).toBeUndefined();
    expect(asAgentColorKey("")).toBeUndefined();
    expect(asAgentColorKey("agent-17")).toBeUndefined();
    expect(asAgentColorKey("agent-00")).toBeUndefined();
    expect(asAgentColorKey("agent-1")).toBeUndefined();
    expect(asAgentColorKey("AGENT-01")).toBeUndefined();
    expect(asAgentColorKey("blue")).toBeUndefined();
  });
});

describe("freeColors — shape-checked, not trusted", () => {
  it("reads the free set off the 409's details", () => {
    expect(freeColors(taken({ free: ["agent-02", "agent-09"] }))).toEqual([
      "agent-02",
      "agent-09",
    ]);
  });

  it("degrades to no list rather than throwing or inventing one", () => {
    // A server older than the free-set change, or a transport that lost `details`.
    expect(freeColors(taken(undefined))).toEqual([]);
    expect(freeColors({ code: "AGENT_COLOR_TAKEN" })).toEqual([]);
    expect(freeColors(null)).toEqual([]);
    expect(freeColors(undefined)).toEqual([]);
    expect(freeColors(taken({ free: "agent-02" }))).toEqual([]);
    expect(freeColors(taken({ free: {} }))).toEqual([]);
    // ⚠ AND IT DROPS THE UNUSABLE MEMBERS RATHER THAN THE WHOLE LIST — an empty
    // string would render as an empty backticked bullet the caller cannot retry with.
    expect(freeColors(taken({ free: ["agent-02", "", 7, null, "agent-05"] }))).toEqual([
      "agent-02",
      "agent-05",
    ]);
  });
});

describe("colorTaken — the refusal an orchestrator can act on", () => {
  it("names what was asked for, lists what is free, and pins the retry key", () => {
    const message = text(colorTaken("agent-03", ["agent-02", "agent-09"]));
    expect(message).toContain("`agent-03`");
    expect(message).toContain("`agent-02`, `agent-09`");
    // 🔒 THE RETRY KEY IS THE ONE WAY THIS REFUSAL COULD FILE TWO DIRECTIVES.
    expect(message).toContain("SAME `client_msg_id`");
    // Nothing was filed — an orchestrator that reads otherwise waits for a
    // directive that does not exist.
    expect(message).toContain("nothing was filed");
  });

  it("🔒 with every colour out, instructs omission rather than an empty list", () => {
    const message = text(colorTaken("agent-03", []));
    expect(message).toContain("`agent-03`");
    expect(message).toContain("re-issue WITHOUT `color`");
    // ⚠ NO EMPTY BULLET LINE: "pick from: " followed by nothing is the shape this
    // branch exists to avoid.
    expect(message).not.toContain("Re-issue with one of these");
  });

  it("falls back to 'that colour' when the caller named none", () => {
    // Reachable: `opLaunchAgent` passes `opts.color ?? ""`, and a server may refuse
    // a launch whose colour it picked itself.
    expect(text(colorTaken("", ["agent-02"]))).toContain("that colour");
    expect(text(colorTaken("", []))).toContain("that colour");
  });
});
