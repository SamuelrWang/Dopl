import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./repository-sessions");
vi.mock("./repository-messages");

import * as repoSessions from "./repository-sessions";
import { resolveAgentRecipients } from "./service-wake-verdict-handles";
import {
  CTX,
  lastAddress,
  projection,
  recentAgentPosts,
  resolve,
  roomProjection,
  sessionRow,
} from "./service-wake-verdict-harness";

/**
 * **THE AGENT-HANDLE DOOR** (`service-wake-verdict-handles.ts`, §1 split
 * 2026-09-04): which agent a handle names, and WHOSE sessions the author is
 * allowed to look through to find it.
 *
 * ⚠ **THE TWO QUESTIONS ARE ONE FILE BECAUSE THEY ARE ONE DECISION.** "Does
 * `@main` resolve" and "may THIS author resolve it" are answered by the same
 * lookup against the same index; splitting them across suites is how a scope
 * change passes with the grammar's tests still green.
 *
 * ⚠ PRECEDENCE — which door wins, and what the outcome is called — is
 * `service-wake-verdict.test.ts`.
 */

beforeEach(() => {
  vi.clearAllMocks();
  projection();
  roomProjection();
  lastAddress(null);
  recentAgentPosts();
});

describe("resolveAgentRecipients — the scope a body handle resolves against", () => {
  it("scopes a HUMAN author's projection read to this channel, whoever runs the agent", async () => {
    projection(sessionRow({ name: "k3v7d2mq" }));
    await resolve("@agent-k3v7d2mq go");
    expect(vi.mocked(repoSessions.listChannelSessionStates).mock.calls).toEqual([
      ["ws-1", "chan-1"],
    ]);
  });

});

/**
 * **A SHARED NAME CANNOT REACH THIS DOOR — IT IS RESOLVED WHERE THE NAME IS COMMITTED**
 * (Samuel, 2026-09-15, verbatim: *"I think we should enforce a rule where no two agents that are
 * addressable can have the same name … it will automatically auto-resolve to coder-1 … coder-2
 * and so on and so forth."*).
 *
 * ⚠ **THESE CASES HAVE ANSWERED FOUR DIFFERENT WAYS IN TWO WEEKS, AND EVERY ONE BEFORE THIS WAS
 * A RESOLVE-TIME ANSWER TO A COMMIT-TIME PROBLEM.** (1) To 2026-09-07 a slug two agents claimed
 * threw `ChannelAgentHandleAmbiguousError`, listing its claimants AS THEIR ID FORMS — a refusal
 * that told the writer to retry with the handle it had just refused, over the WHOLE post. (2) To
 * 2026-09-15 it minted `bot-1` for the second claimant, positionally over the live set, so the
 * suffix re-pointed whenever an agent ended. (3) For part of that day it resolved to NEITHER and
 * told the author to use the id form. (4) It now resolves to the FIRST claimant, and that branch
 * is unreachable in the ordinary case because the second "Bot" is STORED as `Bot-1`
 * (`main/agent-name-unique.js`).
 *
 * ⚠ **THE THROW IS STILL GONE FROM THE SOURCE AND MUST STAY GONE.** There is no ambiguity left
 * for an error to describe. `errors-recipient.ts` keeps the error CLASS — a wire-visible code is
 * retired on its own schedule — and nothing here should resurrect a driver for it.
 */
