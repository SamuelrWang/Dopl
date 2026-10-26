// @vitest-environment jsdom
/**
 * The Threads panel's artifacts face: the toggle (drawn on `ThreadsTab`), the list and one opened
 * artifact (read on `ArtifactsTab`). The heading flip is pinned in `info-panel.test.tsx`.
 *
 * The transport is mocked, not the hooks: the real path, its `?artifact=<id>` arm and the cache
 * keys are under test, because the list is a server lane rather than a slice of the transcript.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { request } = vi.hoisted(() => ({
  request: vi.fn<(path: string, opts?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock("@/shared/api/api-client", async () => {
  const envelope = await import("@/shared/api/api-envelope");
  return { ...envelope, apiRequest: request };
});

import {
  ARTIFACTS_CLIPPED_NOTE,
  ARTIFACTS_EMPTY_NOTE,
  ARTIFACTS_UNREAD_NOTE,
  ArtifactsTab,
} from "./artifacts-tab";
import { ARTIFACT_MESSAGES_CLIPPED_NOTE, ARTIFACT_MESSAGES_UNREAD_NOTE } from "./artifact-detail";
import { ARTIFACTS_FACE_LABEL, THREADS_FACE_LABEL, ThreadsTab } from "./threads-tab";
import { indexMembers } from "./view-model";
import { member, message, thread, ME, PEER } from "./test-fixtures";
import type { ChannelFoldedArtifact } from "../types";

const CHANNEL = "44444444-4444-4444-8444-444444444444";
const WS = "33333333-3333-4333-8333-333333333333";
const ART = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NO_FEEDS = { sessions: null, peers: [] };

const INDEX = indexMembers(
  [
    member({ userId: ME, displayName: "Sam Wang" }),
    member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
  ],
  ME
);

function folded(over: Partial<ChannelFoldedArtifact> = {}): ChannelFoldedArtifact {
  return {
    artifact: {
      id: ART,
      channelId: CHANNEL,
      workspaceId: WS,
      name: "Toggle wave wrap-up",
      summary: "What the wave **landed**",
      createdBy: PEER,
      createdByAgent: null,
      dissolvedAt: null,
      // Fresh: only Recent is open on a device that has never chosen.
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    },
    count: 3,
    firstSeq: 11,
    lastSeq: 14,
    ...over,
  };
}

/** What this run answers with, per arm of the one route. */
let lane: { list?: unknown; card?: unknown } = {};

beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (path, opts) => {
    if (!path.endsWith("/artifacts")) throw new Error(`unexpected path: ${path}`);
    const query = (opts?.query ?? {}) as { artifact?: string };
    const body = query.artifact ? lane.card : lane.list;
    if (body === undefined) throw new Error(`no fixture for ${path}`);
    if (body instanceof Error) throw body;
    return body;
  });
  lane = {
    list: { artifacts: [folded()], truncated: false },
    card: {
      messages: [
        message({ id: "m-11", seq: 11, body: "first of the run", authorUserId: ME }),
        message({
          id: "m-14",
          seq: 14,
          body: "- one\n- two",
          authorUserId: PEER,
          metadata: { threadId: "t-x" },
        }),
      ],
      truncated: false,
    },
  };
});
afterEach(cleanup);

function mountFace(onJumpToMessage?: (threadId: string | null, messageId: string) => void) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ArtifactsTab
        channelId={CHANNEL}
        workspaceId={WS}
        index={INDEX}
        feeds={NO_FEEDS}
        onJumpToMessage={onJumpToMessage}
      />
    </QueryClientProvider>
  );
}

async function openArtifact() {
  fireEvent.click(await screen.findByRole("button", { name: "Open Toggle wave wrap-up" }));
  await screen.findByText("first of the run");
}

function threadsProps(
  over: Partial<React.ComponentProps<typeof ThreadsTab>> = {}
): React.ComponentProps<typeof ThreadsTab> {
  return {
    threads: [thread({ id: "t-a", title: "Alpha audit" })],
    truncated: false,
    loading: false,
    index: INDEX,
    feeds: NO_FEEDS,
    openThreadId: null,
    onOpenThread: vi.fn(),
    onNewThread: vi.fn(),
    ...over,
  };
}

