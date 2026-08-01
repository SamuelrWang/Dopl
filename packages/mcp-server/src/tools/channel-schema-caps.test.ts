/**
 * F5 — THE PUBLISHED INPUT SHAPE MIRRORS THE ROUTE'S, IN BOTH DIRECTIONS.
 *
 * The caps were mirrored in a previous round; the MINIMUMS were not, and one
 * cap was never published at all. So `body: ""`, `client_msg_id: ""`,
 * `title: "   "` and a >64-character agent handle all passed the tool, reached
 * the route, and came back as an opaque 400 — which the write ops then had to
 * GUESS at, and historically guessed wrong ("invite them first" for a rejected
 * body). Declared here they are a -32602 that names the field, before anything
 * is sent.
 *
 * WHAT IS DELIBERATELY NOT MIRRORED, and must stay unmirrored:
 *  - `summary`'s 2000. One param serves two routes with two caps (a post's is
 *    200, close_thread's is 2000) and the schema declares the LOOSER so a
 *    legitimate close summary is never refused client-side. Pinned below so a
 *    later "consistency" pass cannot quietly tighten it.
 *  - `.trim()` on the agent refs. The route trims before measuring; this schema
 *    does not, and adding it here would change the bytes that are SENT.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";

const shape = z.object(CHANNEL_INPUT_SHAPE);

/** Does the published schema accept this partial input? */
function accepts(input: Record<string, unknown>): boolean {
  return shape.safeParse({ op: "post", ...input }).success;
}

describe("F5 — the minimums the route has always enforced", () => {
  it("refuses an empty body, and still takes a real one up to 16000", () => {
    expect(accepts({ body: "" })).toBe(false);
    expect(accepts({ body: "x" })).toBe(true);
    expect(accepts({ body: "x".repeat(16000) })).toBe(true);
    expect(accepts({ body: "x".repeat(16001) })).toBe(false);
  });

  it("refuses a blank idempotency key — a key of \"\" deduped nothing", () => {
    expect(accepts({ client_msg_id: "" })).toBe(false);
    expect(accepts({ client_msg_id: "k" })).toBe(true);
    expect(accepts({ client_msg_id: "k".repeat(200) })).toBe(true);
    expect(accepts({ client_msg_id: "k".repeat(201) })).toBe(false);
  });

  it("refuses a whitespace-only title — measured AFTER the trim, as the route does", () => {
    expect(accepts({ title: "" })).toBe(false);
    expect(accepts({ title: "   " })).toBe(false);
    expect(accepts({ title: "Wire the listener" })).toBe(true);
    // The trim happens first on both sides, so 200 + surrounding space passes.
    expect(accepts({ title: ` ${"t".repeat(200)} ` })).toBe(true);
    expect(accepts({ title: "t".repeat(201) })).toBe(false);
  });
});

describe("F5 — the 64-character agent-ref cap, published at last", () => {
  it("bounds `to_agent`", () => {
    expect(accepts({ to_agent: "quartz" })).toBe(true);
    expect(accepts({ to_agent: "a".repeat(64) })).toBe(true);
    expect(accepts({ to_agent: "a".repeat(65) })).toBe(false);
  });

  it("bounds each ITEM of `to_agents`, not just the list", () => {
    expect(accepts({ to_agents: ["quartz", "onyx"] })).toBe(true);
    expect(accepts({ to_agents: ["quartz", "a".repeat(65)] })).toBe(false);
    // The list bounds are unchanged: 1..8, and an empty list is still refused.
    expect(accepts({ to_agents: [] })).toBe(false);
    expect(accepts({ to_agents: Array(8).fill("q") })).toBe(true);
    expect(accepts({ to_agents: Array(9).fill("q") })).toBe(false);
  });
});

describe("F5 — what stays deliberately unmirrored", () => {
  it("keeps `summary` at the LOOSER 2000, so a close summary is never refused here", () => {
    // A 201-character POST summary is still the ROUTE's to reject: one param,
    // two caps, and refusing at 200 client-side would break close_thread.
    expect(accepts({ summary: "s".repeat(201) })).toBe(true);
    expect(accepts({ summary: "s".repeat(2000) })).toBe(true);
    expect(accepts({ summary: "s".repeat(2001) })).toBe(false);
    // …and the tighter number is still stated in the prose the model reads.
    expect(CHANNEL_INPUT_SHAPE.summary.description).toContain("<=200 chars");
  });

  it("does not trim the agent refs — that would change the bytes sent", () => {
    const parsed = shape.parse({ op: "post", to_agent: " quartz " });
    expect(parsed.to_agent).toBe(" quartz ");
  });
});
