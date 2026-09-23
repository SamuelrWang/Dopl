// Directive rows and client stubs for the channel launch / agent-op suites; not a *.test.ts (imported, never run), excluded from the package build.

import { vi } from "vitest";
import type { DoplClient, LaunchDirective } from "@dopl/client";
import { opEndAgent, opRenameAgent } from "./channel-ops-agent";
import { opLaunchAgent } from "./channel-ops-launch";

export const CHANNEL = { id: "chan-1", slug: "general", name: "General", visibility: "private" };

/** The full channel row, for suites driven through `registerChannelTool`. */
export const CHANNEL_ROW = {
  ...CHANNEL,
  workspaceId: "ws-1",
  topic: "",
  visibility: "private" as const,
  createdBy: "u1",
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

export const AGENT = "a1b2c3d4";
export const DIRECTIVE_ID = "55555555-5555-5555-5555-555555555555";

/** A pending launch row; the fields it omits stay absent, as on an older server's row. */
export function directive(over: Partial<LaunchDirective> = {}): LaunchDirective {
  return {
    id: DIRECTIVE_ID,
    channelId: CHANNEL.id,
    threadId: null,
    goal: "ship the parser",
    model: null,
    status: "pending",
    identityId: null,
    identityName: null,
    refusalReason: null,
    agentId: null,
    claimedAt: null,
    decidedAt: null,
    expiresAt: "2026-08-22T12:02:00.000Z",
    createdAt: "2026-08-22T12:00:00.000Z",
    ...over,
  } as LaunchDirective;
}

export const launched = (over: Partial<LaunchDirective> = {}): LaunchDirective =>
  directive({ status: "launched", agentId: "abcd1234", ...over });

/** A pending `end` row aimed at {@link AGENT}; pass `kind` for another verb. */
export const agentDirective = (over: Partial<LaunchDirective> = {}): LaunchDirective =>
  directive({
    kind: "end",
    operatorUserId: "user-1",
    goal: null,
    targetAgentId: AGENT,
    targetName: null,
    ...over,
  });

/** A pending `set_agent_mode` row: every posture column present, the echo columns null. */
export const modeDirective = (over: Partial<LaunchDirective> = {}): LaunchDirective =>
  agentDirective({
    kind: "set_agent_mode",
    startToolMode: null,
    startMessageMode: null,
    chain: null,
    targetToolMode: "auto",
    targetMessageMode: null,
    appliedToolMode: null,
    appliedMessageMode: null,
    appliedChain: null,
    ...over,
  });

export function launchClient(over: Record<string, unknown> = {}): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    createLaunchDirective: vi.fn(async () => ({ offline: false, directive: directive() })),
    getLaunchDirective: vi.fn(async () => directive()),
    ...over,
  } as unknown as DoplClient;
}

/** A client whose launch create already answers with this row (no poll needed). */
export const created = (over: Partial<LaunchDirective>): DoplClient =>
  launchClient({
    createLaunchDirective: vi.fn(async () => ({ offline: false, directive: directive(over) })),
  });

/** A client whose launch create stays pending and whose poll answers with this row. */
export const polls = (over: Partial<LaunchDirective>): DoplClient =>
  launchClient({ getLaunchDirective: vi.fn(async () => directive(over)) });

export function agentClient(over: Record<string, unknown> = {}): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    createAgentDirective: vi.fn(async () => ({ offline: false, directive: agentDirective() })),
    getLaunchDirective: vi.fn(async () => agentDirective()),
    ...over,
  } as unknown as DoplClient;
}

/** A client whose agent-op create answers with a settled row, so no hold runs. */
export const settled = (over: Partial<LaunchDirective>, row = agentDirective): DoplClient =>
  agentClient({
    createAgentDirective: vi.fn(async () => ({ offline: false, directive: row(over) })),
  });

export const settledMode = (over: Partial<LaunchDirective>): DoplClient =>
  settled(over, modeDirective);

export const endText = async (c: DoplClient): Promise<string> =>
  (await opEndAgent(c, "general", AGENT, { waitMs: 0 })).content[0].text as string;
export const renameText = async (c: DoplClient, name = "Research"): Promise<string> =>
  (await opRenameAgent(c, "general", AGENT, name, { waitMs: 0 })).content[0].text as string;

// `name` is required: a launch without it measures the missing-param refusal, not the case's subject.
export const launchText = async (
  c: DoplClient,
  opts: Parameters<typeof opLaunchAgent>[2] = {},
): Promise<string> =>
  (await opLaunchAgent(c, "general", { name: "Scout", ...opts })).content[0].text as string;

/** `dopl_channel` args for a launch through the dispatcher. */
export const LAUNCH = {
  op: "manage",
  action: "launch",
  channel: "general",
  name: "Scout",
  body: "ship it",
  wait_ms: 0,
};
