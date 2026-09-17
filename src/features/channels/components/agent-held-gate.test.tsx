// @vitest-environment jsdom
/**
 * THE HELD-GATE CARD (Samuel, 2026-09-17: *"i dont see like a surface where I can approve the
 * permission either inline"*) — the inline surface for a blocked agent, and the properties that
 * fail QUIETLY:
 *
 *  - **IT RENDERS FROM MAIN'S FEED, not from anything this side infers.** The card exists
 *    because `DesktopSessionSummary.heldGates` lists a request; the pill saying "Waiting on you"
 *    is not enough to draw buttons from, because the SPA cannot know a request id.
 *  - **IT IS ABSENT, NEVER INERT, on a build that cannot answer.** The operator is already
 *    stuck; a dead Approve button says the feature is broken rather than missing — the
 *    no-inert-control rule this whole family is written against (`canMessageAgent`'s bug).
 *  - **ONE CARD PER HELD CALL.** They are different questions with different answers, and a
 *    single "approve everything" control would be a standing grant wearing a per-call face.
 *  - **NOTHING IS STAMPED OPTIMISTICALLY.** The card goes when main's next push stops listing
 *    the request. A card that vanished on click would hide the one case worth seeing — an answer
 *    that nothing took.
 *  - **A REFUSAL IS SAID OUT LOUD**, because `{ ok: false }` is an ORDINARY outcome here (the
 *    request expired, was answered elsewhere, or a park fail-closed its resolver).
 *  - **THE GATE REASON IS A CODE, AND AN UNKNOWN ONE RENDERS NOTHING** rather than leaking
 *    `container-audience` under two buttons.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { AgentHeldGates, HELD_GATE_REFUSED } from "./agent-held-gate";
import {
  agentHeldGates,
  heldGateReasonLabel,
  heldGateTitle,
} from "./agents-held-gates";
import { CHANNEL_ID } from "./test-fixtures";

const TASK = "t-1";
const AGENT = "a1b2c3d4";

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

type Held = {
  requestId: string;
  tool: string;
  op: string;
  summary: string;
  reason: string;
};

function gate(over: Partial<Held> = {}): Held {
  return {
    requestId: "req-1",
    tool: "Bash",
    op: "",
    summary: '{"command":"ls -la"}',
    reason: "awaiting-approval",
    ...over,
  };
}

function agent(heldGates: unknown): DesktopSessionSummary {
  return {
    sessionId: "s-1",
    channelId: CHANNEL_ID,
    taskId: TASK,
    agentId: AGENT,
    name: AGENT,
    state: "working",
    channelName: "Website",
    threadTitle: "UI-kit design",
    detail: "permission",
    heldGates,
  } as unknown as DesktopSessionSummary;
}

/** Install a `window.dopl` whose `sessions` holds exactly the ops named. */
function install(answerPermission?: ReturnType<typeof vi.fn>) {
  const sessions: Record<string, unknown> = {};
  if (answerPermission) sessions.answerPermission = answerPermission;
  (window as unknown as { dopl?: unknown }).dopl = {
    apiRequest: () => Promise.resolve({ status: 200, statusText: "", hasBody: false }),
    sessions,
  };
}

// ── THE PROJECTION ───────────────────────────────────────────────────────────────────

describe("what the feed is read as", () => {
  it("reads main's entries, and DROPS one that could never be answered", () => {
    // ⚠ An entry with no request id would render two buttons that can only refuse.
    const held = agentHeldGates(
      agent([gate(), { tool: "Read", summary: "/tmp/x" }, gate({ requestId: "req-2" })])
    );
    expect(held.map((h) => h.requestId)).toEqual(["req-1", "req-2"]);
  });

  it("ABSENT IS 'CANNOT SAY', NOT 'NOTHING IS HELD' — and both render nothing", () => {
    // An older main omits the field entirely; a build with a different shape sends junk. Neither
    // may throw, and neither may invent a card.
    expect(agentHeldGates(agent(undefined))).toEqual([]);
    expect(agentHeldGates(agent(null))).toEqual([]);
    expect(agentHeldGates(agent("nope" as unknown))).toEqual([]);
    expect(agentHeldGates(agent([null, 7, "x"]))).toEqual([]);
  });

  it("an unnamed tool still reads as something — never a blank card", () => {
    expect(agentHeldGates(agent([{ requestId: "r" }]))[0].tool).toBe("a tool");
  });

  it("the TITLE prefers the channel OP KEY over the raw input (F-578's distinction)", () => {
    // `rooms` alone reads identically for a roster read and an invite, which is why the op key
    // is a field of its own.
    expect(
      heldGateTitle({
        requestId: "r",
        tool: "dopl_channel",
        op: "rooms.invite",
        summary: '{"op":"rooms","action":"invite"}',
        reason: "",
      })
    ).toBe("dopl_channel · rooms.invite");
    expect(heldGateTitle({ requestId: "r", tool: "Bash", op: "", summary: "ls", reason: "" })).toBe(
      "Bash · ls"
    );
    // Neither is required: a bare name is still a real question.
    expect(heldGateTitle({ requestId: "r", tool: "Bash", op: "", summary: "", reason: "" })).toBe(
      "Bash"
    );
  });

  it("an UNKNOWN reason code renders NOTHING, not the raw code", () => {
    expect(heldGateReasonLabel("awaiting-approval")).toBeTruthy();
    expect(heldGateReasonLabel("a-code-from-a-newer-main")).toBeNull();
    expect(heldGateReasonLabel("")).toBeNull();
  });
});

