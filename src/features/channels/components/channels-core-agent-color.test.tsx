// @vitest-environment jsdom
/**
 * **THE WORKSPACE CHANNELS PAGE'S AGENT PANE CARRIES THE AGENT'S COLOUR** — the
 * regression `overlays.tsx`'s collapse onto `surface-agent-view.tsx` closed
 * (wave 1A, 2026-09-17).
 *
 * ⚠ Nothing was ever red: `ChannelsAgentPanel` defaults `color` to `null` and
 * renders a perfectly good uncoloured banner, so a shipped ruling (2026-09-13,
 * `docs/specs/agent-colors.md`) had simply never rendered on this one host.
 * ⚠ THE ASSERTION IS THE PROP, NOT THE PAINT — what the key resolves to is
 * `agent-colors.ts`'s business and has its own suites.
 * ⚠ PINNED AT THE PAGE, not at `SurfaceAgentView`: that component has always
 * passed `color`, so a test mounted on it would have been green throughout.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { channel, member, ME, WS } from "./test-fixtures";

/** The agent the peer projection says is live here, and the key the SERVER gave
 *  it. ⚠ `name` is the minted instance id on that projection — `live-agents.ts`
 *  carries why the column is spelled that way. */
const AGENT_ID = "ab12cd34";
const AGENT_COLOR = "agent-03";

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

// 🔒 THE SERVER'S PER-CHANNEL ASSIGNMENT, which is the ONLY authority on a
// colour (`live-agents.ts › liveAgentsKey` lets no local row overwrite it). The
// surface folds this into `data.liveAgents`, where `surface-agent-view.tsx`
// looks the open agent up.
vi.mock("./use-agents-panel", () => ({
  PEER_SESSIONS_POLL_MS: 30_000,
  useAgentsPanel: () => ({
    peerSessions: [
      { name: AGENT_ID, displayName: "Bug Reviewer", color: AGENT_COLOR },
    ],
    canLaunch: false,
    launchBusy: false,
    launchAgent: async () => {},
  }),
}));

vi.mock("./sidebar", () => ({ ChannelsSidebar: () => null }));
vi.mock("./message-pane", () => ({ ChannelsMessagePane: () => null }));
vi.mock("./channel-manage", () => ({
  ChannelsManageActions: () => null,
  ChannelsCreateDialogs: () => null,
}));

// The way in: the real Agents tab hands `onOpenAgent` the agent's key, and the
// selection hook is what the overlay reads. A stub with the same one call keeps
// this file about the COLOUR rather than about the tab column.
vi.mock("./info-panel", () => ({
  ChannelsInfoPanel: ({ onOpenAgent }: { onOpenAgent: (id: string) => void }) => (
    <button onClick={() => onOpenAgent(AGENT_ID)}>open agent</button>
  ),
}));

// ⚠ REPORTS ITS `color`, rather than rendering `null` as the sibling suite's
// stub does: a panel that renders nothing cannot say which prop reached it, and
// this prop reaching it is the whole finding.
vi.mock("./agent-panel", () => ({
  ChannelsAgentPanel: ({
    openAgent,
    color,
  }: {
    openAgent: string | null;
    color?: string | null;
  }) =>
    openAgent === null ? null : (
      <div data-testid="agent-pane" data-color={color ?? "none"} />
    ),
}));

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

afterEach(cleanup);

describe("the workspace channels page's agent pane", () => {
  it("hands the pane the colour the server assigned this agent", () => {
    renderCore();
    fireEvent.click(screen.getByText("open agent"));
    expect(screen.getByTestId("agent-pane").getAttribute("data-color")).toBe(
      AGENT_COLOR
    );
  });

  it("renders no pane at all while no agent is open", () => {
    renderCore();
    expect(screen.queryByTestId("agent-pane")).toBeNull();
  });
});
