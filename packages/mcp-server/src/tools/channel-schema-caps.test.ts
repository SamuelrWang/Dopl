/**
 * ⚠ THE PUBLISHED INPUT SHAPE MIRRORS THE ROUTE'S, IN BOTH DIRECTIONS. Without
 * the MINIMUMS, `body: ""` and `client_msg_id: ""` pass the tool, reach the
 * route, and come back as an opaque 400 the write ops must GUESS at
 * (historically: "invite them first" for a rejected body). Declared here they
 * are a -32602 naming the field, before anything is sent.
 *
 * ⚠ **TWO OF THIS FILE'S THREE DELIBERATE NON-MIRRORS ARE GONE, BY RULING AND BY
 * MERGE** (2026-09-02, slice B8):
 *  - `summary`'s LOOSER 2000 is deleted. It existed so an over-length summary
 *    would be the ROUTE's to refuse with the field named — but the route enforces
 *    200 and always has, so the schema was publishing a cap the surface does not
 *    have. Samuel's ruling: one field, one number, both ends. The case below is
 *    inverted rather than deleted, so the old looseness cannot come back by
 *    accident.
 *  - `.trim()` on the addressee ref is now CORRECT rather than forbidden. The
 *    rule was never "do not trim", it was "trim where and only where the route
 *    trims before measuring" — and `src/features/channels/schema.ts ›
 *    ChannelMessageCreateSchema.to` is `z.string().trim()`. The old
 *    non-mirror dated from when this param resolved to a MEMBER client-side and
 *    the bytes went out as typed.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { CHANNEL_DOCTRINE } from "./channel-doctrine";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";

const shape = z.object(CHANNEL_INPUT_SHAPE);

/** Does the published schema accept this partial input? */
function accepts(input: Record<string, unknown>): boolean {
  return shape.safeParse({ op: "send", ...input }).success;
}

describe("F5 — the minimums the route has always enforced", () => {
  it("refuses an empty body, and still takes a real one up to 16000", () => {
    expect(accepts({ body: "" })).toBe(false);
    expect(accepts({ body: "x" })).toBe(true);
    expect(accepts({ body: "x".repeat(16000) })).toBe(true);
    expect(accepts({ body: "x".repeat(16001) })).toBe(false);
  });

  it('refuses a blank idempotency key — a key of "" deduped nothing', () => {
    expect(accepts({ client_msg_id: "" })).toBe(false);
    expect(accepts({ client_msg_id: "k" })).toBe(true);
    expect(accepts({ client_msg_id: "k".repeat(200) })).toBe(true);
    expect(accepts({ client_msg_id: "k".repeat(201) })).toBe(false);
  });

  it("measures `summary` AFTER the trim, as the route does", () => {
    // ⚠ `summary` IS THE THREAD TITLE ON `thread="new"` (B8) — the param that
    // used to be `title`, with the same trim-then-measure rule, because both
    // sides have to agree on what "200 characters" counts.
    expect(accepts({ summary: `  ${"t".repeat(200)}  ` })).toBe(true);
    expect(accepts({ summary: "t".repeat(201) })).toBe(false);
  });
});

