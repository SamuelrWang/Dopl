/**
 * `dopl_search`'s six APP-SEARCH groups, rendered (DMP-004, 2026-09-23): channels, messages, threads,
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
export declare const APP_FOLLOW_UP = "_Read a message with dopl_channel(op=\"read\", channel=\u2026, since=<seq \u2212 1>), a thread with thread=\u2026, a member with dopl_members(op=\"get\", member=<id>), a chat with dopl_chats(op=\"get\", chat_id=<id>). A home channel also needs container=._";
