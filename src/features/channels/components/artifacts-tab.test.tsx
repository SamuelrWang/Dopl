// @vitest-environment jsdom
/**
 * THE ARTIFACTS FACE OF THE THREADS PANEL — the toggle, and both view states
 * (Samuel, 2026-09-16).
 *
 * ⚠ **THE TRANSPORT IS MOCKED, NOT THE HOOKS** — this tree's standing rule,
 * and it buys the same thing here: the real path (`/api/channels/<id>/artifacts`),
 * the real `?artifact=<id>` variant and the real cache keys are part of what is
 * under test, because the whole reason this face exists is that the LIST is a
 * server lane rather than a slice of the transcript in hand. A stubbed hook would
 * assert that React renders an array.
 *
 * ⚠ **THE TOGGLE IS TESTED ON `ThreadsTab`, WHERE IT IS DRAWN, AND THE FACE IS
 * TESTED ON `ArtifactsTab`, WHERE IT IS READ.** The flag that joins them is
 * `info-panel.tsx`'s, and the heading flip is pinned in `info-panel.test.tsx`
 * beside the rest of that row — three files, three reasons to change.
 *
 * MUTATION-VERIFY: draw the toggle after the spacer and the left-alignment case
 * fails; keep "New thread" in the artifacts face and the hide case fails; point
 * the list at the transcript's `entries` and the path case fails; drop
 * `truncated` from the face and the clip case fails.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import {
  ARTIFACTS_FACE_LABEL,
  THREADS_FACE_LABEL,
  ThreadsTab,
} from "./threads-tab";
import { indexMembers } from "./view-model";
import { member, message, thread, ME, PEER } from "./test-fixtures";
import type { ChannelFoldedArtifact } from "../types";

const CHANNEL = "44444444-4444-4444-8444-444444444444";
const WS = "33333333-3333-4333-8333-333333333333";
const ART = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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
      summary: "What the wave landed",
      createdBy: ME,
      createdByAgent: null,
      dissolvedAt: null,
      createdAt: "2026-09-16T00:00:00.000Z",
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
    if (!path.endsWith("/artifacts")) {
      throw new Error(`the face asked for an unexpected path: ${path}`);
    }
    const query = (opts?.query ?? {}) as { artifact?: string };
    const body = query.artifact ? lane.card : lane.list;
    if (body === undefined) throw new Error(`no fixture for ${path}`);
    // A fixture that IS an error is the arm refusing — the 403 case below.
    if (body instanceof Error) throw body;
    return body;
  });
  lane = {
    list: { artifacts: [folded()], truncated: false },
    card: {
      messages: [
        message({ id: "m-11", seq: 11, body: "first of the run", authorUserId: ME }),
        message({ id: "m-14", seq: 14, body: "last of the run", authorUserId: PEER }),
      ],
      truncated: false,
    },
  };
});
afterEach(cleanup);

function mountFace() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ArtifactsTab channelId={CHANNEL} workspaceId={WS} index={INDEX} />
    </QueryClientProvider>
  );
}

function renderThreads(
  over: Partial<React.ComponentProps<typeof ThreadsTab>> = {}
) {
  const props: React.ComponentProps<typeof ThreadsTab> = {
    threads: [thread({ id: "t-a", title: "Alpha audit" })],
    truncated: false,
    loading: false,
    index: INDEX,
    openThreadId: null,
    onOpenThread: vi.fn(),
    onNewThread: vi.fn(),
    ...over,
  };
  render(<ThreadsTab {...props} />);
  return props;
}

/* ──────────────────────────────── THE TOGGLE ─────────────────────────────── */

