/**
 * `dopl_search`'s six APP-SEARCH groups, rendered: channels, messages, threads,
 * artifacts, members, chats — the popup's own server search (`GET /api/search`), one container.
 *
 * ⚠ EVERY ROW ENDS ON ITS FOLLOW-UP ADDRESS — channel id, `seq`, thread id, artifact id, member id,
 * chat id — so a hit is one call from being read, never a lookup away (hand, don't hunt).
 * ⚠ EVERY VALUE IS DATA another member typed: neutralized through `inlineOr`, highlight tags dropped.
 * ⚠ A MEMBER ROW NEVER CARRIES AN EMAIL (the `rooms.members` rule, INVARIANTS §10): a member with no
 * display name renders by id alone.
 */
import type { AppSearchGroup } from "@dopl/client";
/** The six groups under `heading` markers; a group with no match prints "No matches". */
export declare function appGroupLines(groups: AppSearchGroup[], heading: "##" | "###", opts: {
    searched: boolean;
    skipEmpty: boolean;
    /** False for a home space or home channel, where the app does not search members or chats. */
    standard: boolean;
}): string[];
/** How to read a hit, once per result rather than per row. */
export declare const appFollowUp: () => string;
