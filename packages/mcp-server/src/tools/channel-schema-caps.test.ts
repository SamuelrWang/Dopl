/**
 * ⚠ THE PUBLISHED INPUT SHAPE MIRRORS THE ROUTE'S, IN BOTH DIRECTIONS. Without
 * the MINIMUMS, `body: ""`, `client_msg_id: ""` and a whitespace-only title all
 * pass the tool, reach the route, and come back as an opaque 400 the write ops
 * must GUESS at (historically: "invite them first" for a rejected body).
 * Declared here they are a -32602 naming the field, before anything is sent.
 *
 * ⚠ DELIBERATELY NOT MIRRORED, and must stay so:
 *  - `summary`'s looser cap. One param serves two routes with two caps, and the
 *    schema declares the LOOSER so a legitimate close summary is never refused
 *    client-side. Pinned below so a "consistency" pass cannot tighten it.
 *  - `.trim()` on the addressee ref. The route trims before measuring; adding
 *    it here would change the bytes that are SENT.
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
    // ⚠ Trim happens first on both sides, so cap + surrounding space passes.
    expect(accepts({ title: ` ${"t".repeat(200)} ` })).toBe(true);
    expect(accepts({ title: "t".repeat(201) })).toBe(false);
  });
});


describe("F5 — what stays deliberately unmirrored", () => {
  it("keeps `summary` at the LOOSER 2000, so a close summary is never refused here", () => {
    // ⚠ An over-length POST summary stays the ROUTE's to reject — one param,
    // two caps, and tightening client-side breaks close_thread.
    expect(accepts({ summary: "s".repeat(201) })).toBe(true);
    expect(accepts({ summary: "s".repeat(2000) })).toBe(true);
    expect(accepts({ summary: "s".repeat(2001) })).toBe(false);
    // ⚠ …and the tighter number is stated in the prose the model reads.
    expect(CHANNEL_INPUT_SHAPE.summary.description).toContain("<=200 chars");
  });

  it("does not trim the addressee ref — that would change the bytes sent", () => {
    const parsed = shape.parse({ op: "post", to: " ada@example.com " });
    expect(parsed.to).toBe(" ada@example.com ");
  });
});
