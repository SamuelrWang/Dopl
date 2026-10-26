// @vitest-environment jsdom
/**
 * The session's tool profile on the agent header and the agent card (2026-10-22). Main reports
 * `profileLabel` (`main/tool-profiles.js › profileLabel`); absent renders nothing, never a guess.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";

vi.mock("@/features/agent-identities/hooks/use-agent-identities", () => ({
  useAgentIdentities: () => ({ identities: [], loading: false, error: null, refetch: () => {} }),
}));

import { AgentsTab } from "./agents-tab";
import { ChannelsAgentPanel } from "./agent-panel";
import { agentKey, agentProfileLabel } from "./agents-model";
import { CHANNEL_ID, ME } from "./test-fixtures";

afterEach(() => {
  cleanup();
});

function summary(over: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    sessionId: "s-1",
    channelId: CHANNEL_ID,
    threadId: "t-1",
    name: "flint",
    state: "working",
    channelName: "Website",
    threadTitle: "UI-kit design",
    ...over,
  };
}

const noop = () => {};

describe("agentProfileLabel", () => {
  it("reads main's label, and says nothing when none was reported", () => {
    expect(agentProfileLabel(summary({ profileLabel: "Read-only" }))).toBe("Read-only");
    expect(agentProfileLabel(summary({ profileLabel: "  " }))).toBeNull();
    expect(agentProfileLabel(summary({ profileLabel: null }))).toBeNull();
    expect(agentProfileLabel(summary())).toBeNull();
  });
});

describe("the profile on the agent header and card", () => {
  it("the agent view's header shows the session's profile", () => {
    const agent = summary({ profileLabel: "Read-only" });
    render(
      <ChannelsAgentPanel
        openAgent={agentKey(agent)}
        sessions={[agent]}
        messages={[]}
        currentUserId={ME}
        onClose={noop}
      />
    );
    expect(screen.getByText("· Read-only")).toBeTruthy();
  });

  it("the agent card shows it too", () => {
    render(
      <AgentsTab
        sessions={[summary({ profileLabel: "Shared-channel" })]}
        channelId={CHANNEL_ID}
        openAgent={null}
        onOpenAgent={noop}
      />
    );
    expect(screen.getByText("· Shared-channel")).toBeTruthy();
  });

  it("an unreported profile renders nothing", () => {
    render(
      <AgentsTab sessions={[summary()]} channelId={CHANNEL_ID} openAgent={null} onOpenAgent={noop} />
    );
    expect(screen.queryByText(/Read-only|Dopl-only|Shared-channel|Full-access/)).toBeNull();
  });
});
