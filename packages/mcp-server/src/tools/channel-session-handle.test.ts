/**
 * THE ADDRESSABLE HANDLE — what `op="status"` publishes, and the sentence that
 * has to travel with it (2026-08-31).
 *
 * ── WHAT BOUGHT THIS FILE ────────────────────────────────────────────────────
 * A live repro on 2026-08-31 (ENGINEERING). An external orchestrator called
 * `launch_agent`, was handed an agent id, and wrote `@<id>` into FIVE posts —
 * exactly what the op's own result told it to do. All five were inert. Not
 * refused, not warned about: the loop fence refused every agent-authored
 * message, and every post an agent makes is agent-authored. THREE things met
 * there, and this file pins the surface all three left behind:
 *
 *   1. THE HANDLE WAS NOT DISCOVERABLE. `op="status"` printed the row's `name`
 *      — which IS the agent id on any current desktop — but never said it was an
 *      address, and never named the `@agent-` form the rest of the product
 *      writes and tints.
 *   2. THE RULE FOR SPENDING IT WAS NOT PUBLISHED ANYWHERE. Both surfaces said
 *      what the token was and neither said who may write it.
 *   3. ⚠ AND THE FENCE ITSELF WAS REFUSING THE OPERATOR'S OWN INSTRUMENT.
 *      Samuel's SAME-ACCOUNT CARVE (2026-08-31) opened tier 1 to an
 *      agent-authored message posted under the operator's own user id, which is
 *      every MCP caller's posture. The handle is spendable now; what this file
 *      guards is that its THREE LIMITS travel with it.
 *
 * ⚠ THIS SUITE PINS COPY, WHICH IS UNUSUAL AND IS THE POINT. A tool result is
 * read by the same model at the moment it picks its next action (INVARIANTS
 * §10), so on this surface a missing sentence is a defect with the same blast
 * radius as a missing gate — and the only guard a sentence can have is a test
 * that fails when it is deleted.
 */

import { describe, expect, it } from "vitest";
import { addressableHandle } from "./channel-session-handle";
import { formatSessionLine } from "./channel-session-render";
// ⚠ THE PAGE RENDERER MOVED with the table it renders (T13) — see
// `channel-session-table.ts`'s header for why the dependency runs one way.
import { sessionBlockLines } from "./channel-session-table";
// THE HANDLE RULE'S NEW HOME. It is shipped prose, pulled on demand, and these
// pins are what keep every clause of it in the product.
// ⚠ `CHANNEL_OWN_AGENTS` IS GONE (B8, 2026-09-02): the own-agent narrative was
// 4,873 of the 23,554 characters the five-op collapse cut out of the doctrine,
// and what replaced it is the LAW's two own-agent bullets plus the `manage`
// section. `DOCTRINE_SECTIONS.manage` is the section-scoped subject those pins
// now take.
import { CHANNEL_DOCTRINE, DOCTRINE_SECTIONS } from "./channel-doctrine";
// ⚠ THE DENIAL MOVED TO THE SCHEMA, which is the other half of the fence pin
// below — see that case for why the subject changed rather than the claim.
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";
import type { ChannelSessionStateOwn } from "@dopl/client";

const NOW = Date.parse("2026-08-31T05:00:00.000Z");

const ownRow = (over: Partial<ChannelSessionStateOwn> = {}): ChannelSessionStateOwn => ({
  channelId: "bb0f57db-bb46-4ce6-af96-83eb8e2dbf28",
  threadId: null,
  name: "x2sz1ztt",
  state: "idle",
  detail: null,
  channelName: "Dopl",
  threadTitle: null,
  updatedAt: new Date(NOW - 5_000).toISOString(),
  model: null,
  toolLabel: null,
  contextUsed: null,
  contextWindow: null,
  tokensSpent: null,
  startedAt: null,
  lastActivityAt: null,
  templateName: null,
  ...over,
});

describe("addressableHandle — one form, and a fail-closed recogniser", () => {
  it("answers the PREFIXED form for an agent id", () => {
    // ⚠ `@agent-<id>`, never the bare `@<id>`. The desktop parser takes both
    // (`session-dispatch.js › mentionedAgentIds`, F-350's regex), so this is not
    // a correctness question — it is a CONVENTION one: the app's picker inserts
    // the prefixed form and the transcript tints it, and a surface publishing
    // the other form is the tint-says-tagged / stamp-says-nobody split F-266
    // cost a wave to close, one namespace over.
    expect(addressableHandle("x2sz1ztt")).toBe("@agent-x2sz1ztt");
  });

  it("answers NULL for a legacy pool handle rather than inventing an address", () => {
    // ⚠ `channel_sessions.name`'s own CHECK is the WIDER `^[a-z][a-z0-9-]{1,30}$`
    // — it predates the multiplayer wave, when the field held handles like
    // `flint` — and an older desktop is a supported peer (INVARIANTS §13). A row
    // from one must print NOTHING, not an `@agent-flint` that reaches nobody.
    expect(addressableHandle("flint")).toBeNull();
    expect(addressableHandle("onyx")).toBeNull();
  });

  it("refuses everything that is not exactly the id charset", () => {
    // Anchored, exact length, no dashes: the same pattern
    // `dopl-desktop-app/main/agent-id.js` and `schema-launch.ts ›
    // LaunchDecideSchema.agentId` carry. A near-miss is a legacy name, not an id.
    for (const bad of [
      "",
      "x2sz1zt", // 7
      "x2sz1ztt9", // 9
      "2xsz1ztt", // does not start with a letter
      "x2sz-ztt", // a dash is legal in a NAME and never in an id
      "X2SZ1ZTT",
      "x2sz1ztt ",
    ]) {
      expect(addressableHandle(bad), `"${bad}" must not read as an id`).toBeNull();
    }
  });
});

