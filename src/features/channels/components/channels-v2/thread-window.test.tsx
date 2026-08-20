// @vitest-environment jsdom
/**
 * THE POP-OUT THREAD WINDOW'S SURFACE (Samuel, 2026-08-19).
 *
 * ⚠ WHAT THIS FILE IS FOR IS THE ABSENCES. The pop-out shipped landing on the
 * FULL channels page, so a window opened to read one exchange arrived carrying
 * the app sidebar, the channels tree and the info panel — and every one of those
 * is a thing a screenshot shows and a test that only checks "the transcript
 * renders" never would. So the assertions are: the thread's own rows, the thread
 * title as the whole header, and NO chrome.
 *
 * ⚠ AND THE ONE INVISIBLE REQUIREMENT: THIS WINDOW IS A LIVE SURFACE. It must
 * register the realtime doorbell through the same `useChannelsV2Live` the
 * three-column core takes, or it renders a transcript that quietly stops
 * updating while the main window's keeps going (INVARIANTS §7, §11).
 *
 * `composer.tsx` is mocked: it is a write surface with its own mutation stack
 * and its own suite, and what is under test here is the window.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CHANNEL_ID, ME, PEER, member, message, thread, WS } from "./test-fixtures";

interface LiveArgs {
  workspaceId: string;
  refetchAll: () => void;
  refetchMembers: () => void;
}
const { live } = vi.hoisted(() => ({
  live: vi.fn<
    (opts: {
      workspaceId: string;
      refetchAll: () => void;
      refetchMembers: () => void;
    }) => { gate: object }
  >(() => ({ gate: {} })),
}));

vi.mock("./composer", () => ({ ChannelsV2Composer: () => null }));
vi.mock("./live", () => ({ useChannelsV2Live: live }));

const THREAD = thread({ id: "t-1", title: "Ship the release" });

vi.mock("../../hooks/use-channel-messages", () => ({
  useChannelMessages: () => ({
    messages: [
      message({
        id: "m-1",
        seq: 1,
        authorUserId: PEER,
        body: "in the thread",
        metadata: { taskId: "t-1" },
      }),
      message({ id: "m-2", seq: 2, body: "channel-level, not in the thread" }),
    ],
    loading: false,
    refetch: () => {},
  }),
}));
vi.mock("../../hooks/use-channel-members", () => ({
  useChannelMembers: () => ({
    members: [member({ userId: ME }), member({ userId: PEER, role: "member" })],
    refetch: () => {},
  }),
}));

const threadsState = { threads: [THREAD], loading: false };
vi.mock("../../hooks/use-channel-threads", () => ({
  useChannelThreads: () => ({ ...threadsState, truncated: false, refetch: () => {} }),
}));

// The awaiting-strip's diet (2026-08-20): consent reads/writes are real hooks
// on the window now — mocked here like the other reads, no QueryClient in this
// suite. The strip's own behaviour is pinned in message-pane's suite.
vi.mock("../../hooks/use-consent-inbox", () => ({
  useConsentInbox: () => ({ requests: [], inbound: [], outbound: [] }),
}));
vi.mock("../../hooks/use-channel-preference-writes", () => ({
  useChannelPreferenceWrites: () => ({
    consent: { mutate: () => {}, pending: false },
  }),
}));

import { ChannelsV2ThreadWindow, threadWindowTitle } from "./thread-window";

afterEach(() => {
  cleanup();
  threadsState.threads = [THREAD];
  threadsState.loading = false;
  live.mockClear();
});

function mount(threadId: string | null = "t-1") {
  return render(
    <ChannelsV2ThreadWindow
      workspaceId={WS}
      channelId={CHANNEL_ID}
      threadId={threadId}
      currentUserId={ME}
    />
  );
}

describe("the window shows ONE thread", () => {
  it("renders the thread's own rows, not the channel's", () => {
    mount();
    expect(screen.getByText("in the thread")).toBeTruthy();
    expect(screen.queryByText("channel-level, not in the thread")).toBeNull();
  });

  it("reduces the breadcrumb to the thread's title", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Ship the release" })).toBeTruthy();
    // No crumb trail: there is no channel view in this window to go back to.
    expect(screen.queryByLabelText("Breadcrumb")).toBeNull();
  });

  it("carries NO chrome — that is the whole point of the route", () => {
    mount();
    for (const gone of [
      "Channel info",
      "Bookmark channel",
      "Open as new window",
      "Channel settings",
      "Add members",
    ]) {
      expect(screen.queryByRole("button", { name: gone })).toBeNull();
    }
    // …and no tab row, which is what the info panel would bring with it.
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });
});

describe("the window is a LIVE surface", () => {
  it("registers the realtime doorbell for its workspace", () => {
    // Not decoration: a pop-out is a registered app window and `ui-sync` fans
    // out to it, but only a surface that SUBSCRIBED sees the bell.
    mount();
    expect(live).toHaveBeenCalledTimes(1);
    expect(live.mock.calls[0][0]).toMatchObject<Partial<LiveArgs>>({ workspaceId: WS });
  });

  it("hands the composer the SAME gate the reads registered", () => {
    // One `useRefetchGate` per live surface (INVARIANTS §7/§8) — the hook that
    // owns the subscription is the one that owns the gate.
    mount();
    const arg: LiveArgs = live.mock.calls[0][0];
    expect(typeof arg.refetchAll).toBe("function");
  });
});

describe("a thread this window cannot show", () => {
  it("says so rather than rendering an empty transcript", () => {
    threadsState.threads = [];
    mount("t-gone");
    expect(screen.getByText("That thread isn't here")).toBeTruthy();
  });

  it("waits for the thread list before claiming the thread is missing", () => {
    // "No such thread" is a claim about a FINISHED read — the same rule the
    // message pane's scroll-target notice keeps.
    threadsState.threads = [];
    threadsState.loading = true;
    mount("t-1");
    expect(screen.queryByText("That thread isn't here")).toBeNull();
  });

  it("names nothing when the window was landed with no thread", () => {
    mount(null);
    expect(screen.getByText("That thread isn't here")).toBeTruthy();
  });
});

describe("the window's name", () => {
  it("is Dopl and the thread, set from the renderer", () => {
    // Main creates the window from three ids and has no title to set; Electron
    // copies `document.title` onto the window, so this IS the window title.
    mount();
    expect(document.title).toBe("Dopl — Ship the release");
  });

  it("falls back to the bare product name with no thread loaded", () => {
    expect(threadWindowTitle(null)).toBe("Dopl");
  });
});
