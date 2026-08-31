// @vitest-environment jsdom
/**
 * MULTIPLAYER AGENTS — several of ONE operator's agents on ONE thread (Samuel,
 * 2026-08-21).
 *
 * ⚠ WHAT CHANGED UNDERNEATH. `sessions.launch` used to resolve to at most one
 * session per `(channel, thread)`; it now spawns a NEW instance on every call and
 * answers with a random 8-char `agentId`. The stone-name pool (`quartz`, `flint`,
 * …) is being deleted with it — a handle that named one agent per channel is a
 * promise this model cannot keep.
 *
 * ⚠ THE FAILURES THIS FILE EXISTS FOR ARE ALL SILENT ONES. Nothing throws when a
 * list collapses: React reuses a duplicated key, every card on the thread lights
 * up "Viewing" at once, and the panel opens whichever row happened to be first.
 * The operator sees a plausible surface that is answering about the wrong agent.
 *
 * ⚠ A SEPARATE FILE ONLY BECAUSE `agents-tab.test.tsx` STANDS AT THE 500-LINE
 * CAP — the same seam `use-agents-panel.test.tsx` was opened on, and the same
 * rule: the cases go where the behaviour is, and this one's behaviour is the
 * multi-agent list.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { AgentsTab } from "./agents-tab";
import {
  agentDisplayId,
  agentKey,
  agentsPerThread,
  ownAgentsFor,
} from "./agents-model";
import { messageAgent, openAgentWindow, setAgentMode } from "./agents-controls";
import { CHANNEL_ID } from "./test-fixtures";

afterEach(cleanup);

/** ⚠ Widened locally with `agentId`: the field is MAIN's, and
 *  `spa-bridge.ts › DesktopSessionSummary` is the desktop's declaration to widen. */
type Summary = DesktopSessionSummary & { agentId?: string };