describe("the face toggle", () => {
  it("shares the New thread button's row and comes FIRST in it", () => {
    render(<ThreadsTab {...threadsProps({ onToggleFace: vi.fn() })} />);
    const toggle = screen.getByRole("button", { name: ARTIFACTS_FACE_LABEL });
    const create = screen.getByRole("button", { name: "New thread" });
    expect(toggle.parentElement).toBe(create.parentElement);
    expect(toggle.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("names where the press goes: Artifacts on the thread face, Threads on the artifact face", () => {
    const { rerender } = render(<ThreadsTab {...threadsProps({ onToggleFace: vi.fn() })} />);
    expect(screen.getByRole("button", { name: ARTIFACTS_FACE_LABEL })).toBeTruthy();
    rerender(
      <ThreadsTab
        {...threadsProps({ onToggleFace: vi.fn(), artifactsFace: true, artifacts: <p>face</p> })}
      />
    );
    expect(screen.getByRole("button", { name: THREADS_FACE_LABEL })).toBeTruthy();
  });

  it("asks the panel to flip, and owns no state of its own", () => {
    const onToggleFace = vi.fn();
    render(<ThreadsTab {...threadsProps({ onToggleFace })} />);
    fireEvent.click(screen.getByRole("button", { name: ARTIFACTS_FACE_LABEL }));
    expect(onToggleFace).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Alpha audit")).toBeTruthy();
  });

  it("is absent where the capability is off", () => {
    render(<ThreadsTab {...threadsProps()} />);
    expect(screen.queryByRole("button", { name: ARTIFACTS_FACE_LABEL })).toBeNull();
    expect(screen.getByRole("button", { name: "New thread" })).toBeTruthy();
  });

  it("hides New thread on the artifact face and restores it on the way back", () => {
    const onNewThread = vi.fn();
    const face = { onToggleFace: vi.fn(), onNewThread };
    const { rerender } = render(
      <ThreadsTab {...threadsProps({ ...face, artifactsFace: true, artifacts: <p>face</p> })} />
    );
    expect(screen.queryByRole("button", { name: "New thread" })).toBeNull();
    expect(screen.queryByText("Alpha audit")).toBeNull();
    expect(screen.getByText("face")).toBeTruthy();
    rerender(<ThreadsTab {...threadsProps(face)} />);
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    expect(onNewThread).toHaveBeenCalledTimes(1);
  });
});

describe("the artifacts list", () => {
  it("lists the channel's artifacts with the name, the summary's markdown, the span and the folder", async () => {
    mountFace();
    expect(await screen.findByText("Toggle wave wrap-up")).toBeTruthy();
    expect(screen.getByText("landed")).toBeTruthy();
    expect(screen.queryByText(/\*\*/)).toBeNull();
    expect(screen.getByText("3 messages · #11–#14")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Folded by Diana Taylor" })).toBeTruthy();
  });

  it("reads the channel's own artifacts route", async () => {
    mountFace();
    await screen.findByText("Toggle wave wrap-up");
    expect(request.mock.calls.map(([path]) => path)).toEqual([`/api/channels/${CHANNEL}/artifacts`]);
  });

  it("says so when the list CLIPPED, and does not read as an absence", async () => {
    lane.list = { artifacts: [folded()], truncated: true };
    mountFace();
    const note = await screen.findByText(ARTIFACTS_CLIPPED_NOTE);
    expect(note.textContent).not.toMatch(/no artifacts/i);
  });

  it("draws the empty state when there are none", async () => {
    lane.list = { artifacts: [], truncated: false };
    mountFace();
    expect(await screen.findByText(ARTIFACTS_EMPTY_NOTE)).toBeTruthy();
  });

  it("🔒 says the read FAILED rather than claiming the channel is empty", async () => {
    lane.list = new Error("403");
    mountFace();
    expect(await screen.findByText(ARTIFACTS_UNREAD_NOTE)).toBeTruthy();
    expect(screen.queryByText(ARTIFACTS_EMPTY_NOTE)).toBeNull();
  });
});

describe("one opened artifact", () => {
  it("heads the document with a breadcrumb, the title, the summary and the meta line", async () => {
    mountFace();
    await openArtifact();
    const doc = screen.getByRole("article", { name: "Toggle wave wrap-up" });
    expect(within(doc).getByRole("navigation", { name: "Breadcrumb" })).toBeTruthy();
    expect(within(doc).getByRole("heading", { name: "Toggle wave wrap-up" })).toBeTruthy();
    expect(within(doc).getByText("3 messages · #11–#14")).toBeTruthy();
    expect(within(doc).getByRole("img", { name: "By You, Diana Taylor" })).toBeTruthy();
  });

  it("reads each message as a row: author, number and the body's own markdown", async () => {
    mountFace();
    await openArtifact();
    const list = screen.getByRole("list", { name: "Messages" });
    const rows = [...list.querySelectorAll<HTMLElement>(":scope > li")];
    expect(rows.map((r) => r.getAttribute("data-artifact-member"))).toEqual(["11", "14"]);
    expect(within(rows[0]).getByText("You")).toBeTruthy();
    expect(within(rows[0]).getByText("#11")).toBeTruthy();
    expect(within(rows[1]).getByText("Diana Taylor")).toBeTruthy();
    expect(within(rows[1]).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "one",
      "two",
    ]);
  });

  it("asks the SINGLE-ARTIFACT arm of the same route", async () => {
    mountFace();
    await openArtifact();
    const card = request.mock.calls.find(
      ([, opts]) => (opts?.query as { artifact?: string } | undefined)?.artifact
    );
    expect(card?.[0]).toBe(`/api/channels/${CHANNEL}/artifacts`);
    expect((card?.[1]?.query as { artifact: string }).artifact).toBe(ART);
  });

  it("jumps to a message in its own thread, and prints numbers as text with no jump", async () => {
    const onJump = vi.fn();
    mountFace(onJump);
    await openArtifact();
    fireEvent.click(screen.getByRole("button", { name: "Show #14 in the transcript" }));
    expect(onJump).toHaveBeenCalledWith("t-x", "m-14");
    fireEvent.click(screen.getByRole("button", { name: "Show #11 in the transcript" }));
    expect(onJump).toHaveBeenLastCalledWith(null, "m-11");

    cleanup();
    mountFace();
    await openArtifact();
    expect(screen.queryByRole("button", { name: /in the transcript/ })).toBeNull();
    expect(screen.getByText("#14")).toBeTruthy();
  });

  it("offers nothing that writes", async () => {
    mountFace();
    await openArtifact();
    const labels = screen.getAllByRole("button").map((b) => (b.textContent ?? "").toLowerCase());
    for (const forbidden of ["dissolve", "remove", "delete", "new thread", "fold"]) {
      expect(labels.some((l) => l.includes(forbidden))).toBe(false);
    }
  });

  it("says so when the member ceiling cut the run", async () => {
    lane.card = { ...(lane.card as object), truncated: true };
    mountFace();
    await openArtifact();
    expect(screen.getByText(ARTIFACT_MESSAGES_CLIPPED_NOTE)).toBeTruthy();
  });

  it("🔒 says so when the members arm refuses, and keeps the header", async () => {
    lane.card = new Error("403");
    mountFace();
    fireEvent.click(await screen.findByRole("button", { name: "Open Toggle wave wrap-up" }));
    expect(await screen.findByText(ARTIFACT_MESSAGES_UNREAD_NOTE)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Toggle wave wrap-up" })).toBeTruthy();
  });

  it("goes back to the list through the breadcrumb", async () => {
    mountFace();
    await openArtifact();
    fireEvent.click(screen.getByRole("button", { name: "Back to artifacts" }));
    expect(await screen.findByText("3 messages · #11–#14")).toBeTruthy();
    expect(screen.queryByText("first of the run")).toBeNull();
  });
});