describe("the session LINE carries the handle, and only for an own row", () => {
  it("prints it in the HEAD, beside the name", () => {
    // ⚠ In the head rather than the telemetry tail: everything after the em dash
    // is STATE, and an address buried in the tail is the clause a skimming model
    // drops first.
    const line = formatSessionLine(ownRow(), { handle: true, now: NOW });
    expect(line).toContain("**`x2sz1ztt`** (`@agent-x2sz1ztt`)");
  });

  it("prints NOTHING extra without the flag — the audience decides, not verbosity", () => {
    // ⚠ An agent id is a WAKE TOKEN on the operator's machine (tier 1 is "at any
    // roster size", and a peer HUMAN who knows the id can wake my agent with
    // it), so which handles a result publishes is an AUDIENCE decision. It is
    // deliberately NOT keyed on the telemetry flag: a future compact own-row
    // page would otherwise withdraw the handle silently.
    const line = formatSessionLine(ownRow(), { now: NOW });
    expect(line).toContain("**`x2sz1ztt`**");
    expect(line).not.toContain("@agent-");
  });

  it("prints nothing extra for a legacy name even WITH the flag", () => {
    const line = formatSessionLine(ownRow({ name: "flint" }), {
      handle: true,
      now: NOW,
    });
    expect(line).toContain("**`flint`**");
    expect(line).not.toContain("@agent-");
  });
});

/**
 * ⚠ THE SUBJECT MOVED; THE ASSERTIONS DID NOT (T10, 2026-09-02).
 *
 * These pins were written against `SESSION_HANDLE_NOTE`, a ~1.1k-char paragraph
 * rendered under EVERY session page — on an op an orchestrator polls in a loop.
 * The constant is DELETED and its text is in `channel-doctrine.ts`, pulled
 * through `dopl_channel(op="rooms", action="help")` or the
 * `dopl://doctrine/channels` resource.
 *
 * ⚠ **AND IT WAS RE-SPELLED AGAIN BY B8 (2026-09-02), SO THESE PINS FOLLOWED THE
 * RULES RATHER THAN THE WORDS.** The five-op collapse compressed the own-agent
 * narrative from a section into two LAW bullets and the `manage` section, so the
 * assertions below name the sentence that now CARRIES each clause. Every clause
 * the repro proved was missing is still pinned, and each is still checked in
 * BOTH directions — in the product, and not re-transmitted per call.
 */
