import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./repository-sessions");
vi.mock("./repository-messages");
/** ⚠ PARTIAL, never flat — see `service-wake-verdict.test.ts` for why this mock
 *  exists at all and why it must not fail fast. */
vi.mock("./repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./repository")>()),
  findUnaddressedResponder: vi.fn(),
}));

import {
  projection,
  recentAgentPosts,
  resolve,
  roomProjection,
  sessionRow,
  unaddressedResponder,
} from "./service-wake-verdict-harness";

/**
 * **THE ADDRESSING STRUCTURE, ON THE SERVER** (2026-09-18, Samuel's ruling).
 *
 * Three claims, and each is a different failure if it slips:
 *   1. **AN AGENT'S PROSE NAMES NOBODY.** A report saying *"I handed off to
 *      @<agent>"* used to WAKE that agent, because the body parse never asked who
 *      was writing — the sentence describing a handoff and the handoff itself
 *      were one wire shape.
 *   2. **A RECORD IS NOT A FORGOTTEN `@`.** The resilience arms repair an address
 *      that went missing; a record has none ON PURPOSE, and repairing it aims a
 *      wake at a post whose author said it was for nobody.
 *   3. **`to` NAMES SEVERAL.** *"agents might need to respond to multiple agents,
 *      not necessarily to only one agent … and it could be multiple people on the
 *      channel."*
 *
 * ⚠ **AND ONE NEGATIVE CLAIM RUNS THROUGH ALL THREE: A PERSON IS UNCHANGED.**
 * Every case that narrows something for an AGENT author has its `authorKind:
 * "user"` twin here, because the rule is the DIFFERENCE between the two and a
 * suite that only drove the narrowed half would pass on a build that narrowed
 * both.
 *
 * ⚠ THE HANDLE DOOR'S OWN SUITE IS `service-wake-verdict-handles.test.ts`, and
 * PRECEDENCE is `service-wake-verdict.test.ts`. This file is the 2026-09-18 wave.
 */

const AGENT = "k3v7d2mq";
const AGENT2 = "m8q1zzzz";
const PEER = "user-2";

beforeEach(() => {
  vi.clearAllMocks();
  projection();
  roomProjection();
  recentAgentPosts();
  unaddressedResponder();
});

describe("an AGENT author's prose is not an address; a PERSON's still is", () => {
  it("answers `[]` for an agent author's body, never `null`", async () => {
    // 🔒 **`[]` IS THE LOAD-BEARING VALUE.** `null` means "you decide" and sends
    // the desktop back to its OWN body parse (`main/session-dispatch.js ›
    // mentionedAgentIds`), which would resolve the very handle this gate makes
    // inert — the defect re-introduced one layer down. `[]` is the authoritative
    // answer *this body names no agent*, and the machine executes it.
    projection(sessionRow({ name: AGENT }));
    const out = await resolve(`handing off to @agent-${AGENT}`, {}, { authorKind: "agent" });
    expect(out.recipientAgentIds).toEqual([]);
    expect(out.verdict).toBe("none");
    // ⚠ NOT `unreachable`: nothing was missed. An agent's prose names nobody by
    // construction, so there is no failed reach to report — the loud path for an
    // agent that MEANT to address somebody is the `to=` resolver's own 400.
    expect(out.delivery).toBe("none");
  });

  it("a PERSON's identical body still resolves the agent", async () => {
    roomProjection(sessionRow({ name: AGENT }));
    const out = await resolve(`@agent-${AGENT} take this`, {}, { authorKind: "user" });
    expect(out.recipientAgentIds).toEqual([AGENT]);
    expect(out.verdict).toBe("agent");
  });

  it("an agent that MEANS an agent says so in `to`, and that still wakes", async () => {
    // ⚠ THE CAPABILITY IS NOT REMOVED, IT IS MOVED TO THE FIELD THAT MEANS IT.
    // Samuel's same-account carve is intact: one of an operator's agents may
    // start another of the same operator's.
    projection(sessionRow({ name: AGENT }));
    const out = await resolve("please continue", {}, { authorKind: "agent", toAgentIds: [AGENT] });
    expect(out.recipientAgentIds).toEqual([AGENT]);
    expect(out.verdict).toBe("agent");
    expect(out.delivery).toBe("woken");
  });
});

