/**
 * 🔒 **A TRUNCATED TAKEN SET HANDS OUT A COLOUR SOMEBODY ALREADY HOLDS (Samuel
 * #2935, the review).**
 *
 * The sweep paged both colour walks and moved the ceiling 1,000 → 2,000. ⚠ **IT
 * DID NOT CLOSE THE FAILURE `COLOR_ROWS_LIMIT`'s OWN DOCBLOCK NAMES**: at the hard
 * cap the walk still stops, and the constant says what that costs — *"a truncated
 * taken set hands out a colour somebody already holds … a 23505 on the push that
 * follows, or two members wearing one key."* Both walks computed `truncated` and
 * **DISCARDED** it, so the one consumer able to act on it could not see it.
 *
 * ⚠ **THE FIXTURE IS BUILT SO A KEY *LOOKS FREE*, WHICH IS THE WHOLE BUG.** 2,100
 * live sessions where the first 2,050 (by the walk's own `id` order) hold
 * `agent-01` and the last 50 hold `agent-02`. The walk stops at 2,000, sees only
 * `agent-01`, and `agent-02` therefore reads as FREE — so the push lane grants it
 * to a new session and the partial unique index
 * `channel_sessions_channel_color_live_key` answers 23505 on the write that
 * follows. ⚠ A fixture that merely cycled all sixteen keys would NOT show this: it
 * saturates inside the first page, so the clipped and complete answers agree.
 *
 * ⚠ **THE REFUSAL IS SCOPED TO A *NEW* ASSIGNMENT.** Rule 1 reads the caller's OWN
 * stored rows, which no clip can hide, and a colour that moves under a running
 * agent is the churn `session-colors.ts` rule 1 exists to prevent — so an
 * incumbent survives a truncated read and only an unvouchable pick is refused.
 * ⚠ **AND IT NULLS RATHER THAN THROWING**, on `withoutClaimedColors`' own
 * argument: throwing 500s the push route and discards every live session for that
 * machine over a decoration.
 *
 * ⚠ **THE LAUNCH LANE IS NOT CLOSED HERE.** `pendingDirectiveColors` now REPORTS
 * its clip and its only consumer is `service-launch-color.ts`, which resolves that
 * pick — outside this change's files. The marker is asserted; the refusal there is
 * follow-up work.
 *
 * MUTATION-VERIFY (each reverted alone turns the named case red):
 *  - discard `truncated` from either walk → its "reports the floor" case fails.
 *  - drop the refusal from `resolveColorsForPush` → "REFUSES the pick" fails (it
 *    hands out `agent-02`, the collision).
 *  - widen the refusal to every row → "keeps an incumbent" fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  fakePostgrest,
  type FakePostgrest,
  type Row,
} from "@/shared/testing/postgrest-cap";
import type { AgentColorKey } from "@dopl/contracts";
import { __resetColorSharedCompatForTests } from "./color-shared-compat";
import type { SessionStateUpsert } from "./collab-dto";
import {
  foreignLiveColorsByChannel,
  pendingDirectiveColors,
  resolveColorsForPush,
} from "./repository-session-colors";

const WS = "11111111-2222-4333-8444-555555555555";
const CH = "22222222-3333-4444-8555-666666666666";
const ME = "99999999-8888-4777-8666-555555555555";
const PEER = "88888888-7777-4666-8555-444444444444";

/** The declared hard cap for both walks. */
const COLOR_CAP = 2_000;

/**
 * 🔒 **THE SHAPE THAT MAKES A KEY LOOK FREE.** `HELD` rows all wear `agent-01`
 * and sort FIRST; the `HIDDEN` rows wear `agent-02` and sort entirely past the
 * cap, so the walk never sees them and nothing in the answer says so.
 */
const HELD = 2_050;
const HIDDEN = 50;
const VISIBLE_KEY: AgentColorKey = "agent-01";
const HIDDEN_KEY: AgentColorKey = "agent-02";

const pad = (n: number) => String(n).padStart(7, "0");

