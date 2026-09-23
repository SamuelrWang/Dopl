// @vitest-environment jsdom
/**
 * 🔒 THE AGENTS TAB'S NEW-AGENT POPUP REACHES THE LAUNCH WITH EVERY ARGUMENT (P6-01).
 *
 * `surface-info-panel.tsx` handed the Agents tab a 3-argument lambda around `launchAgent`, so the
 * popup's pre-assigned id, runtime pick and colour were dropped: an operator who picked Codex got
 * an agent on the channel's runtime with a server-assigned colour, while the dialog showed Codex
 * selected. This drives the real chain — surface → info panel → Agents tab → dialog — and reads
 * the arguments at the launch act itself.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { channel, member, message, thread, ME, PEER, WS } from "./test-fixtures";

const { launchSpy } = vi.hoisted(() => ({
  launchSpy: vi.fn(async (...args: unknown[]) => ({ ok: args.length > 0, agentId: "k3v7d2mq" })),
}));

vi.mock("./live", () => ({ useChannelsLive: () => ({ gate: {} }) }));
vi.mock("./composer", () => ({ ChannelsComposer: () => <div data-testid="composer" /> }));
vi.mock("./settings-agent", () => ({ ChannelAgentSettings: () => null }));
vi.mock("./invite-dialog", () => ({ InviteDialog: () => null }));
vi.mock("./go-public-dialog", () => ({
  GoPublicDialog: () => null,
  needsGoPublicConfirm: () => false,
}));
vi.mock("../hooks/use-channel-messages", () => ({
  useChannelMessages: () => ({
    messages: [message({ id: "m-1", seq: 1, body: "on the record" })],
    loading: false,
    refetch: () => {},
  }),
}));
vi.mock("../hooks/use-channel-members", () => ({
  useChannelMembers: () => ({
    members: [member({ userId: ME }), member({ userId: PEER, role: "member" })],
    refetch: () => {},
  }),
}));
vi.mock("../hooks/use-channel-threads", () => ({
  useChannelThreads: () => ({ threads: [thread()], truncated: false, loading: false, refetch: () => {} }),
}));
vi.mock("../hooks/use-channel-mentions", () => ({
  useChannelMentions: () => ({ mentions: [], truncated: false, loading: false, refetch: () => {} }),
}));
vi.mock("../hooks/use-consent-inbox", () => ({
  useConsentInbox: () => ({ requests: [], outbound: [], refetch: () => {} }),
}));
vi.mock("../hooks/use-mention-writes", () => ({
  useMentionWrites: () => ({ markRead: { mutate: () => {} }, pending: false }),
}));
vi.mock("../hooks/use-channel-preference-writes", () => ({
  useChannelPreferenceWrites: () => ({
    favorite: { mutate: () => {} },
    consent: { mutate: () => {}, pending: false },
    toolProfile: { mutate: () => {}, pending: false },
    unaddressedResponder: { mutate: () => {}, pending: false },
  }),
}));
vi.mock("../hooks/use-channel-lifecycle-writes", () => ({
  useChannelLifecycleWrites: () => ({
    toggleVisibility: () => {},
    remove: () => {},
    join: () => {},
    leave: () => {},
  }),
}));
vi.mock("@/features/agent-identities/hooks/use-agent-identities", () => ({
  useAgentIdentities: () => ({ identities: [], loading: false, error: null, resolved: true, refetch: () => {} }),
}));
// The launch act the page hands down — the whole thing, as `use-launch-controls.ts` brands it.
vi.mock("./use-agents-panel", async () => {
  const { wholeLaunch } = await import("./use-launch-controls");
  return {
    PEER_SESSIONS_POLL_MS: 30_000,
    useAgentsPanel: () => ({
      peerSessions: [],
      canLaunch: true,
      launchBusy: false,
      launchError: null,
      launchAgent: wholeLaunch(launchSpy),
      approveIdentity: async () => ({ ok: true }),
      refetch: () => {},
    }),
  };
});
// Every real adapter reported and connected, the channel on the registry default.
vi.mock("../hooks/use-launch-selection", async () => {
  const harness = await import("../hooks/launch-selection-harness");
  const { REAL_DEFAULT_RUNTIME, REAL_DESCRIPTORS } = await import(
    "../lib/runtime-descriptors-harness"
  );
  return {
    useLaunchSelection: () =>
      harness.launchSelectionStub({
        runtimeSupported: true,
        runtimes: REAL_DESCRIPTORS,
        connected: REAL_DESCRIPTORS.map((d) => d.id),
        connectedKnown: true,
        defaultRuntime: REAL_DEFAULT_RUNTIME,
      }),
  };
});

import { StandaloneChannelSurface } from "./channel-surface-standalone";
import { REAL_DEFAULT_RUNTIME, REAL_DESCRIPTORS } from "../lib/runtime-descriptors-harness";
import { AGENT_COLOR_KEYS } from "../lib/agent-colors";

/** A runtime that is NOT the channel's, so only a forwarded pick can put it on the launch. */
const OTHER = REAL_DESCRIPTORS.find((d) => d.id !== REAL_DEFAULT_RUNTIME)!;
const COLOR = AGENT_COLOR_KEYS[3];

beforeEach(() => {
  launchSpy.mockClear();
  (window as { dopl?: unknown }).dopl = {
    apiRequest: () => Promise.resolve({ status: 200, statusText: "OK", hasBody: false }),
    sessions: {
      summaries: vi.fn().mockResolvedValue({ sessions: [] }),
      onSummaries: vi.fn(() => () => {}),
      launch: vi.fn(),
      mintAgentId: vi.fn().mockResolvedValue({ ok: true, agentId: "k3v7d2mq" }),
      rename: vi.fn().mockResolvedValue({ ok: true }),
      describe: vi.fn().mockResolvedValue({ ok: true }),
    },
  };
});
afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

describe("the Agents tab's New agent popup, through the channel surface", () => {
  it("🔒 hands the launch act the agent id, the picked runtime and the picked colour", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <StandaloneChannelSurface
          workspaceId={WS}
          workspaceSlug="acme"
          channel={channel()}
          currentUserId={ME}
        />
      </QueryClientProvider>
    );
    fireEvent.click(screen.getByRole("tab", { name: /^Agents/ }));
    fireEvent.click(await screen.findByRole("button", { name: "New agent" }));
    const dialog = await screen.findByRole("dialog", { name: "New agent" });
    const runtimes = within(dialog).getByRole("tablist", { name: "Agent runtime" });
    const pill = Array.from(runtimes.querySelectorAll('[role="tab"]')).find((el) =>
      (el.textContent || "").startsWith(OTHER.label)
    )!;
    fireEvent.click(pill);
    fireEvent.click(within(dialog).getByRole("radio", { name: COLOR }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Launch" }));
    await waitFor(() => expect(launchSpy).toHaveBeenCalledTimes(1));
    const [, , , agentId, runtime, color] = launchSpy.mock.calls[0]!;
    expect(agentId).toBe("k3v7d2mq");
    expect(runtime).toBe(OTHER.id);
    expect(color).toBe(COLOR);
  });
});
