/**
 * Did this call land in a home channel? One probe shared by `dopl_agent` and `dopl_kb`.
 * A convenience, never the fence (the server's `home-channel-destination.ts` is), so every function fails open to "not known".
 */

import type { DoplClient } from "@dopl/client";
import { workspaceContext } from "@dopl/client";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { apiMessage, err, isApiError, type ToolResponse } from "./respond.js";

/** The server's 400 for "a home channel holds only what is shared into it"; one spelling for both write surfaces. */
export const HOME_CHANNEL_ROW_NOT_SHARED_CODE = "HOME_CHANNEL_ROW_NOT_SHARED";

/** The two destinations as list headings, one table for both surfaces; "Shared in this channel" (the app's wording), never "Public". */
export const DESTINATION_HEADINGS = {
  shared: "Shared in this channel",
  home: "Home shelf — yours, visible in every home channel",
  /** F-735: rows in the retired destination — rendered (never dropped) and labelled so they are not treated as live. */
  legacy: "Legacy — not visible anywhere in the app",
} as const;

/** The server's fence as a refusal in its own sentence; null → the caller rethrows. */
export function homeChannelRowNotShared(e: unknown): ToolResponse | null {
  if (!isApiError(e, 400, HOME_CHANNEL_ROW_NOT_SHARED_CODE)) return null;
  return err(
    `${apiMessage(e) ?? "A home channel holds only what is shared into it."} Pass container="home" to keep it in your home space instead.`,
  );
}

/** The home-channel container this call landed in, or null ("not known"); the per-call ALS override beats the session default. */
export async function resolveHomeChannelContainer(
  client: DoplClient,
  /** Optional: an absent directory means "not known" (null). */
  directory?: WorkspaceDirectory,
): Promise<string | null> {
  if (!directory) return null;
  // The whole probe is inside the try: any throw means "not known".
  try {
    const workspaceId = workspaceContext.getStore() ?? client.getWorkspaceId();
    if (!workspaceId) return null;
    const kinds = await directory.containerKindIndex();
    return kinds.get(workspaceId) === "home_channel" ? workspaceId : null;
  } catch {
    return null;
  }
}

/**
 * Does this call land in the caller's Home space? Unbound and unlocked = yes: the server resolves
 * the caller's Home. Any doubt answers false, and the server's fence then refuses by name.
 */
export async function landsInHomeSpace(
  client: DoplClient,
  directory: WorkspaceDirectory,
): Promise<boolean> {
  try {
    if (directory.lockedWorkspaceId() !== null) return false;
    const workspaceId = workspaceContext.getStore() ?? client.getWorkspaceId();
    if (!workspaceId) return true;
    return (await directory.containerKindIndex()).get(workspaceId) === "home";
  } catch {
    return false;
  }
}

/**
 * The one channel in a home-channel container, or null: two would be unresolvable, never picked.
 * The filter is the positive `container.kind === "link"` plus an exact container id (F-564).
 */
export async function resolveHomeChannelId(
  client: DoplClient,
  containerId: string,
): Promise<string | null> {
  try {
    const { channels } = await client.getHomeChannels();
    const matches = channels.filter(
      (c) => c.workspaceId === containerId && c.container?.kind === "link",
    );
    return matches.length === 1 ? matches[0].id : null;
  } catch {
    return null;
  }
}

/** Destination 2's channel for the knowledge write lane, or `undefined` = send no grant (the server then refuses by name). */
export async function resolveChannelShareTarget(
  client: DoplClient,
  directory?: WorkspaceDirectory,
): Promise<string | undefined> {
  const container = await resolveHomeChannelContainer(client, directory);
  if (!container) return undefined;
  return (await resolveHomeChannelId(client, container)) ?? undefined;
}