describe("F5 — the two non-mirrors that ENDED, pinned so they cannot return", () => {
  it("holds `summary` at 200 — the ROUTE's number, on both ends (Samuel's ruling)", () => {
    // ⚠ THE INVERSION OF THE OLD CASE, AND IT IS A RULING RATHER THAN A
    // CONSISTENCY PASS. The schema published 2000 against a route that enforces
    // 200: every summary between the two was accepted client-side and refused on
    // the wire, which is precisely the opaque -32602 the looseness was meant to
    // prevent, arriving one hop later.
    expect(accepts({ summary: "s".repeat(200) })).toBe(true);
    expect(accepts({ summary: "s".repeat(201) })).toBe(false);
    // ⚠ …and the number is NOT typed into the prose any more: `maxLength` and
    // the description's rendered `Limits:` block are the two copies, and a third
    // is the one that goes stale (`tool-style.test.ts` fails one).
    expect(CHANNEL_INPUT_SHAPE.summary.description).not.toContain("200");
  });

  it("trims the addressee ref, because the ROUTE trims before measuring", () => {
    const parsed = shape.parse({ op: "send", to: " ada@example.com " });
    expect(parsed.to).toBe("ada@example.com");
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

  it("client_msg_id: ONE key rule — PER-AUTHOR on every op", () => {
    // ⚠ ONE PARAM, ONE RULE, SINCE 2026-09-02 (C14). It used to be two: while
    // `channel_tasks` was unique on `(channel_id, client_msg_id)`, this copy had
    // to teach that a peer's key handed you back THEIR thread — a documented
    // redirect into somebody else's exchange. `20260913120000` widened it to
    // `(channel_id, client_msg_id, created_by)`, matching
    // `20260822120000`'s shape for `channel_messages`, so the description states
    // the SAME contract on both routes and neither half is the weaker claim.
    expect(d("client_msg_id")).toContain("PER-AUTHOR on every op");
    // ⚠ AND THE OLD, NOW-FALSE TEACHING MUST NOT COME BACK. An agent told a key
    // is channel-wide will pointlessly avoid one that is safe, and one told a
    // peer can take its thread will build a workaround for a fence that holds.
    expect(d("client_msg_id")).not.toContain("PER-CHANNEL");
    expect(d("client_msg_id")).not.toContain("THEIR thread");
    // ⚠ **AND IT NAMES BOTH LANES SINCE A10 (2026-09-02)** — the same key makes a
    // timed-out launch or direction safe to retry, which is the code behind a
    // rule the doctrine used to state as a prohibition ("do NOT issue it again").
    // ⚠ Both lanes are now ONE op (`manage`), so the pair of op names became one.
    expect(d("client_msg_id")).toContain('op="send"');
    expect(d("client_msg_id")).toContain('op="manage"');
  });

  it("since: it points at the one read that deliberately hands back no cursor", () => {
    // ⚠ A JOIN, not a prose pin. `channel-ops-read.ts` refuses to print a seq on
    // a thread-scoped page ("NO CURSOR FROM THIS READ"); an agent that has not
    // hit that page yet reads `since` here and never learns the rule until it
    // has already taken a poisoned cursor. The two teachings now meet where an
    // agent looks. `channel-thread-scope.test.ts` pins the other end.
    expect(d("since")).toContain("THREAD-SCOPED read");
    expect(d("since")).toContain("hands back none");
  });

  it('to: a foreign agent id is not "refused outright" — the direction IS filed', () => {
    // ⚠ **G3 / F-418 (A6, 2026-09-02).** The old copy read "An id belonging to
    // another member is REFUSED outright and no request is filed", and
    // `service-directions.ts` files the direction with NO ownership check —
    // what answers is the CALLER'S OWN desktop, with `no-session`. Gating on
    // `channel_sessions` is deliberately NOT the fix: it 400s legitimate
    // directions whenever the projection lags. The server becoming the
    // authority is A9's; until then the honest claim is the only guardrail, so
    // it is pinned in both directions.
    // ⚠ **THE PARAM IS `to` SINCE B8** — `agent_id` folded into the one recipient
    // field — so the CLAIM moved with it, into the doctrine's `manage` section
    // where the whole lane is described. That is a relocation, and this pin is
    // what proves the fact was not dropped on the way.
    expect(CHANNEL_DOCTRINE).toContain("another member's id reaches nothing");
    expect(CHANNEL_DOCTRINE).toContain("`no-session`");
    expect(CHANNEL_DOCTRINE).not.toContain("no request is filed");
  });

  it("thread: one op answers the noun, so the param has no split to explain", () => {
    // ⚠ **C15 (2026-09-02).** This param used to spend its longest clause
    // telling a caller that `op="get_thread"` returned METADATA ONLY and that
    // the transcript was a DIFFERENT op — 200 characters existing only because
    // two ops answered "what is this exchange". `read(thread=)` renders the card
    // and the messages, so the disambiguation is deleted rather than reworded.
    expect(d("thread")).toContain("its metadata header plus only that exchange");
    expect(d("thread")).not.toContain("get_thread");
    expect(d("thread")).not.toContain("METADATA ONLY");
  });
});
