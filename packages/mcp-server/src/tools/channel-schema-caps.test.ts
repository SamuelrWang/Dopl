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
import { CHANNEL_DOCTRINE } from "./channel-doctrine";
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
    // ⚠ **AND IT NAMES THE TWO AGENT LANES SINCE A10 (2026-09-02)** — the same
    // key now makes a timed-out `launch_agent` / `direct_agent` safe to retry,
    // which is the code behind a rule the doctrine used to state as a
    // prohibition ("do NOT issue it again").
    expect(d("client_msg_id")).toContain('op="launch_agent"');
    expect(d("client_msg_id")).toContain('op="direct_agent"');
    // ⚠ THE DOCTRINE IS PINNED AT BOTH ENDS so the collapse cannot happen in one
    // place and leave the pulled document teaching the retired rule.
    expect(CHANNEL_DOCTRINE).toContain("neither suppressing the other");
    expect(CHANNEL_DOCTRINE).not.toContain("with your body posted nowhere");
    expect(CHANNEL_DOCTRINE).not.toContain("PER-CHANNEL whoever sent it");
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

  it("agent_id: a foreign id is not \"refused outright\" — the direction IS filed", () => {
    // ⚠ **G3 / F-418 (A6, 2026-09-02).** The old copy read "An id belonging to
    // another member is REFUSED outright and no request is filed", and
    // `service-directions.ts` files the direction with NO ownership check —
    // what answers is the CALLER'S OWN desktop, with `no-session`. Gating on
    // `channel_sessions` is deliberately NOT the fix: it 400s legitimate
    // directions whenever the projection lags. The server becoming the
    // authority is A9's; until then the honest claim is the only guardrail, so
    // it is pinned in both directions.
    expect(d("agent_id")).toContain("reaches nothing");
    expect(d("agent_id")).toContain("`no-session`");
    expect(d("agent_id")).not.toContain("no request is filed");
    expect(CHANNEL_DOCTRINE).toContain("the request is filed against YOUR side");
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
