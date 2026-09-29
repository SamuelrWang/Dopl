/**
 * `dopl_show` — `dopl_channel` op="send" with `kind:"display"` (docs/specs/unified-display.md §4).
 * ONE door: the caller's arguments go to `POST /api/displays` as given (the server validates the
 * blocks, resolves the session channel, routes to channel and/or glasses, holds for `wait`), and
 * the outcome comes back as one fact line (§4.3).
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan (`parity.test.ts`).
 */
import { type DoplClient, type ShowDisplayInput, type ShowDisplayResult } from "@dopl/client";
import { type ToolResponse } from "./respond";
/** What reaches this handler: the legacy send args plus the carried display params. */
export type ShowArgs = Pick<ShowDisplayInput, "target" | "blocks" | "display_id" | "mention" | "wait" | "timeout_sec" | "template" | "data" | "save_as" | "validate_only"> & {
    channel?: string;
    thread?: string;
    client_msg_id?: string;
};
export declare const LEGACY_DISPLAY_REFUSAL = "Refused: displays are dopl_show (granular); nothing was sent.";
export declare function opShow(client: DoplClient, args: ShowArgs): Promise<ToolResponse>;
/** The §4.3 result line(s). */
export declare function showLine(r: ShowDisplayResult): string;
