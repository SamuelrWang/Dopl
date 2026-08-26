// @vitest-environment jsdom
/**
 * THE OWN-AGENT ACTIVITY LABEL (2026-08-20) — "Thinking…" / "Running a command"
 * on my own cards, over the desktop's `detail` key.
 *
 * Separate from `agents-tab.test.tsx` because that file is at 498 of the
 * 500-line cap, and separate from the desktop's `session-detail.test.mjs`
 * because the two own different halves: the desktop owns WHICH SITUATION this
 * is, this owns WHAT A HUMAN READS. The seam is the point — a copy change must
 * not need a desktop release.
 *
 * The properties that fail quietly:
 *
 *  - **AN UNKNOWN KEY RENDERS NOTHING, NEVER THE RAW KEY.** A newer main can
 *    emit a seventh value, and `awaiting_handoff` appearing verbatim on a card
 *    is worse than the pill's own word, which is always true.
 *  - **A DETAIL NEVER SPEAKS OVER A NON-WORKING STATE.** `agentLiveness` enforces it
 *    rather than trusting callers, because a card reading "Idle · Thinking…" is
 *    the two-readers-one-fact defect inside one component.
 *  - **PEER CARDS GET NO DETAIL AT ALL.** The cross-machine wire is deliberately
 *    coarse (INVARIANTS §11), and a peer row has no `detail` to render.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelPeerSession } from "../../hooks/use-channel-agent-sessions";
import { AgentsTab } from "./agents-tab";
import { ChannelsV2AgentPanel } from "./agent-panel";

import { agentDetailLabel, agentKey, agentLiveness } from "./agents-model";
import { CHANNEL_ID, ME, PEER } from "./test-fixtures";

afterEach(cleanup);

function summary(over: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    sessionId: "s-1",
    channelId: CHANNEL_ID,
    taskId: "t-1",
    name: "flint",
    state: "working",
    channelName: "Website",
    threadTitle: "UI-kit design",
    ...over,
  };
}

describe("agentDetailLabel — the key becomes a sentence exactly once", () => {
  const CASES: Array<[DesktopSessionSummary["detail"], string | null]> = [
    ["thinking", "Thinking…"],
    ["posting", "Sending a message"],
    ["permission", "Waiting on you"],
    ["awaiting_peer", "Waiting for a reply"],
    ["awaiting_inbound", "Message waiting"],
  ];
  for (const [detail, label] of CASES) {
    it(`renders ${detail} as "${label}"`, () => {
      expect(agentDetailLabel({ detail })).toBe(label);
    });
  }

  it("names the tool when the desktop could name it", () => {
    expect(agentDetailLabel({ detail: "tool", toolLabel: "Bash" })).toBe("Running Bash");
    expect(agentDetailLabel({ detail: "tool", toolLabel: "dopl_channel" })).toBe(
      "Running dopl_channel"
    );
  });

  // ⚠ A REAL CASE, not a defensive stub: `toolLabel` is null whenever the name
  // could not be shortened to anything. "Running a command" is true either way.
  it("falls back to a true sentence when the tool could not be named", () => {
    expect(agentDetailLabel({ detail: "tool", toolLabel: null })).toBe("Running a command");
    expect(agentDetailLabel({ detail: "tool" })).toBe("Running a command");
  });

  it("renders NOTHING for an absent detail — an older main omits the field", () => {
    expect(agentDetailLabel({})).toBeNull();
    expect(agentDetailLabel({ detail: null })).toBeNull();
  });

  it("renders NOTHING for a key this build does not know", () => {
    // A newer main emitting a seventh value must degrade to the pill's word.
    expect(
      agentDetailLabel({ detail: "awaiting_handoff" as DesktopSessionSummary["detail"] })
    ).toBeNull();
  });
});

/**
 * ⚠ THE COMPONENT STOPPED DECIDING ANYTHING ON 2026-08-22. It took a `running`
 * boolean, which is precisely why "alive between turns" and "parked" both had to
 * render as "Idle" — a boolean has no room for the distinction. `agents-model.ts ›
 * agentLiveness` is the ONE mapping now, and `bits.tsx › AgentLiveness` renders
 * the verdict it is handed. These cases therefore run the MAPPING, which is where
 * the rules they are about actually live.
 */
