// @vitest-environment jsdom
/** The effective-permission badge on an agent card: the session's REAL setting, never the channel's. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";

vi.mock("@/features/agent-identities/hooks/use-agent-identities", () => ({
  useAgentIdentities: () => ({ identities: [], loading: false, error: null, refetch: () => {} }),
}));

import { AgentsTab } from "./agents-tab";
import { agentPermissionLabel } from "./agents-model";
import { CHANNEL_ID } from "./test-fixtures";

afterEach(cleanup);

const agent = (over: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary => ({
  sessionId: "s-1",
  channelId: CHANNEL_ID,
  taskId: "t-1",
  name: "flint",
  state: "working",
  channelName: "Website",
  threadTitle: "UI-kit design",
  contextUsed: null,
  contextWindow: null,
  tokensSpent: null,
  startedAt: null,
  lastActivityAt: null,
  ...over,
});

const FULL_CODEX = { runtime: "Codex", level: "full", label: "Full access", setting: "never/danger-full-access" };

describe("agentPermissionLabel", () => {
  it("names the runtime and its own level name", () => {
    expect(agentPermissionLabel(agent({ permission: FULL_CODEX }))).toBe("Codex · Full access");
  });
  it("is null when the desktop reported none (older build, ended agent)", () => {
    expect(agentPermissionLabel(agent())).toBeNull();
    expect(agentPermissionLabel(agent({ permission: null }))).toBeNull();
  });
});

describe("the agent card", () => {
  it("shows the badge with the native words on hover", () => {
    render(<AgentsTab sessions={[agent({ permission: FULL_CODEX })]} channelId={CHANNEL_ID} openAgent={null} onOpenAgent={() => {}} />);
    const badge = screen.getByText(/Codex · Full access/);
    expect(badge.getAttribute("title")).toBe("never/danger-full-access");
  });
  it("renders nothing rather than guessing when none was reported", () => {
    const { container } = render(<AgentsTab sessions={[agent()]} channelId={CHANNEL_ID} openAgent={null} onOpenAgent={() => {}} />);
    expect(container.textContent).not.toMatch(/Full access|Ask for approval|Bypass/);
  });
});