describe("a RECORD is a post for nobody, and no arm repairs it", () => {
  it("resolves to nobody in the MAIN ROOM, where RR2 would have repaired it", async () => {
    // 🔒 **THE ARM THIS CLOSES IS THE ONE THAT CAUSED THE WAKE-ALL REPORT.** RR2
    // answered an unaddressed AGENT post with the operator's id, and the desktop
    // then fed every one of that operator's main-room sessions. A record must not
    // reach it — it LOOKS unaddressed and is not missing an address.
    projection(sessionRow({ name: AGENT }));
    const out = await resolve("filing the migration notes", {}, {
      authorKind: "agent",
      intent: "chat",
    });
    expect(out.verdict).toBe("none");
    expect(out.recipientUserIds).toEqual([]);
    expect(out.recipientAgentIds).toEqual([]);
    expect(out.delivery).toBe("none");
  });

  it("does not become `thread` merely because it carries a thread tag", async () => {
    // ⚠ `thread` reaches the sessions already working that thread and wakes
    // nothing — weaker than a wake and still not nobody. A record is nobody.
    const out = await resolve("filing this against the thread", { taskId: "t1" }, {
      authorKind: "agent",
      intent: "chat",
    });
    expect(out.verdict).toBe("none");
    expect(out.delivery).toBe("none");
  });

  it("THE ONE EXCEPTION: a PERSON's unaddressed post is still answered, all three arms", async () => {
    // 🔒 **SAMUEL, 2026-09-18, VERBATIM: *"Agents should only be woken up when addressed (besides
    // the logic for a user with no @ in their messsage)."*** That parenthesis is RR3, and it is
    // the ONLY repair left in the product. Driven on all three of its arms, because a build that
    // over-read the wave as "stop repairing addresses" would pass every other case in this file
    // and silence the one path a human depends on.
    // ARM: the room's ONE live agent.
    roomProjection(sessionRow({ name: AGENT }));
    const solo = await resolve("can someone look at the build?", {}, { authorKind: "user" });
    expect(solo).toMatchObject({ verdict: "responder", recipientAgentIds: [AGENT] });

    // ARM: several live, so the one THIS PERSON addressed most recently.
    roomProjection(sessionRow({ name: AGENT }), sessionRow({ id: "s-2", name: AGENT2 }));
    recentAgentPosts({ recipient_agent_ids: [AGENT2] });
    const recent = await resolve("and this one?", {}, { authorKind: "user" });
    expect(recent).toMatchObject({ verdict: "responder", recipientAgentIds: [AGENT2] });

    // ARM: the asking person's own `none` setting is honoured, and is not a failure.
    unaddressedResponder("none");
    const off = await resolve("thinking aloud", {}, { authorKind: "user" });
    expect(off.verdict).toBe("none");
  });

  it("AND ON THE WIRE SHAPE THE COMPOSER ACTUALLY SENDS — `intent:\"chat\"` from a PERSON", async () => {
    // 🔒 **SAMUEL, 2026-09-20: *"the auto-resolving to the most recent agent address is not
    // working … I see it say Decision Card Coder as the most recent but then when I send a
    // message, it is not properly sending to you."*** Every case above passed and the feature was
    // off for four days, because none of them drove the shape a human message really has:
    // `components/composer.tsx` stamps `intent:"chat"` on EVERY message a person types, and the
    // record term read that as *a post for nobody*. RR3 never ran; tagging still worked, because
    // a named agent is decided above the arms.
    // ⚠ THIS CASE IS THE WIRE SHAPE, NOT A VARIANT. The arms above take no `intent` at all, which
    // is a message no client sends.
    roomProjection(sessionRow({ name: AGENT }));
    const solo = await resolve("can someone look at the build?", {}, {
      authorKind: "user",
      intent: "chat",
    });
    expect(solo).toMatchObject({ verdict: "responder", recipientAgentIds: [AGENT] });

    // …and the stickiness arm, the one Samuel watched drop off.
    roomProjection(sessionRow({ name: AGENT }), sessionRow({ id: "s-2", name: AGENT2 }));
    recentAgentPosts({ recipient_agent_ids: [AGENT2] });
    const recent = await resolve("and this one?", {}, {
      authorKind: "user",
      intent: "chat",
    });
    expect(recent).toMatchObject({ verdict: "responder", recipientAgentIds: [AGENT2] });
  });

  it("an AGENT's record is UNCHANGED by that — the term still holds where it was ruled", async () => {
    // ⚠ THE OTHER HALF OF THE 2026-09-20 NARROWING. `intent:"chat"` from an AGENT is still the
    // post for nobody Samuel asked for; only the PERSON's composer stopped claiming it.
    projection(sessionRow({ name: AGENT }));
    const out = await resolve("filing the migration notes", {}, {
      authorKind: "agent",
      intent: "chat",
    });
    expect(out.verdict).toBe("none");
    expect(out.recipientAgentIds).toEqual([]);
    expect(out.delivery).toBe("none");
  });

  it("a PERSON's unaddressed post is still ANSWERED — the arms are not disabled", async () => {
    // 🔒 **THE NEGATIVE CLAIM.** Samuel's *"a forgotten `@` must never stall a
    // conversation"* is about PEOPLE, and RR3 is what keeps it true. A build that
    // read this wave as "stop repairing addresses" would pass every case above
    // and fail here.
    roomProjection(sessionRow({ name: AGENT }));
    const out = await resolve("can someone look at the build?", {}, { authorKind: "user" });
    expect(out.verdict).toBe("responder");
    expect(out.recipientAgentIds).toEqual([AGENT]);
  });
});