describe("agentLiveness — the detail refines the state, never contradicts it", () => {
  it("shows the detail in place of Running, not beside it", () => {
    const { tone, label } = agentLiveness({ state: "working", detail: "thinking" });
    // "Running · Thinking…" would say one thing twice; the dot carries liveness.
    expect(label).toBe("Thinking…");
    expect(tone).toBe("working");
  });

  it("falls back to Running when this build has no finer sentence", () => {
    expect(agentLiveness({ state: "working" }).label).toBe("Running");
  });

  // ⚠ THE CASE THE GUARD INSIDE THE MAPPING EXISTS FOR.
  it("refuses to speak over a non-working state even when handed a detail", () => {
    expect(agentLiveness({ state: "idle", detail: "thinking" }).label).toBe("Idle");
  });

  /**
   * THE SPLIT INSIDE `idle` (Samuel, 2026-08-22). The wire has three values and
   * lumped two very different situations under one: an agent ALIVE between turns
   * that will answer the moment something arrives, and one that is parked and has
   * to be woken. Both read "Idle", so watching a live agent wait for a
   * counterparty looked exactly like watching a stopped one.
   */
  it("says WAITING for an idle agent that is still listening", () => {
    const { tone, label } = agentLiveness({ state: "idle", listening: true });
    expect(label).toBe("Waiting");
    expect(tone).toBe("waiting");
  });

  it("says IDLE for a parked agent, and for a main that cannot say", () => {
    // ⚠ ABSENT IS NOT "not listening" AS A CLAIM — it is "this machine cannot
    // say", and the quieter word is the honest rendering (INVARIANTS §11). An
    // older main omits the field and every one of its idle agents reads exactly
    // as it did before this existed.
    expect(agentLiveness({ state: "idle", listening: false }).label).toBe("Idle");
    expect(agentLiveness({ state: "idle" }).label).toBe("Idle");
  });

  it("says ENDED, and outranks every other signal", () => {
    // An ended agent is DEAD: no wake path revives it. A stale `listening` or a
    // retained `detail` riding along must not make it look alive.
    const { tone, label } = agentLiveness({
      state: "ended",
      listening: true,
      detail: "thinking",
    });
    expect(label).toBe("Ended");
    expect(tone).toBe("ended");
  });
});

