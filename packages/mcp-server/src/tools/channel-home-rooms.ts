/**
 * channel-home-rooms.ts — channels as seen from the HOME SPACE.
 *
 * ⚠ **HOME HOLDS NO CHANNELS** (1.37.1): every home channel is its own `kind='link'`
 * container. So a connection that names no container (it lands in `home`) listed
 * nothing and 404'd every channel ref — and the list told the agent to create a
 * channel, which mints a duplicate. This module gives that connection the same set
 * /home's sidebar shows, from the same read (`getHomeChannels` = `GET
 * /api/channels?scope=account`, filtered to `link` containers), and routes a channel
 * ref onto the container that owns it.
 *
 * 🔒 Only when `landsInHomeSpace` says so: a container-LOCKED session never stands
 * in Home, so this cannot enumerate the operator's other rooms (B3). No row is
 * copied or re-homed — it only addresses the channel where it already lives
 * (two-destination model).
 */

import type { Channel, DoplClient } from "@dopl/client";
import { workspaceContext } from "@dopl/client";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { containerKind } from "../workspace-directory.js";
import { landsInHomeSpace } from "./container-destination.js";
import { callRef } from "../call-ref.js";
import { formatChannelLine } from "./channel-render";
import { err, ok, type ToolResponse } from "./respond";

export interface HomeRooms {
  /** Channels in the caller's home-channel (`link`) containers, server order. */
  home: Channel[];
  /** Workspaces holding channels the caller is in: the `container=` address + count. */
  workspaces: { address: string; count: number }[];
  truncated: boolean;
}

/**
 * The account list, split for a Home-space caller; `null` when this call does not
 * land in Home (the ordinary container list answers it).
 */
export async function homeRooms(
  client: DoplClient,
  directory: WorkspaceDirectory | undefined,
): Promise<HomeRooms | null> {
  if (!directory || !(await landsInHomeSpace(client, directory))) return null;
  const payload = await client.getHomeChannels();
  const channels = payload.channels ?? [];
  const home = channels.filter((c) => c.container?.kind === "link");
  const counts = new Map<string, number>();
  for (const c of channels) {
    if (c.container?.kind !== "standard") continue;
    counts.set(c.container.id, (counts.get(c.container.id) ?? 0) + 1);
  }
  const rows = (await directory.getWorkspaceList().catch(() => [])).filter(
    (w) => containerKind(w) === "workspace",
  );
  const slugUses = new Map<string, number>();
  for (const w of rows) slugUses.set(w.slug, (slugUses.get(w.slug) ?? 0) + 1);
  const workspaces = [...counts].map(([id, count]) => {
    const row = rows.find((w) => w.id === id);
    // A slug two rows share is refused as an address (F-719), so print the id.
    const address = row && slugUses.get(row.slug) === 1 ? row.slug : id;
    return { address, count };
  });
  return { home, workspaces, truncated: payload.truncated ?? false };
}

/**
 * Run a channel op on the home-channel container that owns `ref`, when this call
 * lands in Home. Home itself holds no channel, so without this every ref 404s
 * there. An id or unique slug routes; a slug two home channels share is refused
 * naming both ids; no match runs unchanged (the route's own not-found answers).
 */
export async function routeHomeChannel(
  client: DoplClient,
  directory: WorkspaceDirectory,
  ref: string | undefined,
  run: () => Promise<ToolResponse>,
): Promise<ToolResponse> {
  const wanted = ref?.trim();
  if (!wanted || !(await landsInHomeSpace(client, directory))) return run();
  let channels: Channel[];
  try {
    channels = (await client.getHomeChannels()).channels ?? [];
  } catch {
    return run();
  }
  const home = channels.filter((c) => c.container?.kind === "link");
  const byId = home.find((c) => c.id === wanted);
  const matches = byId ? [byId] : home.filter((c) => c.slug === wanted);
  if (matches.length > 1) {
    return err(
      `Channel "${wanted}" names ${matches.length} of your home channels — pass its id instead: ${matches
        .map((c) => `\`${c.id}\``)
        .join(", ")}. Nothing was done.`,
    );
  }
  const owner = matches[0]?.container?.id;
  return owner ? workspaceContext.run(owner, run) : run();
}

/** The list's closing line — how to read, post and wait. One spelling for both lists. */
export function channelListFooter(): string {
  return `\nRead a channel with ${callRef("channel.read", { channel: "<slug|id>" })}; post with ${callRef("channel.send", {}, { form: "op" })}; WAIT for new ones by HOLDING — ${callRef("channel.read", {}, { form: "op" })} with wait_ms, never a timed re-read.`;
}

/** The Home-space list: home channels, then ONE line naming the workspaces that hold more. */
export function formatHomeList({ home, workspaces, truncated }: HomeRooms): ToolResponse {
  if (home.length === 0 && workspaces.length === 0) {
    return ok(
      `No channels yet. Create one with ${callRef("channel.rooms.open", { name: '"..."' })}.`,
    );
  }
  const lines = [
    home.length === 0
      ? `No home channels.`
      : `## Home channels — ${home.length}${truncated ? " (clipped)" : ""}\n`,
  ];
  for (const c of home) lines.push(formatChannelLine(c));
  if (workspaces.length > 0) {
    const named = workspaces.map((w) => `\`${w.address}\` (${w.count})`).join(", ");
    lines.push(`\nWorkspace channels — list with container=<slug>: ${named}.`);
  }
  if (home.length > 0) lines.push(channelListFooter());
  return ok(lines.join("\n"));
}
