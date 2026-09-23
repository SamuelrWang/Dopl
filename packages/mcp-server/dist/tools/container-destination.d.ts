/**
 * Did this call land in a home channel? One probe shared by `dopl_agent` and `dopl_kb`.
 * A convenience, never the fence (the server's `home-channel-destination.ts` is), so every function fails open to "not known".
 */
import type { DoplClient } from "@dopl/client";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { type ToolResponse } from "./respond.js";
/** The server's 400 for "a home channel holds only what is shared into it"; one spelling for both write surfaces. */
export declare const HOME_CHANNEL_ROW_NOT_SHARED_CODE = "HOME_CHANNEL_ROW_NOT_SHARED";
/** The two destinations as list headings, one table for both surfaces; "Shared in this channel" (the app's wording), never "Public". */
export declare const DESTINATION_HEADINGS: {
    readonly shared: "Shared in this channel";
    readonly personal: "Home (personal) — yours, visible in every home channel";
    /** F-735: rows in the retired destination — rendered (never dropped) and labelled so they are not treated as live. */
    readonly legacy: "Legacy — not visible anywhere in the app";
};
/** The server's fence as a refusal in its own sentence; null → the caller rethrows. */
export declare function homeChannelRowNotShared(e: unknown): ToolResponse | null;
/** The home-channel container this call landed in, or null ("not known"); the per-call ALS override beats the session default. */
export declare function resolveHomeChannelContainer(client: DoplClient, 
/** Optional: an absent directory means "not known" (null). */
directory?: WorkspaceDirectory): Promise<string | null>;
/**
 * The one channel in a home-channel container, or null: two would be unresolvable, never picked.
 * The filter is the positive `container.kind === "link"` plus an exact container id (F-564).
 */
export declare function resolveHomeChannelId(client: DoplClient, containerId: string): Promise<string | null>;
/** Destination 2's channel for the knowledge write lane, or `undefined` = send no grant (the server then refuses by name). */
export declare function resolveChannelShareTarget(client: DoplClient, directory?: WorkspaceDirectory): Promise<string | undefined>;