function sessions(n: number, color: string, from = 0, user = PEER): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    // ⚠ `channel_sessions.id` is the PRIMARY KEY and the walk's total order.
    id: `s-${pad(from + i)}`,
    channel_id: CH,
    workspace_id: WS,
    user_id: user,
    color,
    state: "working",
    color_shared: false,
  }));
}

/** The oversized channel: `agent-01` first and past the cap, `agent-02` hidden
 *  behind it. ⚠ Both keys are really held, and only one is visible. */
function clippedChannel(): Row[] {
  return [
    ...sessions(HELD, VISIBLE_KEY, 0),
    ...sessions(HIDDEN, HIDDEN_KEY, HELD),
  ];
}

function directives(n: number, from = 0): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `d-${pad(from + i)}`,
    channel_id: CH,
    workspace_id: WS,
    status: "pending",
    color: VISIBLE_KEY,
    expires_at: "2026-10-10T12:00:00.000Z",
  }));
}

function mount(table: string, rows: Row[]): FakePostgrest {
  const fake = fakePostgrest({ [table]: rows });
  vi.mocked(supabaseAdmin).mockReturnValue(fake.client as never);
  return fake;
}

/** One reported session, every `SessionStateUpsert` field spelled so the shape is
 *  the real one rather than a cast. */
function reported(
  sessionKey: string,
  color: AgentColorKey | null
): SessionStateUpsert {
  return {
    session_key: sessionKey,
    channel_id: CH,
    thread_id: null,
    name: "Agent",
    state: "working",
    channel_name: null,
    thread_title: null,
    detail: null,
    tool_label: null,
    model: null,
    context_used: null,
    context_window: null,
    tokens_spent: null,
    started_at: null,
    last_activity_at: null,
    turns: null,
    tokens_delta: null,
    stale: null,
    denied_calls: null,
    last_denied_tool: null,
    last_wake_seq: null,
    last_wake_at: null,
    display_name: null,
    identity_name: null,
    color,
    color_shared: false,
  };
}

const NO_INCUMBENT = new Map<string, SessionStateUpsert>();

beforeEach(() => {
  vi.clearAllMocks();
  // ⚠ `selectTolerant` remembers a missing column at MODULE scope.
  __resetColorSharedCompatForTests();
});

describe("the taken set reports whether it is the WHOLE taken set", () => {
  it("reports the floor at the hard cap", async () => {
    mount("channel_sessions", clippedChannel());

    const taken = await foreignLiveColorsByChannel(WS, [CH], null);

    expect(taken.truncated).toBe(true);
    // 🔒 THE SYMPTOM: `agent-02` is really held and the answer calls it free.
    expect(taken.get(CH)?.holders.has(VISIBLE_KEY)).toBe(true);
    expect(taken.get(CH)?.holders.has(HIDDEN_KEY)).toBe(false);
  });

  it("reports an exhausted walk as COMPLETE", async () => {
    mount("channel_sessions", sessions(1_500, VISIBLE_KEY));

    const taken = await foreignLiveColorsByChannel(WS, [CH], null);

    expect(taken.truncated).toBe(false);
  });

  /** ⚠ Both short-circuits are COMPLETE answers, not merely empty ones — a
   *  machine reporting that it runs nothing, and a database without the table. */
  it("no channels, and a missing relation, are both complete", async () => {
    mount("channel_sessions", clippedChannel());
    expect((await foreignLiveColorsByChannel(WS, [], null)).truncated).toBe(false);

    const client: Record<string, unknown> = {};
    Object.assign(client, {
      from: () => client,
      select: () => client,
      eq: () => client,
      in: () => client,
      not: () => client,
      neq: () => client,
      order: () => client,
      range: () => client,
      then: (resolve: (r: unknown) => void) =>
        resolve({ data: null, error: { code: "PGRST205", message: "no relation" } }),
    });
    vi.mocked(supabaseAdmin).mockReturnValue(client as never);
    const degraded = await foreignLiveColorsByChannel(WS, [CH], null);
    expect(degraded.size).toBe(0);
    expect(degraded.truncated).toBe(false);
  });

  /** ⚠ The marker is NON-ENUMERABLE, so every existing consumer sees the Map it
   *  always saw — `service-launch-color.ts` reads `.get()` and nothing else. */
  it("the marker is invisible to enumeration and to JSON", async () => {
    mount("channel_sessions", clippedChannel());

    const taken = await foreignLiveColorsByChannel(WS, [CH], null);

    expect(Object.keys(taken)).toEqual([]);
    expect(JSON.stringify(taken)).toBe("{}");
  });

  it("the spoken-for directive set reports its floor too", async () => {
    mount("channel_launch_directives", directives(2_400));
    const capped = await pendingDirectiveColors(WS, CH);
    expect(capped).toHaveLength(COLOR_CAP);
    expect(capped.truncated).toBe(true);

    mount("channel_launch_directives", directives(1_500));
    const exhausted = await pendingDirectiveColors(WS, CH);
    expect(exhausted).toHaveLength(1_500);
    expect(exhausted.truncated).toBe(false);
    // ⚠ Still an ARRAY to every existing consumer, deep-compare included.
    expect(Object.keys(await pendingDirectiveColors(WS, CH)).length).toBe(1_500);
  });
});

