/**
 * Home-surface methods (class side: `client-home.ts`), both on `/api/channels?scope=account` —
 * user-scoped (`withUserAuth`, no `X-Workspace-Id`); the param is sent because an absent `scope`
 * means `container`. No link mint/revoke/claim is bound: those are `sessionOnly` (they reach a person).
 */

import type { DoplTransport } from "./transport.js";
import type {
  HomeChannelCreateResult,
  HomeChannelsPayload,
} from "./home-types.js";

/**
 * Every channel the caller is in, every container kind (tell them apart by `Channel.container`).
 * Not narrowed here: the container lock is per MCP connection
 * (`packages/mcp-server/src/workspace-directory.ts › narrowToLock`), and a reader that skips it
 * rebuilds the enumeration the lock denies.
 */
export async function getHomeChannels(
  t: DoplTransport
): Promise<HomeChannelsPayload> {
  return t.request<HomeChannelsPayload>("/api/channels?scope=account", {
    toolName: "home_list_channels",
  });
}

/** Create a home channel (a solo container plus one private channel). Reachable by an agent token:
 *  a room you are alone in reaches no other person. */
export async function createHomeChannel(
  t: DoplTransport,
  input: { name: string }
): Promise<HomeChannelCreateResult> {
  return t.request<HomeChannelCreateResult>("/api/channels?scope=account", {
    method: "POST",
    body: input,
    toolName: "home_create_channel",
  });
}
