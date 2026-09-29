// @vitest-environment jsdom
/**
 * DEVICE-AWARE MESSAGES in the transcript (docs/specs/device-aware-messages.md), over a mocked
 * TRANSPORT: the device pill under a person's message (`metadata.source`, live name over the
 * snapshot) and the display card for an agent's `metadata.display` (blocks, answer, Save). One
 * transcript serves the channels page, the desktop workspace pages and the /home record pane.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { Transcript } from "./transcript";
import { useDisplayAnswer } from "../hooks/use-display-writes";
import { indexMembers } from "./view-model";
import { channelRows } from "./view-model-rows";
import { CHANNEL_ID, ME, PEER, member, message } from "./test-fixtures";
import type { ChannelMessage } from "../types";

const INDEX = indexMembers(
  [member({ userId: ME, displayName: "Sam Wang" }), member({ userId: PEER, displayName: "Diana" })],
  ME
);

const COMPUTER_ID = "c0ffee00-0000-4000-8000-000000000001";

function route(path: string, opts: Record<string, unknown> = {}): Promise<unknown> {
  const method = (opts.method as string | undefined) ?? "GET";
  if (path === "/api/devices" && method === "GET") {
    return Promise.resolve({ devices: [{ id: COMPUTER_ID, kind: "computer", name: "Studio Mac" }] });
  }
  if (path === "/api/glasses/devices") return Promise.resolve({ devices: [] });
  if (path.endsWith("/display/answer") || path.endsWith("/display/save")) {
    return Promise.resolve({ ok: true });
  }
  return Promise.reject(new Error(`unrouted ${method} ${path}`));
}

/** The channel surface's wiring: the transcript handed the one answer write (`useDisplayAnswer`). */
function Host({ messages, write }: { messages: ChannelMessage[]; write: boolean }) {
  const answer = useDisplayAnswer();
  return (
    <Transcript
      rows={channelRows(messages, [], INDEX, formatChannelTimestamp)}
      index={INDEX}
      flashId={null}
      onOpenThread={() => {}}
      onAnswerDisplay={write ? answer : undefined}
    />
  );
}

function renderMessages(messages: ChannelMessage[], write = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Host messages={messages} write={write} />
    </QueryClientProvider>
  );
}

const DISPLAY = {
  spec_version: 1,
  screen_id: "d-1234abcd",
  blocks: [
    { id: "title", type: "text", content: "Usage today", border: false, selectable: false },
    { id: "bar", type: "progress", value: 0.62, label: "Credits", border: false, selectable: false },
    { id: "rule", type: "divider", border: false, selectable: false },
    { id: "options", type: "list", items: ["Keep going", "Pause"], border: false, selectable: true },
  ],
};

const agentDisplay = (over: Partial<ChannelMessage> = {}, display: object = DISPLAY) =>
  message({
    id: "m-display",
    authorKind: "agent",
    body: "Usage today\nCredits 62%",
    metadata: { display },
    ...over,
  });

beforeEach(() => {
  request.mockReset();
  request.mockImplementation(route);
  toasts.length = 0;
});
afterEach(cleanup);

describe("the device pill", () => {
  it("shows the snapshot label under a person's message, and nothing on an old one", () => {
    renderMessages([
      message({ id: "m-1", metadata: { source: { kind: "glasses", label: "Even G2" } } }),
      message({ id: "m-2", seq: 2, authorUserId: PEER, body: "no source" }),
    ]);
    const row = document.querySelector('[data-message-id="m-1"]') as HTMLElement;
    expect(within(row).getByText("Even G2")).toBeTruthy();
    const old = document.querySelector('[data-message-id="m-2"]') as HTMLElement;
    expect(within(old).queryByText("Even G2")).toBeNull();
    // No device id: nothing to resolve, so no devices read at all.
    expect(request).not.toHaveBeenCalled();
  });

  it("prefers the live device name when the id is one of the viewer's devices", async () => {
    renderMessages([
      message({
        metadata: { source: { kind: "computer", device_id: COMPUTER_ID, label: "Old Name" } },
      }),
    ]);
    expect(await screen.findByText("Studio Mac")).toBeTruthy();
    expect(screen.queryByText("Old Name")).toBeNull();
  });

  it("never draws a pill on an agent's post, even if one carried a source", () => {
    renderMessages([
      message({ authorKind: "agent", metadata: { source: { kind: "web", label: "Web" } } }),
    ]);
    expect(screen.queryByText("Web")).toBeNull();
  });
});

describe("the display card", () => {
  it("renders the blocks instead of the plain-text fallback", () => {
    renderMessages([agentDisplay()]);
    expect(screen.getByText("Usage today")).toBeTruthy();
    expect(screen.getByText("62%")).toBeTruthy();
    expect(screen.getByText("Credits")).toBeTruthy();
    expect(document.querySelector("hr")).toBeTruthy();
    expect(screen.queryByText(/Credits 62%/)).toBeNull();
  });

  it("answers a v1 selectable list (read as a choice) on the message's display route", async () => {
    renderMessages([agentDisplay()]);
    expect(screen.getByText("Needs Your Decision")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        `/api/channels/${CHANNEL_ID}/messages/m-display/display/answer`,
        { method: "POST", body: { index: 1 } }
      )
    );
    // Pending: the choice holds its face and the strip stops being pressable.
    expect(screen.queryByRole("button", { name: "Keep going" })).toBeNull();
  });

  it("shows a stored answer as the chosen choice, read-only", () => {
    renderMessages([
      agentDisplay({}, {
        ...DISPLAY,
        answer: { block_id: "options", choice: "Keep going", index: 0, at: "x", via: "glasses" },
      }),
    ]);
    expect(screen.queryByRole("button", { name: "Keep going" })).toBeNull();
    const chosen = document.querySelector('[data-chosen="true"]');
    expect(chosen?.textContent).toBe("Keep going");
  });

  it("saves the display as a template", async () => {
    renderMessages([agentDisplay()]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        `/api/channels/${CHANNEL_ID}/messages/m-display/display/save`,
        { method: "POST", body: {} }
      )
    );
    expect(await screen.findByRole("button", { name: "Saved" })).toBeTruthy();
    expect(toasts).toContain("Saved as template");
  });

  it("draws no buttons when the host carries no write — absent, not disabled", () => {
    renderMessages([agentDisplay()], false);
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.getByText("Pause")).toBeTruthy();
  });

  it("is read-only on a peer's display: no choices to press, no Save", () => {
    renderMessages([agentDisplay({ authorUserId: PEER })]);
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByText("Pause")).toBeTruthy();
  });

  it("falls back to the plain body when the display cannot be read", () => {
    renderMessages([agentDisplay({}, { blocks: [{ type: "hologram" }] })]);
    expect(screen.getByText(/Credits 62%/)).toBeTruthy();
  });
});