describe("the push lane REFUSES the pick rather than colliding", () => {
  /**
   * 🔒 **THE COLLISION, EXECUTABLE.** Against the clipped set `agent-02` reads as
   * free, so the resolver grants it — and a live session in this very channel is
   * already wearing it, which is the 23505 the push lane exists to never hit. The
   * refusal answers `null` instead: honest, and re-resolved by the next push
   * seconds later.
   */
  it("REFUSES the pick when the taken set is a floor — null, not a held key", async () => {
    mount("channel_sessions", clippedChannel());

    const out = await resolveColorsForPush(
      ME,
      WS,
      [reported("run-1", HIDDEN_KEY)],
      NO_INCUMBENT
    );

    expect(out).toHaveLength(1);
    expect(out[0].color).toBeNull();
    expect(out[0].color_shared).toBe(false);
  });

  it("refuses a pick it was not asked for by name, too", async () => {
    mount("channel_sessions", clippedChannel());

    const out = await resolveColorsForPush(
      ME,
      WS,
      [reported("run-1", null)],
      NO_INCUMBENT
    );

    expect(out[0].color).toBeNull();
  });

  /** 🔒 **AN INCUMBENT SURVIVES A TRUNCATED READ.** Rule 1 reads the caller's own
   *  stored rows, which no clip can hide — and a colour that moves under a running
   *  agent re-renders every earlier post in the transcript in somebody else's
   *  colour, which is worse than no colour. */
  it("keeps an incumbent colour, and only refuses the NEW row beside it", async () => {
    mount("channel_sessions", clippedChannel());
    const incumbent = reported("run-held", "agent-07");

    const out = await resolveColorsForPush(
      ME,
      WS,
      [incumbent, reported("run-new", HIDDEN_KEY)],
      new Map([["run-held", incumbent]])
    );

    expect(out[0].color).toBe("agent-07");
    expect(out[1].color).toBeNull();
  });

  /** ⚠ **AND IT GRANTS NORMALLY WHEN THE SET IS WHOLE**, which is what keeps the
   *  refusal a degrade rather than a feature regression. */
  it("grants the request when the walk exhausted the channel", async () => {
    mount("channel_sessions", sessions(1_500, VISIBLE_KEY));

    const out = await resolveColorsForPush(
      ME,
      WS,
      [reported("run-1", HIDDEN_KEY)],
      NO_INCUMBENT
    );

    expect(out[0].color).toBe(HIDDEN_KEY);
  });

  it("an empty channel is whole, so the first agent still gets a colour", async () => {
    mount("channel_sessions", []);

    const out = await resolveColorsForPush(
      ME,
      WS,
      [reported("run-1", null)],
      NO_INCUMBENT
    );

    expect(out[0].color).toBe(VISIBLE_KEY);
  });
});