describe("the handle rule survived the move to the doctrine, clause for clause", () => {
  it("names the form, and says a CUSTOM NAME is machine-local", () => {
    // A rename lives in `main/agent-names.js`, on ONE machine, keyed by an id
    // minted there. No server holds it, so it is not addressable from here —
    // and a caller who saw a friendly name in the Dopl app must not assume it is.
    // ⚠ RE-POINTED (B8): the form and its exclusivity are now one LAW bullet —
    // the prefixed form is the only address it names, and "ONLY BY NAME" /
    // "never without naming one" is the exclusivity clause.
    expect(CHANNEL_DOCTRINE).toContain(
      'to="@agent-<id>" or `@agent-<id>` in a body wakes THAT agent',
    );
    expect(CHANNEL_DOCTRINE).toContain("AND ONLY BY NAME");
    expect(CHANNEL_DOCTRINE).toContain("never without naming one");
    expect(CHANNEL_DOCTRINE).toContain("reaches no server");
    // ⚠ PEER-INVISIBILITY WAS RESTORED ON 2026-09-02 after this tier found it had
    // stopped appearing in ANY shipped prose. It is the half a caller cannot
    // infer: a name they can see, nobody else can.
    expect(CHANNEL_DOCTRINE).toContain("is invisible to every other member");
  });

  it("⚠ SAYS THE HANDLE WAKES, AND NAMES IT AS A WAKE RATHER THAN A TAG", () => {
    // Samuel's same-account carve made this sentence TRUE (2026-08-31): the MCP
    // caller posts under its operator's account, which is what licenses the wake.
    // Before it, the id `launch_agent` handed out could not be spent by the only
    // caller that had it — five posts, nothing woken, nothing said.
    expect(CHANNEL_DOCTRINE).toContain("wakes THAT agent");
    // ⚠ RE-POINTED (B8). "never by the server's mention resolver" survives only
    // as a CODE comment in `channel-facts.ts` — it ships nowhere. What still
    // ships is the claim it existed to make, that a wake is not a tag, and the
    // LAW states it directly.
    expect(CHANNEL_DOCTRINE).toContain(
      "Tagging is not addressing and starts no agent",
    );
  });

  it("puts the GOAL first — waking is for redirecting, not for starting", () => {
    // ⚠ An orchestrator that reaches for the wake when it should have sent a
    // goal has spent two calls and a turn on one instruction.
    // ⚠ RE-POINTED (B8): the ordering is carried by the two sentences that
    // survived — the launch takes the goal as its FIRST INSTRUCTION, and the
    // wake is what happens THEREAFTER, to an agent that already exists.
    expect(CHANNEL_DOCTRINE).toContain(
      "its `body` is the FIRST INSTRUCTION it runs",
    );
    expect(CHANNEL_DOCTRINE).toContain(
      'op="manage" action="launch" starts one, and thereafter',
    );
  });

  it("⚠ CARRIES ALL THREE LIMITS — an exception without its boundary is a hole", () => {
    // (1) ADDRESSED ONLY. Tiers 2 and 3 wake on traffic nobody addressed and stay
    // shut to every agent-authored message; dropping this clause invites exactly
    // the unaddressed post the loop brake exists to refuse.
    expect(CHANNEL_DOCTRINE).toContain(
      "an AGENT-authored UNADDRESSED message starts nobody",
    );
    // (2) OWN OPERATOR ONLY — the 2026-08-28 fence, which the carve did not move.
    expect(CHANNEL_DOCTRINE).toContain(
      "YOUR OWN OPERATOR'S AGENTS, AND ONLY THEIR MACHINE",
    );
    expect(CHANNEL_DOCTRINE).toContain("Never another member's agent");
    // (3) NOT OBSERVABLE. The wake is decided on a desktop no server can see, so
    // the copy may not promise delivery it cannot witness.
    // ⚠ RE-POINTED (B8). The paragraph saying the wake cannot be watched from
    // here was cut; what carries the same instruction now is that the RECEIPT is
    // the only ack there is — read `delivery=`, never assume.
    expect(CHANNEL_DOCTRINE).toContain("`delivery=` IS THE ACK AND THE ONLY ONE");
    expect(CHANNEL_DOCTRINE).toContain(
      "`idle` resolved but nothing running, filed until that machine reconciles",
    );
    // ⚠ THE "THREE LIMITS" HEADING IS GONE with the section it headed, so the
    // pin moved to the property it was protecting: the capability and its
    // boundary are stated in ONE breath, so a reader cannot take the first
    // without the second.
    expect(DOCTRINE_SECTIONS.law).toContain(
      "YOUR OWN AGENTS ARE THE ONE EXCEPTION, AND ONLY BY NAME.",
    );
  });

  it("never suggests a way AROUND the fence", () => {
    // ⚠ The loop brake is deliberate (INVARIANTS §11). This copy describes it;
    // it must never read as an obstacle with a workaround, because the workaround
    // an agent would invent is the loop the fence exists to stop.
    // ⚠ SCOPED TO THE SECTION THAT REPLACED THE NOTE, not to the whole doctrine.
    // The REFUSALS section says "not something to work around" about the
    // operator's launch toggle — the OPPOSITE claim, and a whole-text match
    // would read it as an offender and pressure someone into deleting a fence.
    //
    // ⚠ **THE DENIAL MOVED TO THE SCHEMA AND THE SECTION MOVED WITH IT** (B8,
    // 2026-09-02). `bypass` used to be excused EXACTLY ONCE in this section,
    // because the one sentence writing it was the sentence denying that asking
    // for it grants it. That sentence is no longer prose: `bypass` is a value of
    // `posture.tools`, and the denial is `posture`'s own `.describe()` — so the
    // section needs no exemption at all, and the scan runs over the whole of it.
    // Both halves are still pinned, so deleting either still fails here.
    const posture = CHANNEL_INPUT_SHAPE.posture.description ?? "";
    expect(posture).toContain(
      "narrows whatever you ask for to their own ceiling and never widens past it",
    );
    expect(DOCTRINE_SECTIONS.manage).not.toMatch(
      /work ?around|bypass|instead you can post/i,
    );
  });

  it("⚠ IS NO LONGER RE-TRANSMITTED PER CALL — the other half of the move", () => {
    // A rule that moved out of a result and did NOT arrive in the doctrine has
    // left the product; a rule in BOTH is the repetition this tier removed. The
    // test above proves arrival, this one proves departure.
    // ⚠ THE NEGATIVE PINS FOLLOWED THE WORDS TOO (B8) — pinned on the phrases
    // the doctrine actually ships now, or the departure guard would be trivially
    // true against copy nothing writes any more.
    const page = sessionBlockLines([ownRow({})], NOW).join("\n");
    expect(page).not.toContain("AND ONLY BY NAME");
    expect(page).not.toContain("wakes THAT agent");
    expect(page).not.toContain("reaches no server");
  });
});

