/**
 * THE ADDRESSABLE HANDLE — what `read_sessions` publishes, and the sentence that
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
 *   1. THE HANDLE WAS NOT DISCOVERABLE. `read_sessions` printed the row's `name`
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
// pins are what keep it word-for-word what it was in the deleted constant.
import { CHANNEL_DOCTRINE, CHANNEL_OWN_AGENTS } from "./channel-doctrine";
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
 * rendered under EVERY `read_sessions` page — on an op an orchestrator polls in
 * a loop. The constant is DELETED and its text is in `channel-doctrine.ts`,
 * pulled through `dopl_channel(op="help")` or the `dopl://doctrine/channels`
 * resource. **Not one sentence was softened on the way**, which is what these
 * assertions are here to keep true: each still names a thing the live repro
 * proved was missing, and each is checked in BOTH directions — still in the
 * product, and no longer re-transmitted per call.
 */
describe("the handle rule survived the move to the doctrine, word for word", () => {
  it("names the form, and says a CUSTOM NAME is machine-local", () => {
    // A rename lives in `main/agent-names.js`, on ONE machine, keyed by an id
    // minted there. No server holds it, so it is not addressable from here —
    // and a caller who saw a friendly name in the Dopl app must not assume it is.
    expect(CHANNEL_DOCTRINE).toContain("`@agent-<id>` form is the only one");
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
    expect(CHANNEL_DOCTRINE).toContain("WAKES THAT AGENT");
    expect(CHANNEL_DOCTRINE).toContain("never by the server's mention resolver");
  });

  it("puts the GOAL first — waking is for redirecting, not for starting", () => {
    // ⚠ An orchestrator that reaches for the wake when it should have sent a
    // goal has spent two calls and a turn on one instruction.
    expect(CHANNEL_DOCTRINE).toContain("ALREADY WORKING on it");
    expect(CHANNEL_DOCTRINE).toContain("waking is for agents you need to REDIRECT");
  });

  it("⚠ CARRIES ALL THREE LIMITS — an exception without its boundary is a hole", () => {
    // (1) ADDRESSED ONLY. Tiers 2 and 3 wake on traffic nobody addressed and stay
    // shut to every agent-authored message; dropping this clause invites exactly
    // the unaddressed post the loop brake exists to refuse.
    expect(CHANNEL_DOCTRINE).toContain("an unaddressed post of yours starts nobody");
    // (2) OWN OPERATOR ONLY — the 2026-08-28 fence, which the carve did not move.
    expect(CHANNEL_DOCTRINE).toContain("only for YOUR OWN operator's agents");
    // (3) NOT OBSERVABLE. The wake is decided on a desktop no server can see, so
    // the copy may not promise delivery it cannot witness.
    expect(CHANNEL_DOCTRINE).toContain("delivery is not observable from here");
    expect(CHANNEL_DOCTRINE).toContain("rather than assuming it woke");
    // ⚠ AND THE THREE ARE LABELLED AS LIMITS, not merely present as sentences. A
    // reader who takes the capability without the boundary is the failure mode.
    expect(CHANNEL_DOCTRINE).toContain("THREE LIMITS");
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
    // ⚠ `bypass` IS NOW A RESERVED WORD IN THIS SECTION AND IS NOT AN OFFENDER
    // (2026-09-02, when `set_agent_mode`'s paragraph joined it). It is the NAME
    // of a `LaunchToolMode` a caller may ASK for, and the only sentence that
    // writes it is the one DENYING that asking for it grants it — the strongest
    // possible statement of the fence, not a route around it. So the word is
    // excused EXACTLY ONCE, by removing that clause and re-running the scan over
    // what is left: any OTHER use of it, and every "work around", still fails.
    const DENIAL = 'asking for "bypass" does not give you bypass';
    // ⚠ Asserted, not assumed. Without this the strip could silently become a
    // no-op the day the denial is deleted, and the case would pass over copy
    // that no longer denies anything.
    expect(CHANNEL_OWN_AGENTS).toContain(DENIAL);
    expect(CHANNEL_OWN_AGENTS.replace(DENIAL, "")).not.toMatch(
      /work ?around|bypass|instead you can post/i,
    );
  });

  it("⚠ IS NO LONGER RE-TRANSMITTED PER CALL — the other half of the move", () => {
    // A rule that moved out of a result and did NOT arrive in the doctrine has
    // left the product; a rule in BOTH is the repetition this tier removed. The
    // test above proves arrival, this one proves departure.
    const page = sessionBlockLines([ownRow({})], NOW).join("\n");
    expect(page).not.toContain("THREE LIMITS");
    expect(page).not.toContain("WAKES THAT AGENT");
    expect(page).not.toContain("reaches no server");
  });
});