describe("resolveAgentRecipients — one handle, one agent", () => {
  /**
   * ⚠ **DRIVEN DIRECTLY RATHER THAN THROUGH `resolve`, ON PURPOSE** — the reason the member case
   * below gives: a body whose tag resolves no agent sends `resolveWakeVerdict` on into the
   * resilience arms and measures RR3 instead of the grammar this block is about.
   */
  const door = (body: string) =>
    resolveAgentRecipients(CTX, "chan-1", body, null, "user");

  it("resolves a name SUFFIXED AT LAUNCH like any other name", () => {
    // ⚠ THIS IS WHAT THE RULING ACTUALLY PRODUCES ON THE WIRE — `display_name` IS `Bot-1`, and
    // nothing in this lane parses a `-1`: it slugs by the ordinary rule.
    projection(
      sessionRow({ id: "s-1", name: "k3v7d2mq", display_name: "Bot" }),
      sessionRow({ id: "s-2", name: "m8q1zzzz", display_name: "Bot-1" })
    );
    return Promise.all([
      expect(door("@bot go")).resolves.toEqual(["k3v7d2mq"]),
      expect(door("@bot-1 go")).resolves.toEqual(["m8q1zzzz"]),
    ]);
  });

  it("names the FIRST claimant if a duplicate somehow arrives — never neither", async () => {
    // ⚠ **REACHABLE ONLY ACROSS MACHINES.** Names are minted on the machine that owns the id, so
    // this lane (which reads the ROOM's rows, whoever runs them) can still see two members' agents
    // both called "Bot". ⚠ Naming the first never re-points an address and never withdraws one,
    // where "neither" silently drops a message whose tag the author watched tint.
    projection(
      sessionRow({ id: "s-1", name: "k3v7d2mq", display_name: "Bot" }),
      sessionRow({ id: "s-2", name: "m8q1zzzz", display_name: "Bot" })
    );
    expect(await door("@bot go")).toEqual(["k3v7d2mq"]);
  });

  it("mints NO suffixed spelling of its own", async () => {
    // ⚠ THE 2026-09-07 MINT IS WITHDRAWN AND NOTHING REPLACES IT AT RESOLVE TIME. `@bot-1` names
    // an agent only when an agent is STORED as `Bot-1`.
    projection(
      sessionRow({ id: "s-1", name: "k3v7d2mq", display_name: "Bot" }),
      sessionRow({ id: "s-2", name: "m8q1zzzz", display_name: "Bot" })
    );
    expect(await door("@bot-1 go")).toBeNull();
  });

  it("🔒 never outbids an ID FORM — a name that spells one claims nothing at all", async () => {
    // ⚠ THE PERMANENT HANDLE IS THE ONE THAT CANNOT STOP WORKING (`lib/agent-mentions.ts`
    // header). Pass 1 claims every id form before any name is looked at, and the `idForms` guard
    // keeps pass 2 off those keys — so an agent an operator named "Agent K3v7d2mq" can neither
    // take nor withdraw another member's agent's address.
    projection(
      sessionRow({ id: "s-1", name: "k3v7d2mq" }),
      sessionRow({ id: "s-2", name: "m4x8p1qr", display_name: "Agent K3v7d2mq" })
    );
    expect(await door("@agent-k3v7d2mq go")).toEqual(["k3v7d2mq"]);
    expect(await door("@agent-k3v7d2mq-1 go")).toBeNull();
  });

  /**
   * ⚠ **DRIVEN DIRECTLY RATHER THAN THROUGH `resolve`, ON PURPOSE.** The reserved set arrives on
   * `WakeVerdictContext` from the metadata fold's own roster read, and a body whose only tag
   * names a MEMBER resolves no agent — which sends the verdict into the resilience arms and
   * measures RR3 instead of the precedence this case is about.
   */
  it("🔒 a MEMBER keeps the bare tag and the agent named after them gets no spelling at all", async () => {
    // ⚠ CHANGED 2026-09-15 WITH THE MINT'S WITHDRAWAL — `@diana-1` was the agent's minted
    // spelling and is now nobody's. The agent keeps its id form, which is the line below.
    projection(sessionRow({ name: "k3v7d2mq", display_name: "Diana" }));
    // ⚠ **`[]`, NOT `null`, SINCE 2026-09-15 — and this assertion is the bug it was hiding.**
    // The two were interchangeable when this case was written; `service-wake-verdict.ts ›
    // namedButUnresolved` made them different claims, and `null` here said "the author named an
    // agent I cannot place" about a body that named a MEMBER — turning RR3 off and stamping
    // `unreachable`. `[]` is this docblock's own sentence: no agent, on to the resilience arms.
    expect(
      await resolveAgentRecipients(CTX, "chan-1", "@diana hello", null, "user", ["diana"])
    ).toEqual([]);
    expect(
      await resolveAgentRecipients(CTX, "chan-1", "@diana-1 hello", null, "user", ["diana"])
    ).toBeNull();
    expect(
      await resolveAgentRecipients(CTX, "chan-1", "@agent-k3v7d2mq hello", null, "user", ["diana"])
    ).toEqual(["k3v7d2mq"]);
  });

  it("reserves nothing when the caller passes no roster — the pre-2026-09-07 answer", async () => {
    // ⚠ ABSENT MEANS "NO MEMBER NAMESPACE TO RESPECT", NOT "NO MEMBERS". Every caller without a
    // roster in hand is unchanged, which is what makes the parameter safe to default.
    projection(sessionRow({ name: "k3v7d2mq", display_name: "Diana" }));
    expect(
      await resolveAgentRecipients(CTX, "chan-1", "@diana hello", null, "user")
    ).toEqual(["k3v7d2mq"]);
  });
});

