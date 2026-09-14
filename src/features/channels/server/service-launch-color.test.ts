/**
 * **THE LAUNCH LANE'S COLOUR GATE** — `service-launch-color.ts › resolveDirectiveColor`
 * (2026-09-14; docs/specs/agent-colors.md item 3).
 *
 * ⚠ **FIVE LAUNCH SUITES ALREADY NAMED THIS FILE AND IT DID NOT EXIST.** Each one stubs
 * `repository-session-colors` with a comment reading *"the colour cases are in
 * `service-launch-color.test.ts`"* — so the create's SIXTH gate ran in every one of them and
 * was asserted in none. The gap that bought this suite is exactly the kind that hides there:
 *
 * 🔒 **A PENDING DIRECTIVE HELD NO KEY.** The taken set was live `channel_sessions` colours
 * alone, and a `channel_sessions` row appears only once the operator's machine has CLAIMED the
 * directive and SPAWNED — seconds later. So an operator launching two agents back to back was
 * told `agent-01` was free both times: the second launch recorded a key the first already owned,
 * no 409 was raised, and the PUSH lane silently substituted — on the one lane whose entire
 * contract is that it refuses instead (`server/errors.ts › AgentColorTakenError`). Both reads
 * are unioned now.
 *
 * ⚠ **THE READS ARE STUBBED AND THE POLICY IS REAL** — the same split every launch suite makes.
 * What is under test is the union, the expiry cut, first-free and the refusal.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository-session-colors", () => ({
  foreignLiveColorsByChannel: vi.fn(async () => new Map()),
  pendingDirectiveColors: vi.fn(async () => []),
}));

import {
  foreignLiveColorsByChannel,
  pendingDirectiveColors,
} from "./repository-session-colors";
import { resolveDirectiveColor } from "./service-launch-color";
import { AgentColorTakenError } from "./errors";
import { AGENT_COLOR_KEYS } from "../lib/agent-colors";
import type { ChannelContext } from "./service-shared";

const WS = "22222222-2222-2222-2222-222222222222";
const ME = "33333333-3333-3333-3333-333333333333";
const CHAN = "11111111-1111-1111-1111-111111111111";

/** ⚠ READ OFF THE BANK, NEVER TYPED — `AGENT_COLOR_KEYS`'s ORDER *is* the first-free policy, so
 *  a literal "agent-02" would be this suite deciding what "the next one" means. */
const [FIRST, SECOND, THIRD] = AGENT_COLOR_KEYS;

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: ME,
  credentialSubjectUserId: ME,
  source: "agent",
  role: "member",
};

const NOW = 1_800_000_000_000;
/** A directive still awaiting a decision — the shape the repository projects. */
function directive(color: string, msFromNow = 120_000) {
  return { color, expires_at: new Date(NOW + msFromNow).toISOString() };
}

function liveColors(...keys: string[]) {
  vi.mocked(foreignLiveColorsByChannel).mockResolvedValue(
    new Map([[CHAN, new Set(keys)]])
  );
}
function pending(...rows: ReturnType<typeof directive>[]) {
  vi.mocked(pendingDirectiveColors).mockResolvedValue(rows);
}

beforeEach(() => {
  vi.mocked(foreignLiveColorsByChannel).mockReset().mockResolvedValue(new Map());
  vi.mocked(pendingDirectiveColors).mockReset().mockResolvedValue([]);
});

