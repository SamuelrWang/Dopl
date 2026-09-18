// @vitest-environment jsdom
/**
 * **THE WORKSPACE CHANNELS PAGE OFFERS THE ARTIFACTS FACE** (Samuel's ruling
 * R-16, 2026-09-17, after F-712; the toggle everywhere is R-17).
 *
 * ⚠ PINNED AT THE PAGE, not at `ThreadsTab` or `ArtifactsTab`: both have always
 * drawn whatever a host asked for, and the only thing R-16 changed is what
 * `channels-core.tsx` asks for. A test mounted lower would have been green
 * before the ruling and after it.
 * ⚠ THE READ IS STUBBED, not the face — what the list renders from a payload is
 * `artifacts-tab.test.tsx`'s subject.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { channel, member, ME, WS } from "./test-fixtures";
import { ARTIFACTS_FACE_LABEL, THREADS_FACE_LABEL } from "./threads-tab";

const ARTIFACT_NAME = "Rollout run";

vi.mock("../hooks/use-channels", () => ({
  useChannels: () => ({ channels: [channel()], loading: false, refetch: () => {} }),
}));
vi.mock("../hooks/use-channel-messages", () => ({
  useChannelMessages: () => ({ messages: [], loading: false, refetch: () => {} }),
}));
vi.mock("../hooks/use-channel-members", () => ({
  useChannelMembers: () => ({ members: [member()], refetch: () => {} }),
}));
vi.mock("../hooks/use-channel-threads", () => ({
  useChannelThreads: () => ({
    threads: [],
    truncated: false,
    loading: false,
    refetch: () => {},
  }),
}));
vi.mock("../hooks/use-channel-mentions", () => ({
  useChannelMentions: () => ({
    mentions: [],
    truncated: false,
    loading: false,
    refetch: () => {},
  }),
}));
vi.mock("../hooks/use-consent-inbox", () => ({
  useConsentInbox: () => ({ requests: [], outbound: [] }),
}));
vi.mock("../hooks/use-mention-writes", () => ({
  useMentionWrites: () => ({ markRead: { mutate: () => {} } }),
}));
vi.mock("../hooks/use-channel-preference-writes", () => ({
  useChannelPreferenceWrites: () => ({
    favorite: { mutate: () => {} },
    consent: { mutate: () => {}, pending: false },
    unaddressedResponder: { mutate: () => {}, pending: false },
  }),
}));
vi.mock("../hooks/use-escalation-writes", () => ({
  useEscalationWrites: () => ({
    answer: { mutate: () => {}, pending: false },
    pending: false,
  }),
}));
vi.mock("../hooks/use-channel-header-writes", () => ({
  useChannelHeaderWrite: () => ({
    saveName: () => {},
    saveTopic: () => {},
    pending: false,
  }),
}));
vi.mock("../hooks/use-channel-info-card-writes", () => ({
  useChannelInfoCardWrite: () => ({ save: () => {}, pending: false }),
}));
vi.mock("../client/realtime", () => ({
  useChannelsRealtime: () => {},
  usePresenceRealtime: () => {},
}));
vi.mock("@/shared/hooks/use-api-mutation", () => ({
  useRefetchGate: () => ({ signal: () => {}, gate: {} }),
}));
vi.mock("./use-agents-panel", () => ({
  PEER_SESSIONS_POLL_MS: 30_000,
  useAgentsPanel: () => ({
    peerSessions: [],
    canLaunch: false,
    launchBusy: false,
    launchAgent: async () => {},
  }),
}));

// ⚠ THE WHOLE POINT OF THE FLAG IS THAT THESE READS MOUNT WITH THE FACE, so the
// spy below is also the assertion that an unopened face asks for nothing.
const listRead = vi.fn();
vi.mock("../hooks/use-channel-artifacts", () => ({
  useChannelArtifacts: (channelId: string | null) => {
    listRead(channelId);
    return {
      artifacts: [
        {
          artifact: {
            id: "af-1",
            channelId: "ch-1",
            workspaceId: WS,
            name: ARTIFACT_NAME,
            summary: "What shipped",
            createdBy: ME,
            createdByAgent: null,
            dissolvedAt: null,
            createdAt: "2026-09-16T10:00:00.000Z",
          },
          count: 3,
          firstSeq: 10,
          lastSeq: 12,
        },
      ],
      truncated: false,
      loading: false,
      error: null,
      refetch: () => {},
    };
  },
  useChannelArtifact: () => ({
    messages: [],
    truncated: false,
    loading: false,
    error: null,
  }),
}));

vi.mock("./sidebar", () => ({ ChannelsSidebar: () => null }));
vi.mock("./message-pane", () => ({ ChannelsMessagePane: () => null }));
vi.mock("./channel-manage", () => ({
  ChannelsManageActions: () => null,
  ChannelsCreateDialogs: () => null,
}));
vi.mock("./overlays", () => ({ ChannelsOverlays: () => null }));

// Imported AFTER the mock declarations for readability; `vi.mock` is hoisted.
import { ChannelsCore } from "./channels-core";

const TestLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href}>{children}</a>
);

function renderCore() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ChannelsCore
        workspaceId={WS}
        workspaceSlug="acme"
        currentUserId={ME}
        role="owner"
        Link={TestLink}
      />
    </QueryClientProvider>
  );
}

/** The column opens on Info; the toggle lives in the Threads tab's action row.
 *  ⚠ `find*` throughout — the body rides `Crossfade`, so the new face lands a
 *  frame later (`info-panel.test.tsx` uses the same await). */
function openThreadsTab() {
  fireEvent.click(screen.getByRole("tab", { name: /^Threads/ }));
}

afterEach(() => {
  cleanup();
  listRead.mockClear();
});

describe("the workspace channels page's artifacts face", () => {
  it("draws the Threads↔Artifacts toggle (R-17: a toggle, never a fifth tab)", async () => {
    renderCore();
    openThreadsTab();
    expect(
      await screen.findByRole("button", { name: ARTIFACTS_FACE_LABEL })
    ).toBeTruthy();
    // ⚠ FOUR TABS, STILL — the face shares the Threads slot, so nothing was
    // added to the row's width budget (F-340).
    expect(screen.queryByRole("tab", { name: ARTIFACTS_FACE_LABEL })).toBeNull();
  });

  it("renders the channel's artifact list once the face is on", async () => {
    renderCore();
    openThreadsTab();
    const toggle = await screen.findByRole("button", {
      name: ARTIFACTS_FACE_LABEL,
    });
    expect(listRead).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    expect(await screen.findByText(ARTIFACT_NAME)).toBeTruthy();
    expect(listRead).toHaveBeenCalled();
    // The label names the destination, so on the artifacts face it says Threads.
    expect(
      screen.getByRole("button", { name: THREADS_FACE_LABEL })
    ).toBeTruthy();
  });
});