describe("the Agents tab wires it through for MY agents and not for peers", () => {
  const noop = () => {};

  it("labels my own card with what the machine says it is doing", () => {
    render(
      <AgentsTab
        sessions={[summary({ detail: "tool", toolLabel: "Bash" })]}
        channelId={CHANNEL_ID}
        currentUserId={ME}
        openAgent={null}
        onOpenAgent={noop}
      />
    );
    expect(screen.getByText("Running Bash")).toBeTruthy();
  });

  it("leaves a card from an older main reading exactly as it did before", () => {
    render(
      <AgentsTab
        sessions={[summary()]}
        channelId={CHANNEL_ID}
        currentUserId={ME}
        openAgent={null}
        onOpenAgent={noop}
      />
    );
    expect(screen.getByText("Running")).toBeTruthy();
  });

  /** A peer row, fresh by default. ⚠ Freshness is no longer what decides whether
   *  there is a card (Samuel, 2026-08-22) — only how brightly it draws. */
  function peerRow(over: Partial<ChannelPeerSession> = {}): ChannelPeerSession {
    return {
      userId: PEER,
      channelId: CHANNEL_ID,
      threadId: "t-1",
      name: "onyx",
      state: "working",
      channelName: "Website",
      threadTitle: "UI-kit design",
      updatedAt: new Date().toISOString(),
      ...over,
    };
  }

  function renderPeer(peer: ChannelPeerSession) {
    render(
      <AgentsTab
        sessions={[]}
        channelId={CHANNEL_ID}
        currentUserId={ME}
        peers={[peer]}
        openAgent={null}
        onOpenAgent={noop}
      />
    );
    return screen.getByText("onyx").closest("[class]")?.parentElement as HTMLElement;
  }

  it("gives a PEER card the coarse word only — there is no detail on that wire", () => {
    renderPeer(peerRow());
    expect(screen.getByText("onyx")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.queryByText("Thinking…")).toBeNull();
  });

  /**
   * ⚠ THE REPORTED BUG (Samuel, 2026-08-22): the peer card appeared and then
   * DISAPPEARED while the agent was still live. `updated_at` is pushed on state
   * CHANGE, never on a timer, so an idle agent's row simply ages — and the
   * 2026-08-20 freshness guard read that age as death. The card stays.
   */
  it("STILL DRAWS a peer card whose row has not moved in an hour", () => {
    renderPeer(
      peerRow({
        state: "idle",
        updatedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      })
    );
    expect(screen.getByText("onyx")).toBeTruthy();
    expect(screen.getByText("Idle")).toBeTruthy();
  });

  /** ⚠ …DIMMED, which is the whole of what the deleted guard was really for.
   *  `data-stale` is the hook; `opacity-60` is the shade. */
  it("dims the quiet card and says when it last moved", () => {
    const card = renderPeer(
      peerRow({ updatedAt: new Date(Date.now() - 60 * 60_000).toISOString() })
    );
    const stale = card.closest("[data-stale]") as HTMLElement;
    expect(stale).not.toBeNull();
    expect(stale.className).toContain("opacity-60");
    expect(screen.getByText(/last update/)).toBeTruthy();
  });

  it("leaves a FRESH card at full strength, with no timing clause", () => {
    const card = renderPeer(peerRow());
    expect(card.closest("[data-stale]")).toBeNull();
    expect(screen.queryByText(/last update/)).toBeNull();
  });
});

/**
 * "OPEN AGENT" (2026-08-20, F-212's closure) — the button that now always opens
 * the agent window.
 *
 * ⚠ THE HISTORY THIS PINS AGAINST, because both wrong answers were shipped. It
 * began reporting `{ok:true}` having opened nothing (main's recreate fallback),
 * and the renderer discarded the verdict anyway. The fix in between was an
 * honest refusal reading "this agent runs without a window" — which Samuel
 * called meaningless, correctly: a window is a VIEW, not a runtime property.
 * There is no refusal path left to word; there is a window.
 */