function summary(over: Partial<Summary> = {}): Summary {
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

/** Three of mine, all on t-1 — the shape a triple-click of New Agent produces. */
const THREE = [
  summary({ sessionId: "s-1", agentId: "a1b2c3d4" }),
  summary({ sessionId: "s-2", agentId: "e5f6g7h8", state: "idle" }),
  summary({ sessionId: "s-3", agentId: "i9j0k1l2" }),
];

describe("agentKey — one key per AGENT, not per thread", () => {
  it("gives two agents on ONE thread two different keys", () => {
    const [one, two] = THREE;
    expect(agentKey(one)).not.toBe(agentKey(two));
  });

  it("keys on the agent id itself, so a park+recreate does not move it", () => {
    // The id survives what `sessionId` does not — which is why the open-agent
    // state holds this and never the session id.
    expect(agentKey(summary({ sessionId: "s-1", agentId: "a1b2c3d4" }))).toBe(
      agentKey(summary({ sessionId: "s-99", agentId: "a1b2c3d4" }))
    );
  });

  it("falls back to (channel, thread) on a main that emits no id", () => {
    expect(agentKey(summary())).toBe(`${CHANNEL_ID}:t-1`);
  });
});

describe("agentDisplayId — the id is what renders", () => {
  it("prefers the agent id over the legacy handle", () => {
    expect(agentDisplayId(summary({ agentId: "a1b2c3d4" }))).toBe("a1b2c3d4");
  });

  it("keeps a legacy handle rather than rendering a blank", () => {
    // An older main emits a name and no id. A blank card header is strictly
    // worse than a stale-looking name (INVARIANTS §11).
    expect(agentDisplayId(summary())).toBe("flint");
  });

  it("never renders an empty id as the agent's name", () => {
    expect(agentDisplayId(summary({ agentId: "   ", name: "flint" }))).toBe("flint");
  });
});

describe("the projections do not collapse a shared thread", () => {
  it("keeps every one of my agents on the open thread", () => {
    expect(ownAgentsFor(THREE, CHANNEL_ID, "t-1")).toHaveLength(3);
  });

  it("counts them all under the one taskId", () => {
    expect(agentsPerThread(THREE).get("t-1")).toBe(3);
  });
});

describe("the Agents tab with three of mine on one thread", () => {
  function mount(openAgent: string | null = null, onOpenAgent = vi.fn()) {
    render(
      <AgentsTab
        sessions={THREE}
        channelId={CHANNEL_ID}
        openThreadId="t-1"
        openAgent={openAgent}
        onOpenAgent={onOpenAgent}
      />
    );
    return onOpenAgent;
  }

  it("draws one card per agent, each under its own id", () => {
    mount();
    // ⚠ `Agent #<id>`, the full name the transcript pill uses (2026-08-24) —
    // the bare id would also match a substring of it, so this asserts the
    // WHOLE label and would catch the prefix silently disappearing.
    for (const id of ["a1b2c3d4", "e5f6g7h8", "i9j0k1l2"]) {
      expect(screen.getByText(`#${id}`)).toBeTruthy();
    }
    // Three cards, so three ways in — not one row standing for the thread.
    expect(screen.getAllByRole("button", { name: /^Open$/ })).toHaveLength(3);
  });

  it("marks EXACTLY ONE of them Viewing", () => {
    mount(agentKey(THREE[1]));
    expect(screen.getAllByRole("button", { name: "Viewing" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Open$/ })).toHaveLength(2);
  });

  it("opens the agent that was clicked, not the thread's first", () => {
    const onOpenAgent = mount(null);
    fireEvent.click(screen.getAllByRole("button", { name: /^Open$/ })[2]);
    expect(onOpenAgent).toHaveBeenCalledWith(agentKey(THREE[2]));
  });

  it("states each agent's own state — they do not share one", () => {
    mount();
    // Two working, one idle: a single liveness for the thread would be a claim
    // about agents nobody measured.
    expect(screen.getAllByText("Running")).toHaveLength(2);
    expect(screen.getAllByText("Idle")).toHaveLength(1);
  });

  it("says how many of mine share the thread, on every card", () => {
    mount();
    expect(screen.getAllByText(/3 of yours here/)).toHaveLength(3);
  });
});

/**
 * EVERY SESSION OP NAMES THE INSTANCE (2026-08-22 — F-239's SPA half).
 *
 * ⚠ THIS IS THE FAILURE MODE THE WHOLE `agentId` PARAMETER EXISTS FOR, and it is
 * silent from every angle. Main resolves `(channelId, taskId)` to a GROUP and,
 * with no id, acts on the OLDEST live member of it. Every one of these controls is
 * clicked from a surface showing ONE agent, so an op that drops the id does not
 * fail — it succeeds against a DIFFERENT agent, reports `{ok:true}`, and the card
 * the operator clicked sits there unchanged looking like a bug in the feed.
 *
 * ⚠ AND THE ABSENT CASE IS PINNED BESIDE EACH ONE. An older main omits `agentId`
 * from its summaries and cannot accept one; passing `undefined` is what reaches
 * the behaviour that build already had, so the degradation must stay a
 * degradation and never become a refusal.
 */
describe("the bridge ops address ONE agent", () => {
  const AGENT = summary({ agentId: "a1b2c3d4" });

  function bridge(): Record<string, ReturnType<typeof vi.fn>> {
    const ops = {
      pause: vi.fn().mockResolvedValue({ ok: true }),
      end: vi.fn().mockResolvedValue({ ok: true }),
      openAgentWindow: vi.fn().mockResolvedValue({ ok: true }),
      message: vi.fn().mockResolvedValue({ ok: true }),
      setMode: vi.fn().mockResolvedValue({ ok: true }),
      reopen: vi.fn().mockResolvedValue({ ok: true }),
    };
    (window as { dopl?: unknown }).dopl = { apiRequest: vi.fn(), sessions: ops };
    return ops;
  }

  afterEach(() => {
    delete (window as { dopl?: unknown }).dopl;
  });

  it("carries the id on the 1:1 message", async () => {
    const ops = bridge();
    await messageAgent({
      channelId: CHANNEL_ID,
      taskId: "t-1",
      agentId: AGENT.agentId,
      text: "hi",
    });
    expect(ops.message).toHaveBeenCalledWith(CHANNEL_ID, "t-1", "hi", "a1b2c3d4");
  });

  it("carries the id on a posture move", async () => {
    const ops = bridge();
    await setAgentMode({
      channelId: CHANNEL_ID,
      taskId: "t-1",
      agentId: AGENT.agentId,
      axis: "tools",
      mode: "bypass",
    });
    expect(ops.setMode).toHaveBeenCalledWith(
      CHANNEL_ID,
      "t-1",
      "tools",
      "bypass",
      "a1b2c3d4"
    );
  });

  it("carries the id when opening the agent's own window, and on the reopen fallback", async () => {
    const ops = bridge();
    await openAgentWindow(AGENT, "acme");
    expect(ops.openAgentWindow).toHaveBeenCalledWith(
      "acme",
      CHANNEL_ID,
      "t-1",
      "a1b2c3d4"
    );

    // ⚠ The OLDER op has to carry it too. A build with `reopen` and not
    // `openAgentWindow` is a real shape, and it is the one where a silently
    // wrong agent would be hardest to notice.
    (window as { dopl?: unknown }).dopl = {
      apiRequest: vi.fn(),
      sessions: { reopen: ops.reopen },
    };
    await openAgentWindow(AGENT, "acme");
    expect(ops.reopen).toHaveBeenCalledWith(CHANNEL_ID, "t-1", "acme", "a1b2c3d4");
  });

  it("omits the id — never invents one — when the summary carries none", async () => {
    const ops = bridge();
    await messageAgent({
      channelId: CHANNEL_ID,
      taskId: "t-1",
      agentId: summary().agentId,
      text: "hi",
    });
    expect(ops.message).toHaveBeenCalledWith(CHANNEL_ID, "t-1", "hi", undefined);
  });
});
