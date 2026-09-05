// @vitest-environment jsdom
/**
 * THE **WEB** CHANNEL PAGE — one column, five faces behind a header dropdown
 * (Samuel, 2026-09-04).
 *
 * ⚠ WHAT THIS FILE IS FOR IS THE THINGS A SCREENSHOT CANNOT SHOW, and on this
 * change that is most of it: that the tab COLUMN is not merely closed but not
 * rendered (a closed column still reserves and still slides), that the option
 * list is exactly the five faces with NO Knowledge among them, that an agent box
 * opens into the main area and the dropdown then names it, and that the choice
 * is in the URL rather than in component state.
 *
 * ⚠ THE DESKTOP'S TWO-COLUMN LAYOUT IS THE CONTROL, and it is pinned in
 * `channel-surface.test.tsx` (same mounts, no `webView`). The one assertion
 * kept here is the NEGATIVE: no dropdown on that side.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import {
  channel,
  member,
  message,
  thread,
  CHANNEL_ID,
  ME,
  PEER,
  WS,
} from "./test-fixtures";
import { parseChannelWebView } from "./use-channel-web-view";

vi.mock("./live", () => ({ useChannelsV2Live: () => ({ gate: {} }) }));
vi.mock("./composer", () => ({
  ChannelsV2Composer: () => <div data-testid="composer" />,
}));
vi.mock("./settings-agent", () => ({
  ChannelAgentSettings: () => <div data-testid="agent-settings" />,
}));
vi.mock("../invite-dialog", () => ({
  InviteDialog: () => <div data-testid="invite-dialog" />,
}));
vi.mock("../go-public-dialog", () => ({
  GoPublicDialog: () => null,
  needsGoPublicConfirm: () => false,
}));
vi.mock("../../hooks/use-channel-messages", () => ({
  useChannelMessages: () => ({
    messages: [message({ id: "m-1", seq: 1, body: "on the record" })],
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
vi.mock("../../hooks/use-channel-threads", () => ({
  useChannelThreads: () => ({
    threads: [thread()],
    truncated: false,
    loading: false,
    refetch: () => {},
  }),
}));
vi.mock("../../hooks/use-channel-mentions", () => ({
  useChannelMentions: () => ({
    mentions: [],
    truncated: false,
    loading: false,
    refetch: () => {},
  }),
}));
vi.mock("../../hooks/use-consent-inbox", () => ({
  useConsentInbox: () => ({ requests: [], outbound: [], refetch: () => {} }),
}));
vi.mock("../../hooks/use-mention-writes", () => ({
  useMentionWrites: () => ({ markRead: { mutate: () => {} }, pending: false }),
}));
vi.mock("../../hooks/use-channel-preference-writes", () => ({
  useChannelPreferenceWrites: () => ({
    favorite: { mutate: () => {} },
    consent: { mutate: () => {}, pending: false },
    toolProfile: { mutate: () => {}, pending: false },
  }),
}));
vi.mock("../../hooks/use-channel-lifecycle-writes", () => ({
  useChannelLifecycleWrites: () => ({
    toggleArchive: () => {},
    toggleVisibility: () => {},
    remove: () => {},
    join: () => {},
    leave: () => {},
  }),
}));
vi.mock("./use-agents-panel", () => ({
  PEER_SESSIONS_POLL_MS: 30_000,
  useAgentsPanel: () => ({
    peerSessions: [],
    canLaunch: false,
    launchBusy: false,
    launchError: null,
    launchAgent: async () => ({ ok: true }),
    approveTemplate: async () => ({ ok: true }),
    refetch: () => {},
  }),
}));

/** ⚠ THE AGENT BOXES NEED A FEED. `null` is the "no desktop app" branch, which
 *  renders copy instead of cards — a different assertion from the one below. */
const SESSION: DesktopSessionSummary = {
  sessionId: "s-1",
  channelId: CHANNEL_ID,
  taskId: "t-1",
  agentId: "ab12cd34",
  name: "flint",
  displayName: "Scout",
  state: "working",
  channelName: "Website",
  threadTitle: "UI-kit design",
};
vi.mock("./use-desktop-sessions", () => ({
  useDesktopSessions: () => ({ sessions: [SESSION], refresh: () => {} }),
}));

// Imported AFTER the mock declarations for readability; `vi.mock` is hoisted.
import { StandaloneChannelSurface } from "./channel-surface-standalone";
import { useChannelWebView } from "./use-channel-web-view";

const CHANNEL = channel();

/** The web host in miniature: the hook that owns the URL, handed down as a prop
 *  exactly as `src/app/c/[workspaceId]/guest-channel.tsx` hands it down. */
function WebHost() {
  const webView = useChannelWebView();
  return (
    <StandaloneChannelSurface
      workspaceId={WS}
      workspaceSlug="acme"
      channel={CHANNEL}
      currentUserId={ME}
      webView={webView}
    />
  );
}

function mountWeb() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <WebHost />
    </QueryClientProvider>
  );
}

/**
 * Open the header dropdown and pick a face by its visible label.
 *
 * ⚠ AWAITED, because the URL is the store: the pick writes the hash and the
 * browser (jsdom included) delivers `hashchange` on the NEXT task, so the repaint
 * is one tick behind the click by construction. Asserting synchronously here
 * would be asserting on the frame before the navigation.
 */