describe("the taken set is live sessions UNION spoken-for launches", () => {
  it("hands the first key out when the room is empty", async () => {
    expect(await resolveDirectiveColor(ctx, CHAN, undefined, NOW)).toBe(FIRST);
  });

  it("skips a key a LIVE session wears", async () => {
    liveColors(FIRST);
    expect(await resolveDirectiveColor(ctx, CHAN, undefined, NOW)).toBe(SECOND);
  });

  /**
   * 🔒 **TWO LAUNCHES SECONDS APART — the case this suite was written for.** The first launch
   * has filed `agent-01` and its machine has not spawned yet, so `channel_sessions` is still
   * empty; the second must NOT be handed the same key.
   *
   * 🔒 MUTATION-PROOF: drop `pendingDirectiveColors` from the union in `resolveDirectiveColor`
   * and this answers `FIRST` — a second agent recorded in the colour its sibling owns.
   */
  it("skips a key a PENDING directive has already spoken for", async () => {
    pending(directive(FIRST));
    expect(await resolveDirectiveColor(ctx, CHAN, undefined, NOW)).toBe(SECOND);
  });

  it("skips BOTH halves at once", async () => {
    liveColors(SECOND);
    pending(directive(FIRST));
    expect(await resolveDirectiveColor(ctx, CHAN, undefined, NOW)).toBe(THIRD);
  });

  /**
   * ⚠ **EXPIRY IS THE SERVICE'S AND IS LAZY** (`repository-session-colors.ts ›
   * pendingDirectiveColors` states why the SQL does not filter it): a launch nobody claimed
   * before its TTL ran out has released its key. Without the cut, one abandoned launch would
   * narrow the bank for the whole TTL.
   *
   * 🔒 MUTATION-PROOF: delete the `at <= now` `continue` and this answers `SECOND`.
   */
  it("returns an EXPIRED directive's key to the bank", async () => {
    pending(directive(FIRST, -1));
    expect(await resolveDirectiveColor(ctx, CHAN, undefined, NOW)).toBe(FIRST);
  });

  /** ⚠ AN UNPARSEABLE STAMP COUNTS AS LIVE — the direction a stamp read must fail in here:
   *  offering a key that comes back 409 is cheap, two agents in one colour is not. */
  it("treats an unreadable expiry as still spoken for", async () => {
    pending({ color: FIRST, expires_at: "not a date" });
    expect(await resolveDirectiveColor(ctx, CHAN, undefined, NOW)).toBe(SECOND);
  });

  /** ⚠ A DIRECTIVE THAT NAMED A KEY THIS BUILD DOES NOT KNOW TAKES NOTHING OUT OF THE BANK —
   *  `lib/agent-colors.ts › agentColorOrNull` is the one membership test, and it is applied
   *  here rather than trusted, because the column is TEXT. */
  it("ignores a key outside the sixteen", async () => {
    pending(directive("agent-99"));
    expect(await resolveDirectiveColor(ctx, CHAN, undefined, NOW)).toBe(FIRST);
  });

  /** ⚠ `null` WHEN THE BANK IS EMPTY, AND A LAUNCH IS NEVER REFUSED FOR IT — the seventeenth
   *  agent in a room runs UNCOLOURED (`lib/agent-colors.ts › firstFreeAgentColor`). */
  it("answers null rather than refusing when all sixteen are out", async () => {
    liveColors(...AGENT_COLOR_KEYS);
    expect(await resolveDirectiveColor(ctx, CHAN, undefined, NOW)).toBeNull();
  });
});

describe("a NAMED key that is taken is refused, never substituted", () => {
  it("grants a named key nothing holds", async () => {
    liveColors(SECOND);
    expect(await resolveDirectiveColor(ctx, CHAN, THIRD, NOW)).toBe(THIRD);
  });

  it("refuses a key a live session wears, with what is left", async () => {
    liveColors(FIRST);
    await expect(resolveDirectiveColor(ctx, CHAN, FIRST, NOW)).rejects.toThrow(
      AgentColorTakenError
    );
  });

  /**
   * 🔒 **THE SAME 409 FOR A PENDING KEY** — the operator picked `agent-01` in the popup
   * seconds after their own first launch filed it, and the honest answer is "not that one,
   * here is what is left" rather than a silent substitution two pushes later.
   */
  it("refuses a key a pending directive holds, and the free set excludes it", async () => {
    pending(directive(FIRST));
    const err = await resolveDirectiveColor(ctx, CHAN, FIRST, NOW).catch((e) => e);
    expect(err).toBeInstanceOf(AgentColorTakenError);
    expect((err as AgentColorTakenError).color).toBe(FIRST);
    // ⚠ THE FREE SET IS THE CALLER'S NEXT PICK, so it must not offer the key just refused.
    expect((err as AgentColorTakenError).free).not.toContain(FIRST);
    expect((err as AgentColorTakenError).free[0]).toBe(SECOND);
  });

  /** ⚠ THE READ IS CHANNEL-SCOPED AND MEMBER-BLIND: uniqueness is cross-member by ruling, so
   *  the gate passes `null` for the caller exclusion the PUSH lane needs. */
  it("counts every member, including the caller", async () => {
    await resolveDirectiveColor(ctx, CHAN, undefined, NOW);
    expect(foreignLiveColorsByChannel).toHaveBeenCalledWith(WS, [CHAN], null);
    expect(pendingDirectiveColors).toHaveBeenCalledWith(WS, CHAN);
  });
});
