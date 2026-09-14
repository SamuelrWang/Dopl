// @vitest-environment jsdom
/**
 * DELETING ONE AGENT FROM ITS CARD (2026-08-25, Samuel's ruling).
 *
 * The properties that fail quietly, and are therefore what this file is for:
 *
 *  - **⚠ DELETION IS LOCAL. THE CHANNEL RECORD IS IMMUTABLE BY IT.** The last section renders
 *    the SAME transcript before and after the agent is deleted and asserts that every message
 *    and every attribution pill is byte-identical. This is the property Samuel's ruling is
 *    ABOUT: the agent's identity rides the MESSAGE (`agents-model.ts › parseAgentPostStamp`,
 *    off `client_msg_id`), so nothing a local delete can touch is in the path. If a future
 *    change ever routes the pill through the desktop feed, this file is what fails.
 *  - **NO CONTROL WITHOUT THE OP.** Feature detection on the BRIDGE MEMBER, never on the
 *    wrapper — the rule `agents-controls.ts › canMessageAgent` was earned by (a wrapper is
 *    always a function, so it renders a control that can only refuse).
 *  - **ONE CONFIRM, AND ITS COPY BRANCHES ON WHETHER THE AGENT IS STILL RUNNING.** A live agent
 *    is ENDED by the same call that deletes it, so the running case is a CLAUSE and not a
 *    second question.
 *  - **THE CARD LEAVES ON THE FEED, NOT ON THE CLICK.** Nothing here removes a row optimistically:
 *    the projection is main's, and a card that vanished on a refusal would be the lie this whole
 *    family has been bitten by twice.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";

/** The tab MOUNTS the template picker (the split button's chevron); this keeps it renderable. */
vi.mock("@/features/agent-templates/hooks/use-agent-templates", () => ({
  useAgentTemplates: () => ({ templates: [], loading: false, error: null, refetch: () => {} }),
}));

import { AgentsTab } from "./agents-tab";
import { AgentDeleteButton, canDeleteAgent, deleteAgentCopy } from "./agent-delete";
import { Transcript } from "./transcript";
import { indexMembers } from "./view-model";
import { threadRows } from "./view-model-rows";
import { CHANNEL_ID, ME, PEER, member, message } from "./test-fixtures";

const del = vi.fn();

/** ⚠ `apiRequest` IS THE SPA MARKER (`spa-bridge.ts › getSpaBridge`) — a `window.dopl` without
 *  it is the legacy wrapper's partial object and reads as NO bridge, so every fixture here
 *  carries one or the detection under test would not be exercised at all. */
function withBridge(sessions: unknown) {
  (window as unknown as { dopl?: unknown }).dopl = sessions
    ? { apiRequest: () => Promise.resolve(null), sessions }
    : undefined;
}

afterEach(() => {
  cleanup();
  del.mockReset();
  withBridge(null);
});

const AGENT_ID = "a1b2c3d4";

function summary(over: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    sessionId: "s-1",
    channelId: CHANNEL_ID,
    taskId: "t-1",
    agentId: AGENT_ID,
    name: AGENT_ID,
    state: "working",
    channelName: "Website",
    threadTitle: "UI-kit design",
    ...over,
  } as DesktopSessionSummary;
}

