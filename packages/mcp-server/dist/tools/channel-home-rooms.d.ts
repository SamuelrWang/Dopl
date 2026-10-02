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
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { type ToolResponse } from "./respond";
export interface HomeRooms {
    /** Channels in the caller's home-channel (`link`) containers, server order. */
    home: Channel[];
    /** Workspaces holding channels the caller is in: the `container=` address + count. */
    workspaces: {
        address: string;
        count: number;
    }[];
    truncated: boolean;
}
/**
 * The account list, split for a Home-space caller; `null` when this call does not
 * land in Home (the ordinary container list answers it).
 */
export declare function homeRooms(client: DoplClient, directory: WorkspaceDirectory | undefined): Promise<HomeRooms | null>;
/**
 * Run a channel op on the home-channel container that owns `ref`, when this call
 * lands in Home. Home itself holds no channel, so without this every ref 404s
 * there. An id or unique slug routes; a slug two home channels share is refused
 * naming both ids; no match runs unchanged (the route's own not-found answers).
 */
export declare function routeHomeChannel(client: DoplClient, directory: WorkspaceDirectory, ref: string | undefined, run: () => Promise<ToolResponse>): Promise<ToolResponse>;
/** The list's closing line — how to read, post and wait. One spelling for both lists. */
export declare function channelListFooter(): string;
/** The Home-space list: home channels, then ONE line naming the workspaces that hold more. */
export declare function formatHomeList({ home, workspaces, truncated }: HomeRooms): ToolResponse;