describe("Open window always opens the agent view", () => {
  const AGENT = { channelId: CHANNEL_ID, taskId: "t-1" };
  const SEGMENT = "acme-a1b2";

  afterEach(() => {
    delete (window as { dopl?: unknown }).dopl;
  });

  function bridgeWith(sessions: Record<string, unknown>) {
    (window as unknown as { dopl?: unknown }).dopl = {
      apiRequest: () => Promise.resolve({ status: 200, statusText: "", hasBody: false }),
      sessions,
    };
  }

  it("prefers the dedicated op and hands it the segment the route needs", async () => {
    const openWin = vi.fn().mockResolvedValue({ ok: true });
    bridgeWith({ reopen: vi.fn(), openAgentWindow: openWin });
    const { openAgentWindow } = await import("./agents-controls");
    expect(await openAgentWindow(AGENT, SEGMENT)).toEqual({ ok: true, reason: undefined });
    // ⚠ The trailing coordinate is the AGENT INSTANCE (2026-08-22) — absent on
    // this fixture, which is the older-main shape and degrades to oldest-live.
    expect(openWin).toHaveBeenCalledWith(SEGMENT, CHANNEL_ID, "t-1", undefined);
  });

  // ⚠ NOT COMPATIBILITY THEATRE: on a main with only `reopen`, that op now hands a
  // live windowless session to the SAME window, so the button works there too.
  // Gating on the new op alone would hide a working affordance — the mistake
  // `canOpenAgentWindow`'s docblock already records having made once.
  it("falls back to reopen, WITH the segment, on a main without the new op", async () => {
    const reopen = vi.fn().mockResolvedValue({ ok: true });
    bridgeWith({ reopen });
    const { openAgentWindow } = await import("./agents-controls");
    expect(await openAgentWindow(AGENT, SEGMENT)).toEqual({ ok: true, reason: undefined });
    expect(reopen).toHaveBeenCalledWith(CHANNEL_ID, "t-1", SEGMENT, undefined);
  });

  it("offers the button when EITHER op is present, and not when neither is", async () => {
    const { canOpenAgentWindow } = await import("./agents-controls");
    bridgeWith({ openAgentWindow: vi.fn() });
    expect(canOpenAgentWindow()).toBe(true);
    bridgeWith({ reopen: vi.fn() });
    expect(canOpenAgentWindow()).toBe(true);
    bridgeWith({});
    expect(canOpenAgentWindow()).toBe(false);
  });

  it("answers a verdict, not a throw, on a main without either op", async () => {
    bridgeWith({});
    const { openAgentWindow } = await import("./agents-controls");
    expect(await openAgentWindow(AGENT, SEGMENT)).toEqual({ ok: false, reason: "no-bridge" });
  });
});

describe("the panel's button reaches it", () => {
  afterEach(() => {
    delete (window as { dopl?: unknown }).dopl;
  });

  it("routes the click at the agent window, carrying the workspace segment", () => {
    const openWin = vi.fn().mockResolvedValue({ ok: true });
    (window as { dopl?: unknown }).dopl = {
      apiRequest: () => Promise.resolve({ status: 200, statusText: "", hasBody: false }),
      sessions: { reopen: vi.fn(), openAgentWindow: openWin },
    };
    const agent = summary();
    render(
      <ChannelsV2AgentPanel
        openAgent={agentKey(agent)}
        sessions={[agent]}
        messages={[]}
        currentUserId={ME}
        workspaceSlug="acme-a1b2"
        onClose={() => {}}
      />
    );
    screen.getByRole("button", { name: "Open window" }).click();
    expect(openWin).toHaveBeenCalledWith("acme-a1b2", CHANNEL_ID, "t-1", undefined);
  });

  // ⚠ THE DELETED NOTICE, ON THE MAIN THAT ONCE SHOWED IT. "This agent runs
  // without a window" appeared on a build with only the OLDER `reopen` op and no
  // `openAgentWindow`. The old test bound `openAgentWindow` and asserted the
  // apology text was absent — which it was by construction, since that phrase was
  // deleted from the source and nothing renders it. This binds ONLY `reopen` (the
  // shape that used to apologise) and asserts the POSITIVE affordance that
  // replaced it: the "Open window" button is offered whenever EITHER op exists.
  it("offers Open window on a reopen-only main — never the deleted 'no window' apology", () => {
    (window as { dopl?: unknown }).dopl = {
      apiRequest: () => Promise.resolve({ status: 200, statusText: "", hasBody: false }),
      // ⚠ ONLY `reopen`, not `openAgentWindow` — the build that used to apologise.
      sessions: { reopen: vi.fn().mockResolvedValue({ ok: true }) },
    };
    const agent = summary();
    render(
      <ChannelsV2AgentPanel
        openAgent={agentKey(agent)}
        sessions={[agent]}
        messages={[]}
        currentUserId={ME}
        workspaceSlug="acme-a1b2"
        onClose={() => {}}
      />
    );
    // The affordance IS offered on this main (a real assertion, not a vacuous
    // absence)…
    expect(screen.getByRole("button", { name: "Open window" })).toBeTruthy();
    // …and no apology is shown in its place.
    expect(screen.queryByText(/without a window/i)).toBeNull();
    expect(screen.queryByText(/not built yet/i)).toBeNull();
  });
});