/**
 * **A PERSON'S TAG FOR A PEER'S AGENT RESOLVES** (2026-09-04, follow-up 1 to the
 * self-wake investigation).
 *
 * ⚠ **THE DOOR WAS OWN-SCOPED FOR BOTH KINDS OF AUTHOR, WHICH IS THE CARVE
 * APPLIED TO THE WRONG HALF.** `freshOwnSessions` answers "my machine's live
 * agents", so Anthony's `@agent-deynelz3` — Samuel's agent — matched nothing:
 * #975 stored `verdict=responder` (RR3 rescued it only because the room happened
 * to hold ONE live agent), and #964 / #967 / #970 stored `verdict=none` with
 * `recipient_agent_ids=NULL` despite carrying the tag. They reached the agent at
 * all only through the desktop's own body-parse fallback.
 *
 * ⚠ **IT IS STRICTLY NARROWER THAN RR3, WHICH ALREADY ROUTES CHANNEL-WIDE.** An
 * unaddressed human post reaches the room's agents today; a human post that
 * TYPED a handle is asking for less. What stays closed is the agent-author door.
 */
describe("resolveWakeVerdict — a human's tag reaches a PEER's agent", () => {
  /** The room holds a peer's agent and NONE of the caller's own. */
  function peersAgentOnly(): void {
    projection();
    roomProjection(sessionRow({ id: "s-9", user_id: "user-2", name: "deynelz3" }));
  }

  it("resolves `@agent-<id>` for an agent this caller does not run — the #975 row", async () => {
    peersAgentOnly();
    const out = await resolve("@agent-deynelz3 hello");
    expect(out).toMatchObject({
      verdict: "agent",
      recipientAgentIds: ["deynelz3"],
      delivery: "woken",
    });
  });

  it("stores the recipient rather than leaving it NULL — the #964 / #967 / #970 rows", async () => {
    peersAgentOnly();
    const out = await resolve("@agent-deynelz3 status please");
    expect(out.recipientAgentIds).not.toBeNull();
    // ⚠ `agent`, NOT `responder`. RR3 rescued exactly this shape in a ONE-agent
    // room (#975) and the verdict is the only thing that tells the two apart —
    // an assertion on the recipient set alone passes on the broken behaviour.
    expect(out.verdict).toBe("agent");
  });

  it("resolves a peer's RENAME through the same shared index", async () => {
    projection();
    roomProjection(
      sessionRow({
        id: "s-9",
        user_id: "user-2",
        name: "deynelz3",
        display_name: "Mobile Main",
      }),
      // ⚠ A SECOND AGENT SO RR3 CANNOT ANSWER — see the note above.
      sessionRow({ id: "s-8", user_id: "user-3", name: "a1b2c3d4" })
    );
    const out = await resolve("@mobile-main go");
    expect(out.recipientAgentIds).toEqual(["deynelz3"]);
    expect(out.verdict).toBe("agent");
  });

  it("reaches a peer's agent even with a second agent live — RR3 arm 2 cannot", async () => {
    // ⚠ THE CASE THE OLD BEHAVIOUR HAD NO ANSWER FOR AT ALL. With one live agent
    // RR3 rescued the miss and the defect was invisible; with two it routed to
    // nobody, which is the room every multiplayer channel becomes.
    projection();
    roomProjection(
      sessionRow({ id: "s-9", user_id: "user-2", name: "deynelz3" }),
      sessionRow({ id: "s-8", user_id: "user-3", name: "a1b2c3d4" })
    );
    const out = await resolve("@agent-deynelz3 only you");
    expect(out.recipientAgentIds).toEqual(["deynelz3"]);
    expect(out.verdict).toBe("agent");
  });

  it("🔒 an AGENT author still cannot reach a peer's agent — the carve is unmoved", async () => {
    projection(sessionRow({ name: "k3v7d2mq" }));
    roomProjection(
      sessionRow({ name: "k3v7d2mq" }),
      sessionRow({ id: "s-9", user_id: "user-2", name: "deynelz3" })
    );
    const out = await resolve("@agent-deynelz3 do this for me", {
      session_id: "chan-1::k3v7d2mq",
    }, { authorKind: "agent" });
    // Unresolved against the author's OWN sessions → `null`, the machine decides.
    expect(out.recipientAgentIds).toBeNull();
    expect(out.verdict).not.toBe("agent");
  });
});