async function pickFace(label: string) {
  fireEvent.click(screen.getByRole("button", { name: "Channel view" }));
  fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(label) }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Channel view" }).textContent
    ).toContain(label)
  );
}

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("the web channel page — one column", () => {
  it("gives the chat area the whole page: no tab column, open or closing", () => {
    mountWeb();
    expect(screen.getByText("on the record")).toBeTruthy();
    // ⚠ NOT `toBeVisible` — a CLOSED column is still in the DOM on the desktop
    // and still reserves its slide shell. The assertion is that neither exists.
    expect(screen.queryByLabelText("Channel info")).toBeNull();
    expect(document.querySelector(".channel-info-slide")).toBeNull();
  });

  it("replaces the pane toggle with the dropdown, in the same spot", () => {
    mountWeb();
    // The `PanelRight` toggle is addressed by this name in three other suites.
    expect(screen.queryByRole("button", { name: "Channel info" })).toBeNull();
    const trigger = screen.getByRole("button", { name: "Channel view" });
    expect(trigger.textContent).toContain("Channel");
    // Same header, same right-hand slot as the toggle it replaced.
    expect(trigger.closest("header")).toBeTruthy();
  });

  it("lists Channel · Info · Threads · Agents · Settings, and NO Knowledge", () => {
    mountWeb();
    fireEvent.click(screen.getByRole("button", { name: "Channel view" }));
    const labels = screen
      .getAllByRole("menuitem")
      .map((el) => el.textContent?.trim());
    expect(labels).toEqual(["Channel", "Info", "Threads", "Agents", "Settings"]);
    // 🔒 Samuel, 2026-09-04: "There should be no Knowledge tab at all for the web."
    expect(labels.some((l) => l?.includes("Knowledge"))).toBe(false);
  });

  it("defaults to Channel — the transcript, with no hash in the URL", () => {
    mountWeb();
    expect(window.location.hash).toBe("");
    expect(screen.getByText("on the record")).toBeTruthy();
  });

  it("shows Info as the MAIN AREA, not as a pane beside the chat", async () => {
    mountWeb();
    await pickFace("Info");
    expect(screen.getByText("Channel info")).toBeTruthy();
    // The transcript is REPLACED, which is the whole point of one column.
    expect(screen.queryByText("on the record")).toBeNull();
    expect(document.querySelector(".channel-info-slide")).toBeNull();
  });

  it("shows Threads as the main area", async () => {
    mountWeb();
    await pickFace("Threads");
    expect(screen.getByText("UI-kit design")).toBeTruthy();
    expect(screen.queryByText("on the record")).toBeNull();
  });
});

/**
 * 🔒 **THE AGENT BOXES, AND THE WAY BACK (Samuel, 2026-09-04).** *"I should be
 * able to see all of the agent boxes … and that would replace the channel. I can
 * toggle and switch between those on mobile."* The cards are the desktop app's
 * own (`agents-tab.tsx` → `agents-tab-cards.tsx`), rendered at full width.
 */
describe("the web channel page — Agents", () => {
  it("replaces the chat with the desktop's agent boxes", async () => {
    mountWeb();
    await pickFace("Agents");
    expect(screen.getByText("Scout")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
    expect(screen.queryByText("on the record")).toBeNull();
  });

  it("opens one agent into the main area, and the dropdown then NAMES it", async () => {
    mountWeb();
    await pickFace("Agents");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByLabelText("Agent view")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Channel view" }).textContent
    ).toContain("Scout");
  });

  it("gets back to the conversation from that same dropdown — no other nav", async () => {
    mountWeb();
    await pickFace("Agents");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await pickFace("Channel");
    expect(screen.getByText("on the record")).toBeTruthy();
    expect(screen.queryByLabelText("Agent view")).toBeNull();
  });
});

/**
 * 🔒 **THE CHOICE IS IN THE URL, NOT IN STATE.** A phone reload or a back
 * gesture that dropped the reader back onto the transcript would make the
 * dropdown feel like it forgot — and a component `useState` cannot survive
 * either. The hash is the store; `use-channel-web-view.ts` owns the parse.
 */
describe("the web channel page — the URL keeps the face", () => {
  it("writes the face into the hash when one is picked", async () => {
    mountWeb();
    await pickFace("Threads");
    expect(window.location.hash).toBe("#view=threads");
  });

  it("reads the face back out of the hash on mount — a reload", () => {
    window.location.hash = "view=agents";
    mountWeb();
    expect(screen.getByText("Scout")).toBeTruthy();
    expect(screen.queryByText("on the record")).toBeNull();
  });

  it("follows the hash changing under it — the back gesture", async () => {
    mountWeb();
    await pickFace("Info");
    expect(screen.getByText("Channel info")).toBeTruthy();
    window.location.hash = "view=channel";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(await screen.findByText("on the record")).toBeTruthy();
  });

  it("parses anything unrecognised as the conversation", () => {
    expect(parseChannelWebView("")).toBe("channel");
    expect(parseChannelWebView("#view=knowledge")).toBe("channel");
    expect(parseChannelWebView("#view=threads")).toBe("threads");
  });
});

/** 🔒 THE DESKTOP IS UNTOUCHED — no `webView`, no dropdown, and the tab column
 *  it belongs to is still there (`channel-surface.test.tsx` pins the rest). */
describe("the desktop's two columns", () => {
  it("keeps the tab column and grows no dropdown", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <StandaloneChannelSurface
          workspaceId={WS}
          workspaceSlug="acme"
          channel={CHANNEL}
          currentUserId={ME}
        />
      </QueryClientProvider>
    );
    expect(screen.getByRole("button", { name: "Channel info" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Channel view" })).toBeNull();
    expect(screen.getByRole("tab", { name: /^Info/ })).toBeTruthy();
  });
});
