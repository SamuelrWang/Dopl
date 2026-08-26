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
  it("keeps `summary` at the LOOSER 2000, so the ROUTE is what refuses one", () => {
    // ⚠ An over-length POST summary stays the ROUTE's to reject, because the
    // route names the field and a client-side refusal is an opaque -32602. The
    // 2000 was originally the close summary's cap; thread closing is gone
    // (wiring plan Phase 4, 2026-08-18) and the looser number stays anyway, for
    // that reason alone.
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

/**
 * WHAT THE PARAM PROSE PROMISES, where the promise is about something OUTSIDE
 * this schema — a database index, another op's return shape, or the order a
 * desktop gate runs in. A cap can be checked against its own zod; these cannot,
 * so they are pinned as words with the source of truth named in the comment.
 * ⚠ Every one of the three below was WRONG in the shipped copy on 2026-08-24.
 */
describe("the describes that make claims this schema cannot enforce", () => {
  const d = (k: keyof typeof CHANNEL_INPUT_SHAPE): string =>
    CHANNEL_INPUT_SHAPE[k].description ?? "";

  it("client_msg_id: the dedupe is PER-AUTHOR for post and PER-CHANNEL for create_thread", () => {
    // ⚠ ONE PARAM, TWO ROUTES, TWO DIFFERENT UNIQUE INDEXES, and the old copy
    // stated the weaker of them for both: `channel_messages` is unique on
    // `(channel_id, client_msg_id, author_user_id)`
    // (`20260822120000_channel_messages_author_scoped_idempotency.sql`), while
    // `channel_tasks` is still `(channel_id, client_msg_id)`
    // (`20260729032037_channel_tasks_client_msg_id.sql`). An agent told the key
    // is "its own" will collide with another member's on a thread open; one
    // told it is channel-wide will pointlessly avoid a key that is safe.
    expect(d("client_msg_id")).toContain("PER-AUTHOR");
    expect(d("client_msg_id")).toContain("FROM THE SAME ACCOUNT");
    expect(d("client_msg_id")).toContain("both messages post");
    // …and the create_thread half, which is the one that can hand you somebody
    // else's thread (`service-tasks.ts › convergeOnThread` posts NOTHING for a
    // non-creator, so the body silently goes nowhere).
    expect(d("client_msg_id")).toContain("unique per CHANNEL whoever sent it");
    expect(d("client_msg_id")).toContain("with your body posted nowhere");
  });

  it("title: the bound is checked before the WIRE, and claims no precedence over the gate", () => {
    // ⚠ It used to read "rejected here, before the call is made", which claims
    // this bound is the first thing anything checks. It is not: a desktop agent
    // session decides `create_thread` at its own permission gate first
    // (`dopl-desktop-app/main/session-profiles.js › grantDecision`), so a held
    // or refused call never reaches zod and the agent gets a permission answer
    // where the copy promised a title answer.
    expect(d("title")).toContain("When the call is permitted to run");
    expect(d("title")).toContain("before anything goes on the wire");
    expect(d("title")).not.toContain("before the call is made");
  });

  it("since: it points at the one read that deliberately hands back no cursor", () => {
    // ⚠ A JOIN, not a prose pin. `channel-ops-read.ts` refuses to print a seq on
    // a thread-scoped page ("NO CURSOR FROM THIS READ"); an agent that has not
    // hit that page yet reads `since` here and never learns the rule until it
    // has already taken a poisoned cursor. The two teachings now meet where an
    // agent looks. `channel-thread-scope.test.ts` pins the other end.
    expect(d("since")).toContain("THREAD-SCOPED read");
    expect(d("since")).toContain("offers NO cursor at all");
    expect(d("since")).toContain("UNSCOPED read");
  });

  it("thread: get_thread's own param says metadata, not transcript", () => {
    // Stated in BOTH places on purpose (INVARIANTS §10 — a capability taught
    // only in the description is taught weakly): the op bullet is read once at
    // connection, the param prose is beside the argument the agent is filling in.
    expect(d("thread")).toContain("METADATA ONLY");
    expect(d("thread")).toContain('use op="read" with thread=<id>');
  });
});