describe("the face toggle", () => {
  /** 🔒 Samuel: the tab sits "on the SAME LINE as the New Thread button,
   *  LEFT-aligned". Both halves, and the ORDER is the left-alignment. */
  it("shares the New thread button's row and comes FIRST in it", () => {
    renderThreads({ onToggleFace: vi.fn() });
    const toggle = screen.getByRole("button", { name: ARTIFACTS_FACE_LABEL });
    const create = screen.getByRole("button", { name: "New thread" });
    expect(toggle.parentElement).toBe(create.parentElement);
    expect(
      toggle.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  /** ⚠ THE LABEL IS WHERE THE PRESS GOES, never where you are. */
  it("reads Artifacts on the thread face and Threads on the artifact face", () => {
    const { rerender } = render(
      <ThreadsTab
        threads={[]}
        truncated={false}
        loading={false}
        index={INDEX}
        openThreadId={null}
        onOpenThread={vi.fn()}
        onNewThread={vi.fn()}
        onToggleFace={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: ARTIFACTS_FACE_LABEL })).toBeTruthy();
    rerender(
      <ThreadsTab
        threads={[]}
        truncated={false}
        loading={false}
        index={INDEX}
        openThreadId={null}
        onOpenThread={vi.fn()}
        onNewThread={vi.fn()}
        onToggleFace={vi.fn()}
        artifactsFace
        artifacts={<p>the artifacts face</p>}
      />
    );
    expect(screen.getByRole("button", { name: THREADS_FACE_LABEL })).toBeTruthy();
  });

  it("asks the panel to flip, and owns no state of its own", () => {
    const onToggleFace = vi.fn();
    renderThreads({ onToggleFace });
    fireEvent.click(screen.getByRole("button", { name: ARTIFACTS_FACE_LABEL }));
    expect(onToggleFace).toHaveBeenCalledTimes(1);
    // ⚠ STILL THE THREAD FACE: the flag is the panel's, so an un-driven rerender
    // must not have switched anything by itself.
    expect(screen.getByText("Alpha audit")).toBeTruthy();
  });

  /** 🔒 A HOST WITHOUT THE CAPABILITY IS UNCHANGED, BYTE FOR BYTE — the workspace
   *  channel page and the guest lane pass no `onToggleFace`. */
  it("is absent where the capability is off", () => {
    renderThreads();
    expect(screen.queryByRole("button", { name: ARTIFACTS_FACE_LABEL })).toBeNull();
    expect(screen.getByRole("button", { name: "New thread" })).toBeTruthy();
  });
});

/* ───────────────────────────── THE TWO VIEW STATES ───────────────────────── */

describe("the thread face", () => {
  it("lists threads and keeps the New thread button", () => {
    renderThreads({ onToggleFace: vi.fn() });
    expect(screen.getByText("Alpha audit")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New thread" })).toBeTruthy();
  });
});

describe("the artifact face", () => {
  /** 🔒 Samuel's approved default: nothing on this face is creatable FROM here. */
  it("HIDES the New thread button and renders the artifacts body instead", () => {
    renderThreads({
      onToggleFace: vi.fn(),
      artifactsFace: true,
      artifacts: <p>the artifacts face</p>,
    });
    expect(screen.queryByRole("button", { name: "New thread" })).toBeNull();
    expect(screen.queryByText("Alpha audit")).toBeNull();
    expect(screen.getByText("the artifacts face")).toBeTruthy();
  });

  /** ⚠ THE CALLBACK IS NOT WITHDRAWN, ONLY THE BUTTON — flipping back restores it
   *  with no re-wiring, which is what makes the hide safe. */
  it("keeps the create reachable again on the way back", () => {
    const onNewThread = vi.fn();
    const { rerender } = render(
      <ThreadsTab
        threads={[]}
        truncated={false}
        loading={false}
        index={INDEX}
        openThreadId={null}
        onOpenThread={vi.fn()}
        onNewThread={onNewThread}
        onToggleFace={vi.fn()}
        artifactsFace
        artifacts={<p>the artifacts face</p>}
      />
    );
    rerender(
      <ThreadsTab
        threads={[]}
        truncated={false}
        loading={false}
        index={INDEX}
        openThreadId={null}
        onOpenThread={vi.fn()}
        onNewThread={onNewThread}
        onToggleFace={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    expect(onNewThread).toHaveBeenCalledTimes(1);
  });
});

/* ─────────────────────────────── THE LIST FACE ───────────────────────────── */

describe("the artifacts list", () => {
  it("lists the CHANNEL's cards, with the name and the span", async () => {
    mountFace();
    expect(await screen.findByText("Toggle wave wrap-up")).toBeTruthy();
    expect(screen.getByText("What the wave landed")).toBeTruthy();
    expect(screen.getByText("3 messages · #11–#14")).toBeTruthy();
  });

  /** 🔒 THE REAL LANE, NOT THE TRANSCRIPT'S PAGE ENVELOPE. A list built off the
   *  loaded window would wear "this channel's artifacts" over whatever the scroll
   *  position bought — the defect this read exists to avoid. */
  it("reads the channel's own artifacts route", async () => {
    mountFace();
    await screen.findByText("Toggle wave wrap-up");
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      `/api/channels/${CHANNEL}/artifacts`,
    ]);
  });

  it("says so when the list CLIPPED, and does not read as an absence", async () => {
    lane.list = { artifacts: [folded()], truncated: true };
    mountFace();
    const note = await screen.findByText(ARTIFACTS_CLIPPED_NOTE);
    expect(note.textContent).toMatch(/up to this list's limit/i);
    expect(note.textContent).not.toMatch(/no artifacts/i);
  });

  it("says how one is made when there are none, because this face makes none", async () => {
    lane.list = { artifacts: [], truncated: false };
    mountFace();
    expect(await screen.findByText(ARTIFACTS_EMPTY_NOTE)).toBeTruthy();
  });

  /** 🔒 A READ THAT REFUSED IS NOT AN EMPTY CHANNEL. Found reviewing wave 2, which
   *  gave this face a second host: both hooks returned an `error` nothing read, so
   *  a 403 — the reader's access went away mid-session — printed "No artifacts in
   *  this channel yet", a claim about the channel made from a failure to ask it.
   *  MUTATION-VERIFY: drop the `error &&` arm and this goes red on the second
   *  assertion while every other case here stays green. */
  it("🔒 says the read FAILED rather than claiming the channel is empty", async () => {
    lane.list = new Error("403");
    mountFace();
    expect(await screen.findByText(ARTIFACTS_UNREAD_NOTE)).toBeTruthy();
    expect(screen.queryByText(ARTIFACTS_EMPTY_NOTE)).toBeNull();
  });
});

/* ─────────────────────────── THE OPENED CARD, READ-ONLY ──────────────────── */

describe("opening one card", () => {
  it("opens the folded run with every member's body, author and seq", async () => {
    mountFace();
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    expect(await screen.findByText("first of the run")).toBeTruthy();
    expect(screen.getByText("last of the run")).toBeTruthy();
    // ⚠ THE TRANSCRIPT'S OWN LABEL RULE — "You" for the viewer, the roster name
    // otherwise (`view-model.ts › labelFor`), asked rather than re-spelled.
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getByText("Diana Taylor")).toBeTruthy();
    expect(screen.getByText("#11")).toBeTruthy();
  });

  it("asks the SINGLE-CARD arm of the same route", async () => {
    mountFace();
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    await screen.findByText("first of the run");
    const card = request.mock.calls.find(
      ([, opts]) => (opts?.query as { artifact?: string } | undefined)?.artifact
    );
    expect(card?.[0]).toBe(`/api/channels/${CHANNEL}/artifacts`);
    expect((card?.[1]?.query as { artifact: string }).artifact).toBe(ART);
  });

  /** ⚠ READ-ONLY IS A PROPERTY OF WHAT IS RENDERED: the opened run mounts no
   *  control that writes — no dissolve, no un-box, no create. */
  it("offers nothing that writes", async () => {
    mountFace();
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    await screen.findByText("first of the run");
    const labels = screen
      .getAllByRole("button")
      .map((b) => (b.textContent ?? "").toLowerCase());
    for (const forbidden of ["dissolve", "remove", "delete", "new thread", "fold"]) {
      expect(labels.some((l) => l.includes(forbidden))).toBe(false);
    }
  });

  /** 🔒 THE CARD'S OWN NUMBERS ARE THE LIST'S AND SURVIVE; the MEMBERS read is what
   *  failed, and a card printing a span over an empty body must say so. */
  it("🔒 says so when the members arm refuses, and keeps the card", async () => {
    lane.card = new Error("403");
    mountFace();
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    expect(await screen.findByText(ARTIFACTS_UNREAD_NOTE)).toBeTruthy();
    expect(screen.getByText("Toggle wave wrap-up")).toBeTruthy();
  });

  it("goes back to the list", async () => {
    mountFace();
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    await screen.findByText("first of the run");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("3 messages · #11–#14")).toBeTruthy();
  });
});
