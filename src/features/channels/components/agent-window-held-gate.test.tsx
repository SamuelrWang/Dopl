// @vitest-environment jsdom
/**
 * **THE HELD-GATE CARD IS REACHABLE FROM THE AGENT WINDOW** (Samuel's ruling
 * R-24, 2026-09-17 — **(b)**: the card moves, Pause/End stay panel-only).
 *
 * ⚠ **WHAT WAS BROKEN WAS THE ONLY CONTROL WHOSE ABSENCE STOPS WORK.** The
 * window has posture and model selects and has never mounted `AgentControls`, so
 * an operator watching their agent from here could see *"Waiting on you"* and had
 * no way to answer it — the native notification is got once, cannot be returned
 * to, and expires on a ten-minute TTL.
 *
 * ⚠ **THE CARD'S OWN BEHAVIOUR IS `agent-held-gate.test.tsx`'s** — the projection,
 * the refusal copy, one-card-per-call, the no-optimistic-removal rule. What is
 * asserted HERE is the three things only the window can get wrong: that it mounts
 * at all, that it stays ABSENT on a build that cannot answer, and that R-24's
 * boundary held — no Pause, no End, in a window that never had one.
 *
 * ⚠ A SEPARATE FILE because `agent-window.test.tsx` stands near the §1 cap; the
 * harness is shared, which is the seam that file was split on.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { CHANNEL_ID } from "./test-fixtures";
import { TASK, installBridge, mount, summary } from "./agent-window-harness";

// The window's server reads are real hooks; this suite is about one control.
vi.mock("../hooks/use-channel-messages", () => ({
  useChannelMessages: () => ({ messages: [], loading: false, refetch: () => {} }),
}));
vi.mock("./live", () => ({ useChannelsLive: () => ({ gate: {} }) }));
vi.mock("../hooks/use-consent-inbox", () => ({
  useConsentInbox: () => ({ requests: [], outbound: [], refetch: () => {} }),
}));
vi.mock("../hooks/use-channel-preference-writes", () => ({
  useChannelPreferenceWrites: () => ({
    consent: { mutate: () => {}, pending: false },
    unaddressedResponder: { mutate: () => {}, pending: false },
  }),
}));

const REQUEST = "req-1";

/** An agent of ours holding one tool call, as `main/session-held-gates.js` reports it. */
const held = () =>
  summary({
    agentId: "a1b2c3d4",
    detail: "permission",
    heldGates: [
      {
        requestId: REQUEST,
        tool: "Bash",
        op: "",
        summary: '{"command":"ls -la"}',
        reason: "awaiting-approval",
      },
    ],
  } as never);

/** ⚠ ADDED AFTER `installBridge`, not inside the harness: the harness describes the
 *  ops EVERY window case needs, and this one is the subject here. */
function withAnswer(answerPermission: ReturnType<typeof vi.fn>) {
  const bridge = (window as unknown as {
    dopl: { sessions: Record<string, unknown> };
  }).dopl;
  bridge.sessions.answerPermission = answerPermission;
}

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

describe("the agent window can answer a held call", () => {
  it("draws the card, and Approve reaches the bridge for THIS request", async () => {
    const answer = vi.fn().mockResolvedValue({ ok: true });
    installBridge({ sessions: [held()] });
    withAnswer(answer);
    await mount();

    expect(screen.getByRole("button", { name: "Deny" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    });
    // ⚠ THE INSTANCE AND THE REQUEST, never the sessionId — the pair is what main
    // resolves against its own registry (`agents-controls.ts`).
    expect(answer).toHaveBeenCalledWith(
      CHANNEL_ID,
      TASK,
      REQUEST,
      true,
      "a1b2c3d4"
    );
  });

  it("renders NOTHING when this build cannot answer — absent, never inert", async () => {
    // Same held call, no `answerPermission` op: an older main, or a browser.
    installBridge({ sessions: [held()] });
    await mount();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deny" })).toBeNull();
  });

  it("holds R-24's boundary: the card came across, Pause and End did not", async () => {
    installBridge({ sessions: [held()] });
    withAnswer(vi.fn());
    await mount();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    // 🔒 A destructive verb in a window that never had one is a NEW control, not a
    // move — which is exactly why Samuel chose (b) over (a).
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("button", { name: "End" })).toBeNull();
  });

  it("draws no card for an agent holding nothing", async () => {
    installBridge();
    withAnswer(vi.fn());
    await mount();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});
