// @vitest-environment jsdom
/**
 * THE UNIFIED DISPLAY CARD (docs/specs/unified-display.md §7.3) over a mocked TRANSPORT: every v2
 * block, the choice's two faces (decision / inline), recommended + why, answered states, the one
 * answer route, Save, and the degraded paths (unknown block, unreadable display, relaxed index).
 * Legacy decision parity lives in `escalation-card*.test.tsx`; v1 rows in
 * `device-aware-messages.test.tsx`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { request, toasts } = vi.hoisted(() => ({
  request: vi.fn<(path: string, opts?: Record<string, unknown>) => Promise<unknown>>(),
  toasts: [] as string[],
}));

vi.mock("@/shared/api/api-client", async () => {
  const envelope = await import("@/shared/api/api-envelope");
  return { ...envelope, apiRequest: request };
});
vi.mock("@/shared/ui/toast", () => ({
  toast: ({ title }: { title: string }) => toasts.push(title),
}));

import { formatChannelTimestamp } from "@/shared/lib/format-time";
import type { Display, DisplayBlock } from "@/features/display/core/types";
import { Transcript } from "./transcript";
import { DisplayBlocks } from "./display-blocks";
import { AGENT_CARD_FACE } from "./escalation-card-face";
import { indexMembers } from "./view-model";
import { channelRows } from "./view-model-rows";
import { useDisplayAnswer } from "../hooks/use-display-writes";
import { ESCALATION_METADATA_KEY } from "../escalation";
import { CHANNEL_ID, ME, PEER, member, message } from "./test-fixtures";
import type { ChannelMessage } from "../types";

const INDEX = indexMembers(
  [member({ userId: ME, displayName: "Sam Wang" }), member({ userId: PEER, displayName: "Diana" })],
  ME
);

function Host({ messages }: { messages: ChannelMessage[] }) {
  const answer = useDisplayAnswer();
  return (
    <Transcript
      rows={channelRows(messages, [], INDEX, formatChannelTimestamp)}
      index={INDEX}
      flashId={null}
      onOpenThread={() => {}}
      onAnswerDisplay={answer}
    />
  );
}

function draw(messages: ChannelMessage[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Host messages={messages} />
    </QueryClientProvider>
  );
}

const shown = (blocks: object[], extra: Record<string, unknown> = {}, over: Partial<ChannelMessage> = {}) =>
  message({
    id: "m-show",
    authorKind: "agent",
    body: "fallback body",
    metadata: { display: { spec_version: 2, display_id: "d-1", blocks, ...extra } },
    ...over,
  });

const DECISION_BLOCKS = [
  { type: "heading", text: "Ship the migration now?" },
  { type: "text", content: "Additive and reversible.", tone: "muted" },
  { type: "fields", rows: [{ label: "Risk", value: "Low" }] },
  {
    type: "choice",
    id: "ship",
    options: [
      { label: "Ship now", description: "Live in ~10 minutes.", recommended: true, why: "Reversible." },
      { label: "Wait for review", description: "Blocked until tomorrow." },
    ],
  },
];

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ ok: true });
  toasts.length = 0;
});
afterEach(cleanup);

describe("every v2 block", () => {
  it("draws heading, text tones, fields, lists, progress, table, divider and spacer; the body is only the fallback", () => {
    const { container } = draw([
      shown([
        { type: "heading", text: "Deploy 1.38.0" },
        { type: "text", content: "Loud", tone: "strong" },
        { type: "text", content: "Quiet", tone: "muted" },
        { type: "fields", rows: [{ label: "Owner", value: "Sam" }] },
        { type: "list", items: ["one", "two"] },
        { type: "list", items: ["first"], style: "number" },
        { type: "progress", value: 0.6, label: "Build" },
        { type: "table", columns: ["Job", "State"], rows: [["web", "done"]] },
        { type: "divider" },
        { type: "spacer", lines: 2 },
      ]),
    ]);
    expect(screen.getByText("Display")).toBeTruthy();
    expect(screen.getByText("Deploy 1.38.0").className).toContain("font-semibold");
    expect(screen.getByText("Loud").className).toContain("font-semibold");
    expect(screen.getByText("Quiet").className).toContain("text-text-secondary");
    expect(screen.getByText("Owner").tagName).toBe("DT");
    expect(screen.getByText("Sam").tagName).toBe("DD");
    expect(screen.getByText("one").closest("ul")?.className).toContain("list-disc");
    expect(screen.getByText("first").closest("ol")?.className).toContain("list-decimal");
    expect(screen.getByText("60%")).toBeTruthy();
    expect(screen.getByText("Job").tagName).toBe("TH");
    expect(screen.getByText("done").tagName).toBe("TD");
    expect(container.querySelector("hr")).toBeTruthy();
    expect(container.querySelector("[data-block='b10']")?.getAttribute("style")).toContain("1.5rem");
    expect(screen.queryByText("fallback body")).toBeNull();
    // No choice: nothing to press, and Save on the viewer's own agent's display.
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Save"]);
  });

  it("an UNKNOWN block draws nothing and the rest still render (a newer server's block)", () => {
    const display: Display = {
      from: "v2",
      display_id: "d-x",
      blocks: [
        { id: "a", type: "hologram" } as unknown as DisplayBlock,
        { id: "b", type: "text", content: "still here" },
      ],
      layout: "stack",
      answer: null,
      wait_until: null,
      glasses_message_id: null,
      decision: false,
    };
    const { container } = render(<DisplayBlocks display={display} face={AGENT_CARD_FACE.row} />);
    expect(screen.getByText("still here")).toBeTruthy();
    expect(container.querySelector("[data-block='a']")).toBeNull();
  });

  it("an unreadable display falls back to the plain body", () => {
    draw([shown([{ type: "bogus", content: "?" }])]);
    expect(screen.getByText("fallback body")).toBeTruthy();
  });
});

describe("a composed decision", () => {
  it("draws the decision face: option badges, description, the recommendation LAST with its why", () => {
    const { container } = draw([shown(DECISION_BLOCKS, {}, { metadata: {
      display: { spec_version: 2, display_id: "d-1", blocks: DECISION_BLOCKS },
      [ESCALATION_METADATA_KEY]: { issue: "Ship the migration now?", context: "", options: [
        { label: "Ship now", consequence: "Live in ~10 minutes." },
        { label: "Wait for review", consequence: "Blocked until tomorrow." } ],
        recommendation: { index: 0, why: "Reversible." } },
    } })]);
    expect(screen.getByText("Needs Your Decision")).toBeTruthy();
    expect(container.querySelector("[data-escalation-id='m-show']")).toBeTruthy();
    expect(screen.getByText("Live in ~10 minutes.")).toBeTruthy();
    expect(screen.getByText("Recommended:")).toBeTruthy();
    expect(screen.getByText("Reversible.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Option A: Ship now" })).toBeTruthy();
  });

  it("answers through the one route, then re-reads; a failure toasts and gives the buttons back", async () => {
    request.mockRejectedValueOnce(new Error("boom"));
    draw([shown(DECISION_BLOCKS)]);
    fireEvent.click(screen.getByRole("button", { name: "Option B: Wait for review" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        `/api/channels/${CHANNEL_ID}/messages/m-show/display/answer`,
        { method: "POST", body: { index: 1 } }
      )
    );
    expect(await screen.findByRole("button", { name: "Option B: Wait for review" })).toBeTruthy();
    expect(toasts).toContain("Couldn't send that answer");
  });

  it("a stored answer names who chose, greys the rest, and drops the buttons", () => {
    const { container } = draw([
      shown(DECISION_BLOCKS, {
        answer: { block_id: "ship", index: 0, choice: "Ship now", at: "x", via: "glasses", by: PEER },
      }),
    ]);
    expect(screen.queryByRole("button", { name: /Option/ })).toBeNull();
    expect(screen.getByText(/Diana chose/).textContent).toBe("Diana chose Ship now");
    const [chosen, rest] = Array.from(container.querySelectorAll("[data-option-index]")) as HTMLElement[];
    expect(chosen.className).toContain("auth-btn-3d");
    expect(rest.className).toContain("bg-[var(--seg-fill)]");
  });

  it("a bare choice (no descriptions) is the inline face: the buttons carry the labels", () => {
    draw([shown([{ type: "choice", options: [{ label: "Yes" }, { label: "No" }] }])]);
    expect(screen.getByRole("button", { name: "Yes" })).toBeTruthy();
    expect(screen.queryByText("Option A")).toBeNull();
  });

  it("dopl_request_decision's display keeps the old card's bar: no Save", () => {
    draw([shown(DECISION_BLOCKS, { origin: "dopl_request_decision" })]);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("a RELAXED legacy index (7 options, no consequences) still renders as a decision", () => {
    const options = Array.from({ length: 7 }, (_, i) => ({ label: `Pick ${i + 1}`, consequence: "" }));
    draw([
      message({
        id: "m-relaxed",
        authorKind: "agent",
        body: "prose",
        metadata: { [ESCALATION_METADATA_KEY]: { issue: "Which?", context: "", options, recommendation: null } },
      }),
    ]);
    expect(screen.getByRole("button", { name: "Option G: Pick 7" })).toBeTruthy();
    expect(screen.queryByText("prose")).toBeNull();
  });
});
