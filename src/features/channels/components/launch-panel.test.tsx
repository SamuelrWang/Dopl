// @vitest-environment jsdom
/**
 * **THE OUTBOUND SEND BOX SHOWS THE DRAFT THE WAY THE ROOM WILL SHOW IT** (Samuel,
 * 2026-10-10, #3128).
 *
 * This panel is the last gate before an agent's reply leaves the machine, and it printed
 * that reply's `**asterisks**` raw — so the operator approved a wall of markup and then
 * watched the SAME string render bold in the transcript a second later. The decision and
 * the result have to be one rendering, or the gate is showing something the room never
 * sees.
 *
 * ⚠ **IT IS THE AGENT WINDOW'S OWN RENDERER** (`agent-stream-prose.tsx › StreamProse`,
 * which `agent-stream-sent-box.tsx` mounts for exactly this text). A second renderer for
 * "the same prose, approved instead of posted" is the defect, not the fix.
 * ⚠ **BLOCKS, NOT THE INLINE ARM**, and the box is why: the preview SCROLLS
 * (`max-h-[200px] overflow-y-auto`) rather than clamping, so a drafted list stays a list.
 * The clamped lanes of the channel surface take the inline arm for the opposite reason
 * (`message-markdown-inline.tsx` rule 2).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LaunchPanel } from "./launch-panel";
import type { ChannelConsentRequest } from "../types";
import { CHANNEL_ID, ME } from "./test-fixtures";

afterEach(cleanup);

function request(over: Partial<ChannelConsentRequest> = {}): ChannelConsentRequest {
  return {
    id: "c-1",
    channelId: CHANNEL_ID,
    workspaceId: "ws-1",
    operatorUserId: ME,
    requesterUserId: null,
    kind: "outbound_message",
    messageSeq: null,
    summary: "",
    bodyPreview: "",
    proposedReply: null,
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    createdAt: "2026-10-10T12:00:00.000Z",
    expiresAt: null,
    requesterName: null,
    requesterAvatarUrl: null,
    ...over,
  };
}

function panel(over: Partial<ChannelConsentRequest> = {}) {
  return render(
    <LaunchPanel
      request={request(over)}
      onLaunch={vi.fn()}
      onDecline={vi.fn()}
    />
  );
}

describe("the drafted reply renders as the transcript will render it", () => {
  it("makes the draft's bold bold, and prints no asterisks", () => {
    panel({ proposedReply: "shipped **today** — see `README`" });
    // Every plain-text leaf is a `<span>` of its own, so the emphasis is its ancestor.
    expect(screen.getByText("today").closest("strong")).not.toBeNull();
    expect(screen.getByText("README").tagName).toBe("CODE");
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  it("keeps the draft's BLOCK structure — the box scrolls, so a list is a list", () => {
    const { container } = panel({ proposedReply: "Plan:\n\n- one\n- two" });
    expect(container.querySelector("ul")?.querySelectorAll("li").length).toBe(2);
  });

  it("renders the summary through the same renderer", () => {
    panel({ summary: "ready to send **now**", proposedReply: "body" });
    expect(screen.getByText("now").closest("strong")).not.toBeNull();
  });

  it("still draws nothing where the agent drafted nothing", () => {
    const { container } = panel({ proposedReply: null, summary: "" });
    // Absent, never an empty box: the panel's own rule for a draft it does not have.
    expect(container.querySelector(".concave-field")).toBeNull();
  });

  it("prints HTML in a draft as characters — the untrusted-body rule holds here too", () => {
    const { container } = panel({ proposedReply: "hi <img src=x onerror=1>" });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=1>");
  });
});