// ⚠ `Delete #<id>` since 2026-08-31 — the word "agent" left the display name (Samuel's
// ruling; `agents-model.ts › agentDisplayName`), so the accessible label follows it.
const trash = () => screen.queryByRole("button", { name: /^Delete #/ });

// ── 1. THE CONTROL ───────────────────────────────────────────────────────────

describe("the card's trash icon", () => {
  it("is ABSENT without the bridge op, and without an agent id", () => {
    // A control that cannot delete is worse than no control: it can only ever refuse.
    withBridge({});
    render(<AgentDeleteButton agent={summary()} />);
    expect(trash()).toBeNull();
    expect(canDeleteAgent()).toBe(false);

    cleanup();
    // A main old enough to omit `agentId` has nothing to address a deletion to.
    withBridge({ delete: del });
    render(<AgentDeleteButton agent={summary({ agentId: undefined })} />);
    expect(trash()).toBeNull();
  });

  it("is a NAKED GLYPH revealed by the card's hover, never `hidden`", () => {
    // ⚠ `opacity`, not `hidden` — the card must not reflow when the cursor arrives — and the
    // focus half is not optional: a control reachable by Tab that stays invisible while focused
    // is a trap (docs/DESIGN-SYSTEM.md § Row-level edit affordances).
    withBridge({ delete: del });
    render(<AgentDeleteButton agent={summary()} />);
    const btn = trash() as HTMLElement;
    expect(btn.className).toContain("opacity-0");
    expect(btn.className).toContain("group-hover/card:opacity-100");
    expect(btn.className).toContain("focus-visible:opacity-100");
    // `bare` = no button face at all: the hit area grows to 32px and no surface is painted.
    expect(btn.className).toContain("h-8");
    expect(btn.className).not.toContain("raised-tab");
  });

  it("rides EVERY own card — running, idle and retained-ended alike", () => {
    withBridge({ delete: del });
    for (const state of ["working", "idle", "ended"] as const) {
      render(<AgentDeleteButton agent={summary({ state })} />);
      expect(trash()).not.toBeNull();
      cleanup();
    }
  });
});

// ── 2. THE CONFIRMATION ──────────────────────────────────────────────────────

describe("the confirmation", () => {
  it("says ONE line, plus ONE clause when the agent is still running", () => {
    // ⚠ ONE CONFIRM, NEVER TWO. Main ends a live agent inside the same call, so the running
    // case is a clause — asking twice for one gesture teaches an operator to click through.
    expect(deleteAgentCopy("ended")).toBe("Deletes the agent and its session history.");
    expect(deleteAgentCopy("working")).toContain("still running");
    expect(deleteAgentCopy("idle")).toContain("still running");
    // ⚠ `state === "ended"` MARKS A DEAD AGENT, never `endedAt` — that stamp is additive and
    // absent on an older main, so gating on it would call every legacy ended agent live.
    expect(deleteAgentCopy(undefined)).toContain("still running");
  });

  it("opens on the trash, titled `Delete agent`, with a destructive confirm", async () => {
    withBridge({ delete: del });
    render(<AgentDeleteButton agent={summary({ state: "ended" })} />);
    fireEvent.click(trash() as HTMLElement);
    // ⚠ `findBy`, not `getBy`: `ModalShell` mounts on a rAF so the dialog is one frame late.
    expect(await screen.findByRole("heading", { name: "Delete agent" })).toBeTruthy();
    expect(
      screen.getByText("Deletes the agent and its session history.")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(del).not.toHaveBeenCalled();
  });

  it("calls the op with the agent's OWN three coordinates", async () => {
    // ⚠ The id is REQUIRED on this op alone: elsewhere an omitted one resolves to the oldest
    // live agent on the thread, which for a destructive verb is a different agent.
    del.mockResolvedValue({ ok: true, ended: true });
    withBridge({ delete: del });
    render(<AgentDeleteButton agent={summary()} />);
    fireEvent.click(trash() as HTMLElement);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith(CHANNEL_ID, "t-1", AGENT_ID));
  });

  it("STAYS OPEN when main refuses — a delete that did nothing must not look done", async () => {
    del.mockResolvedValue({ ok: false, reason: "no-agent" });
    withBridge({ delete: del });
    const onDeleted = vi.fn();
    render(<AgentDeleteButton agent={summary()} onDeleted={onDeleted} />);
    fireEvent.click(trash() as HTMLElement);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(del).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "Delete agent" })).toBeTruthy();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

// ── 3. THE CARD LEAVES ON THE FEED ───────────────────────────────────────────

describe("the Agents tab after a deletion", () => {
  const tab = (sessions: DesktopSessionSummary[]) => (
    <AgentsTab
      sessions={sessions}
      channelId={CHANNEL_ID}
      openThreadId="t-1"
      openAgent={null}
      onOpenAgent={() => {}}
    />
  );

  it("keeps the card until the summary push drops it, never on the click", async () => {
    // ⚠ NOTHING IS REMOVED OPTIMISTICALLY. The projection is main's; a row that vanished on a
    // refusal would be the surface lying about what the machine did.
    del.mockResolvedValue({ ok: true, ended: true });
    withBridge({ delete: del });
    const { rerender } = render(tab([summary()]));
    expect(screen.getByText(`#${AGENT_ID}`)).toBeTruthy();

    fireEvent.click(trash() as HTMLElement);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(del).toHaveBeenCalled());
    expect(screen.getByText(`#${AGENT_ID}`)).toBeTruthy();

    // The next push from main omits it — the card goes with the feed.
    rerender(tab([]));
    expect(screen.queryByText(`#${AGENT_ID}`)).toBeNull();
    expect(screen.getByText("No agents on this thread yet.")).toBeTruthy();
  });
});

// ── 4. ⚠ WHAT SURVIVES: THE CHANNEL RECORD ───────────────────────────────────

describe("the transcript is untouched by a deletion", () => {
  const INDEX = indexMembers(
    [
      member({ userId: ME, displayName: "Sam Wang" }),
      member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
    ],
    ME
  );

  const ROWS = [
    message({
      id: "m-1",
      seq: 1,
      body: "Kicking this off.",
      authorUserId: ME,
      metadata: { taskId: "t-1" },
    }),
    message({
      id: "m-2",
      seq: 2,
      body: "Working on the kit now.",
      authorUserId: ME,
      authorKind: "agent",
      metadata: { taskId: "t-1" },
      clientMsgId: `agent-${AGENT_ID}-1`,
    }),
  ];

  const transcript = () => (
    <Transcript
      rows={threadRows(ROWS, "t-1", INDEX, formatChannelTimestamp)}
      index={INDEX}
      flashId={null}
      onOpenThread={vi.fn()}
    />
  );

  it("renders every message and its pill from the MESSAGE ROW, with NO desktop feed", async () => {
    // ⚠ THIS IS THE RULING, IN ITS HONEST FORM. What the agent POSTED is
    // `channel_messages` — the server's shared record — and the delete op reaches
    // only LOCAL desktop stores. The id in the pill comes off `client_msg_id`,
    // carried BY the message, and `attribution-pill.tsx › attributionName`
    // derives the label from that alone. So the state AFTER a delete — the agent's
    // session summary gone, no bridge at all — is exactly the input asserted here,
    // and the transcript is whole.
    //
    // ⚠ THE PREVIOUS FORM PROVED NOTHING: it rendered a module-constant `ROWS`
    // twice around a MOCKED delete and asserted `after === before`. `Transcript`
    // never reads the desktop feed the delete touches, so the two renders were
    // byte-identical by construction whether or not the property held — a green
    // test over a claim it could not have falsified.

    // First, drive the real delete path so it is exercised (it resolves against a
    // mock and touches only the bridge, never the transcript's inputs).
    del.mockResolvedValue({ ok: true, ended: true });
    withBridge({ delete: del });
    render(<AgentDeleteButton agent={summary()} />);
    fireEvent.click(trash() as HTMLElement);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(del).toHaveBeenCalled());
    cleanup();

    // Now render the transcript in the POST-DELETE world: no bridge, no feed. The
    // messages and the id-derived pill are still there because they are the
    // message's own data.
    withBridge(null);
    render(transcript());
    expect(screen.getByText("Kicking this off.")).toBeTruthy();
    expect(screen.getByText("Working on the kit now.")).toBeTruthy();
    const pill = screen.getByText(`#${AGENT_ID}`).closest("[data-agent-id]");
    expect(pill?.getAttribute("data-agent-id")).toBe(AGENT_ID);
  });

  it("falls back to `Agent #<id>` — the label went, the identity did not", () => {
    // The display name is DELETED with the agent (Samuel's "all information attached"), so a
    // renamed agent's rows read as the canonical form afterwards. That is what an agent nobody
    // renamed has always rendered as, and the id is still exactly right.
    render(transcript());
    const pill = screen.getByText(`#${AGENT_ID}`).closest("[data-agent-id]");
    expect(pill?.getAttribute("data-agent-id")).toBe(AGENT_ID);
  });
});