describe("`to` names several, across both namespaces", () => {
  it("stores every agent and every member, and takes the stronger word", async () => {
    // ⚠ **PRECEDENCE IS UNCHANGED BY THE LIST.** `agent` outranks `member`
    // because the verdict answers *what this message DID* and waking is the
    // loudest thing it can do — but the members named alongside are NOT dropped:
    // every machine routes on the COLUMNS and reads the word only to explain
    // itself, which is why a mixed send is one word over two full columns.
    const out = await resolve("both of you, please reconcile", {}, {
      authorKind: "agent",
      toAgentIds: [AGENT, AGENT2],
      toUserIds: [PEER],
    });
    expect(out.verdict).toBe("agent");
    expect(out.recipientAgentIds).toEqual([AGENT, AGENT2]);
    expect(out.recipientUserIds).toEqual([PEER]);
    expect(out.delivery).toBe("woken");
  });

  it("a members-only list is `member`, and carries ALL of them", async () => {
    // ⚠ `metadata.to_user_id` holds the FIRST named member — the consent card's
    // index — and `recipient_user_ids` holds the address. A build that stored
    // only the metadata key would notify one person out of three, silently.
    const out = await resolve("please both weigh in", {}, {
      authorKind: "agent",
      toUserIds: [PEER, "user-3"],
    });
    expect(out.verdict).toBe("member");
    expect(out.recipientUserIds).toEqual([PEER, "user-3"]);
    expect(out.delivery).toBe("delivered");
  });

  it("drops the AUTHOR'S OWN session out of its own recipient list", async () => {
    // 🔒 The self-address drop (2026-09-04) applies to the LIST, not just to a
    // lone `to` — otherwise the multi form is the way around it, and an agent
    // naming itself alongside a sibling wakes itself on its own words.
    const out = await resolve("both of you", { session_id: `c1:t1:${AGENT}` }, {
      authorKind: "agent",
      toAgentIds: [AGENT, AGENT2],
    });
    expect(out.recipientAgentIds).toEqual([AGENT2]);
  });
});