// ── THE CARD ─────────────────────────────────────────────────────────────────────────

describe("what the operator is shown", () => {
  it("renders the held call, the reason in plain words, and both controls", () => {
    install(vi.fn());
    render(<AgentHeldGates agent={agent([gate()])} />);
    expect(screen.getByText(/Bash · \{"command":"ls -la"\}/)).toBeTruthy();
    expect(screen.getByText("This agent asks first")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deny" })).toBeTruthy();
  });

  it("ONE CARD PER HELD CALL — never one control over several questions", () => {
    install(vi.fn());
    render(
      <AgentHeldGates
        agent={agent([gate(), gate({ requestId: "req-2", tool: "Read", summary: "/tmp/x" })])}
      />
    );
    expect(document.querySelectorAll("[data-agent-held-gate]").length).toBe(2);
    expect(screen.getAllByRole("button", { name: "Approve" }).length).toBe(2);
  });

  it("renders NOTHING when nothing is held", () => {
    install(vi.fn());
    const { container } = render(<AgentHeldGates agent={agent([])} />);
    expect(container.textContent).toBe("");
  });

  it("🔒 ABSENT, NEVER INERT: a build without the op renders no card at all", () => {
    // ⚠ THE CAPABILITY IS THE BRIDGE MEMBER, not `window.dopl` being truthy and not the wrapper
    // (which is always a function). A main with the FEED and no answer op is a real build shape,
    // and it is exactly the shape a widened gate would ship dead buttons to.
    install(); // sessions exists; `answerPermission` does not
    const { container } = render(<AgentHeldGates agent={agent([gate()])} />);
    expect(container.textContent).toBe("");
  });

  it("🔒 a plain browser (no bridge at all) renders no card", () => {
    const { container } = render(<AgentHeldGates agent={agent([gate()])} />);
    expect(container.textContent).toBe("");
  });
});

// ── THE ANSWER ───────────────────────────────────────────────────────────────────────

describe("answering", () => {
  it("Approve calls the bridge with THIS agent, THIS request, and allow=true", async () => {
    const answerPermission = vi.fn().mockResolvedValue({ ok: true });
    install(answerPermission);
    render(<AgentHeldGates agent={agent([gate()])} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    });
    // ⚠ THE `agentId` IS THE POINT OF THE ASSERTION. Omitted, main answers the OLDEST live agent
    // on the thread — a different agent's question, with nothing reporting the substitution.
    expect(answerPermission).toHaveBeenCalledWith(CHANNEL_ID, TASK, "req-1", true, AGENT);
  });

  it("Deny is the same call with allow=false — fail-closed on both sides of the wire", async () => {
    const answerPermission = vi.fn().mockResolvedValue({ ok: true });
    install(answerPermission);
    render(<AgentHeldGates agent={agent([gate()])} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    });
    expect(answerPermission).toHaveBeenCalledWith(CHANNEL_ID, TASK, "req-1", false, AGENT);
  });

  it("each card answers ITS OWN request", async () => {
    const answerPermission = vi.fn().mockResolvedValue({ ok: true });
    install(answerPermission);
    render(
      <AgentHeldGates agent={agent([gate(), gate({ requestId: "req-2", tool: "Read" })])} />
    );
    const second = document.querySelector('[data-agent-held-gate="req-2"]');
    await act(async () => {
      fireEvent.click(second!.querySelector("button")!);
    });
    expect(answerPermission).toHaveBeenCalledWith(CHANNEL_ID, TASK, "req-2", true, AGENT);
  });

  it("🔒 NOTHING IS STAMPED OPTIMISTICALLY — the card stands until main's next push", async () => {
    const answerPermission = vi.fn().mockResolvedValue({ ok: true });
    install(answerPermission);
    const { rerender } = render(<AgentHeldGates agent={agent([gate()])} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    });
    // Still there: main has not pushed yet, and a card that hid itself would hide an answer
    // nothing took.
    expect(document.querySelectorAll("[data-agent-held-gate]").length).toBe(1);
    // …and it goes on the push that stops listing it.
    rerender(<AgentHeldGates agent={agent([])} />);
    expect(document.querySelectorAll("[data-agent-held-gate]").length).toBe(0);
  });

  it("🔒 A REFUSAL IS SAID OUT LOUD, and the feed is re-read", async () => {
    // A refusal is NOT a push: main changed nothing, so nothing arrives to correct a card
    // standing over a request that is already gone.
    const answerPermission = vi.fn().mockResolvedValue({ ok: false, reason: "unknown-request" });
    const onRefreshSessions = vi.fn();
    install(answerPermission);
    render(
      <AgentHeldGates agent={agent([gate()])} onRefreshSessions={onRefreshSessions} />
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    });
    expect(screen.getByRole("status").textContent).toBe(HELD_GATE_REFUSED);
    expect(onRefreshSessions).toHaveBeenCalled();
  });

  it("both controls go inert while an answer is in flight — one question, one answer", async () => {
    let settle: (v: { ok: boolean }) => void = () => {};
    const answerPermission = vi
      .fn()
      .mockReturnValue(new Promise<{ ok: boolean }>((r) => { settle = r; }));
    install(answerPermission);
    render(<AgentHeldGates agent={agent([gate()])} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    });
    const deny = screen.getByRole("button", { name: "Deny" }) as HTMLButtonElement;
    expect(deny.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      settle({ ok: true });
    });
    expect(answerPermission).toHaveBeenCalledTimes(1);
  });
});
