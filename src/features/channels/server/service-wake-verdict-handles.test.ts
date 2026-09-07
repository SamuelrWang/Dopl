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
 * **A SHARED NAME MINTS A SUFFIX — IT NO LONGER REFUSES THE POST** (2026-09-07, Samuel,
 * verbatim: *"if coder exists, then other slugs will be coder-1, coder-2, coder-3"*).
 *
 * ⚠ **THESE CASES REPLACE THE AMBIGUITY REFUSAL, AND THE REPLACEMENT IS THE RULING, NOT A
 * RELAXATION.** The old answer threw `ChannelAgentHandleAmbiguousError` over a slug two agents
 * claimed, listing the claimants AS THEIR ID FORMS — so the refusal told the writer to retry
 * with a handle it had just refused, and channel-wide resolution made the collision the ordinary
 * case rather than the exotic one. What is measured now is that BOTH agents keep an address.
 *
 * ⚠ **THE THROW IS GONE FROM THE SOURCE, NOT MERELY UNREACHED**, so there is no refusal left to
 * pin: `AgentMentionIndex` is `ReadonlyMap<string, string>` and no handle maps to two agents by
 * construction. `errors-recipient.ts` keeps the error CLASS — a wire-visible code is retired on
 * its own schedule — and nothing here should resurrect a driver for it.
 */
describe("resolveAgentRecipients — a contested handle is minted, not refused", () => {
  it("gives the FIRST claimant the bare slug", async () => {
    projection(
      sessionRow({ id: "s-1", name: "k3v7d2mq", display_name: "Bot" }),
      sessionRow({ id: "s-2", name: "m8q1zzzz", display_name: "Bot" })
    );
    const out = await resolve("@bot go");
    expect(out).toMatchObject({ verdict: "agent", recipientAgentIds: ["k3v7d2mq"] });
  });

  it("keeps the SECOND addressable at `-1` rather than resolving to neither", async () => {
    // ⚠ THIS IS THE HALF THE OLD BEHAVIOUR HAD NO ANSWER FOR. A rename could take a working
    // handle away from an agent that was never renamed; the second claimant now simply wears a
    // different spelling and is still reachable.
    projection(
      sessionRow({ id: "s-1", name: "k3v7d2mq", display_name: "Bot" }),
      sessionRow({ id: "s-2", name: "m8q1zzzz", display_name: "Bot" })
    );
    const out = await resolve("@bot-1 go");
    expect(out).toMatchObject({ verdict: "agent", recipientAgentIds: ["m8q1zzzz"] });
  });

  it("🔒 never outbids an ID FORM — a name that spells one is minted around it", async () => {
    // ⚠ THE PERMANENT HANDLE IS THE ONE THAT CANNOT STOP WORKING (`lib/agent-mentions.ts`
    // header). Pass 1 claims every id form before any name is looked at, so an agent an operator
    // named "Agent K3v7d2mq" cannot withdraw ANOTHER member's agent from addressing.
    projection(
      sessionRow({ id: "s-1", name: "k3v7d2mq" }),
      sessionRow({ id: "s-2", name: "m4x8p1qr", display_name: "Agent K3v7d2mq" })
    );
    const owner = await resolve("@agent-k3v7d2mq go");
    expect(owner.recipientAgentIds).toEqual(["k3v7d2mq"]);
    const namer = await resolve("@agent-k3v7d2mq-1 go");
    expect(namer.recipientAgentIds).toEqual(["m4x8p1qr"]);
  });

  /**
   * ⚠ **DRIVEN DIRECTLY RATHER THAN THROUGH `resolve`, ON PURPOSE.** The reserved set arrives on
   * `WakeVerdictContext` from the metadata fold's own roster read, and a body whose only tag
   * names a MEMBER resolves no agent — which sends the verdict into the resilience arms and
   * measures RR3 instead of the precedence this case is about.
   */
  it("🔒 a MEMBER keeps the bare tag and the agent named after them is minted `-1`", async () => {
    projection(sessionRow({ name: "k3v7d2mq", display_name: "Diana" }));
    expect(
      await resolveAgentRecipients(CTX, "chan-1", "@diana hello", null, "user", ["diana"])
    ).toBeNull();
    expect(
      await resolveAgentRecipients(CTX, "chan-1", "@diana-1 hello", null, "user", ["diana"])
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

