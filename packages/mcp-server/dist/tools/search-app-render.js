"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.APP_FOLLOW_UP = void 0;
exports.appGroupLines = appGroupLines;
const narration_js_1 = require("./narration.js");
const search_scope_js_1 = require("./search-scope.js");
const HEADINGS = {
    channels: "Channels",
    messages: "Messages",
    threads: "Threads",
    artifacts: "Artifacts",
    members: "Members",
    chats: "Chats",
};
/** A snippet as a VALUE: the server's `<mark>` highlight dropped, never turned into markdown. */
function snippetOf(item) {
    return item.snippet ? ` — ${(0, narration_js_1.inlineOr)(item.snippet.replace(/<\/?mark>/g, ""), "`(no snippet)`")}` : "";
}
function row(item) {
    const title = (0, narration_js_1.inlineOr)(item.title, narration_js_1.NO_NAME);
    const ch = item.channelId ? `channel \`${item.channelId}\`` : "";
    switch (item.kind) {
        case "channels": {
            const about = item.subtitle ? ` — ${(0, narration_js_1.inlineOr)(item.subtitle, "")}` : "";
            return `- ${title} (channel \`${item.channelId ?? item.id}\` · container \`${item.containerId}\`)${about}`;
        }
        case "messages":
            return `- in ${title} (${ch} · seq ${item.seq ?? "?"})${snippetOf(item)}`;
        case "threads":
            return `- ${title} (${ch} · thread \`${item.threadId ?? item.id}\`)${snippetOf(item)}`;
        case "artifacts":
            return `- ${title} (${ch} · artifact \`${item.id}\`)${snippetOf(item)}`;
        case "members": {
            // The server falls back to the EMAIL as a title when there is no display name.
            const named = item.title && item.title !== item.subtitle && !item.title.includes("@");
            return named ? `- ${title} (member id \`${item.id}\`)` : `- member id \`${item.id}\``;
        }
        default:
            return `- ${title} (chat id \`${item.id}\`)${snippetOf(item)}`;
    }
}
/** The six groups under `heading` markers; a group with no match prints "No matches". */
function appGroupLines(groups, heading, opts) {
    const lines = [];
    const byKind = new Map(groups.map((g) => [g.kind, g]));
    for (const kind of search_scope_js_1.APP_GROUP_ORDER) {
        const group = byKind.get(kind);
        if (!group && opts.skipEmpty)
            continue;
        lines.push("", `${heading} ${HEADINGS[kind]}`);
        if (!opts.searched) {
            lines.push("_Not searched — no container was resolved for this call; pass `container=`._");
            continue;
        }
        if (!opts.standard && (kind === "members" || kind === "chats")) {
            lines.push("_Not searched — a home space or home channel has no member list or chat archive to search._");
            continue;
        }
        if (!group || group.items.length === 0) {
            lines.push("_No matches._");
            continue;
        }
        for (const item of group.items)
            lines.push(row(item));
        if (group.total > group.items.length) {
            const more = group.total >= 50 ? "50 or more" : String(group.total);
            lines.push(`_Showing ${group.items.length} of ${more} matching. Narrow the query._`);
        }
    }
    return lines;
}
/** How to read a hit, once per result rather than per row. */
exports.APP_FOLLOW_UP = `_Read a message with dopl_channel(op="read", channel=…, since=<seq − 1>), a thread with thread=…, a member with dopl_members(op="get", member=<id>), a chat with dopl_chats(op="get", chat_id=<id>). A home channel also needs container=._`;
