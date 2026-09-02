"use strict";
/**
 * MCP tools for the chat archive. Chats are agent-exported conversation
 * records: per-message summaries under an agent-filled session header. Private
 * to their owner by default; the owner can share one with the workspace.
 * ⚠ ONE TOOL: reads + non-destructive writes. There is no delete op and no
 * `dopl_chats_admin` (deleted 2026-09-02) — deletion is app-only and permanent,
 * fenced by `sessionOnly` on the two chat DELETE routes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerChatTools = registerChatTools;
const zod_1 = require("zod");
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const chats_render_1 = require("./chats-render");
const EXPORT_GUIDE = `## Exporting conversations into Dopl — the rules

**What the archive is for.** The user stores finished (or ongoing) agent
sessions in Dopl so future sessions can recall them. Write every export
for a future agent that has zero context: it should be able to read the
header and know whether the transcript is worth loading.

**Message style — summarize, don't transcribe.**
- One entry per message, in order, keeping the user/agent alternation.
- Each summary: 1–3 sentences, concrete and specific. Keep decisions,
  numbers, names, file paths, error strings. Drop pleasantries, false
  starts, and anything a future reader can't act on.
- Verbatim text ONLY when the user explicitly asks for it (pass the
  exact text in \`verbatim\` alongside the summary). Never export a whole
  conversation verbatim unless told to; use format="mixed" when only
  some messages carry verbatim.

**Header discipline — fill everything you can.**
- \`title\`: specific enough to disambiguate ("MCP OAuth refresh-token
  rotation bug", not "Debugging session").
- \`overview\`: one paragraph — what the session was about and how it ended.
- \`deliverables\`: what was completed/shipped, one entry each, done=false
  for agreed-but-unfinished items.
- \`learnings\`: durable facts worth recalling later (gotchas, decisions,
  constraints) — not a restatement of the deliverables.
- \`sessionDate\` (YYYY-MM-DD), \`source\` (your client), \`project\` (repo or
  project name) when known.

**Idempotency.** Always pass a stable \`clientSessionId\` (your session
id). Re-exporting the same session then updates the existing chat
instead of duplicating it. Mid-session you may export early and use
op="append" to extend the transcript.

**Folders.** Pass \`folder\` with a short name ("Dopl", "Consulting") to
file the chat; the folder is created if missing. Ask the user before
inventing a new taxonomy.

**Folder sharing is authoritative.** A folder has its own sharing scope
(private by default). Filing a chat into a folder makes the chat inherit
the folder's scope — any \`visibility\` you pass alongside \`folder\` is
superseded. Changing a folder's scope (op="update_folder") re-scopes
every chat inside it. Sharing a FILED chat directly is rejected: unfile
it first, or change the folder's scope.

**Privacy.** Exports default to private (owner-only). Only set
visibility="public" when the user explicitly says to share it with the
workspace.`;
const CHATS_DESCRIPTION = `The user's chat archive — exported conversation records this and future sessions can recall. Set \`op\` to one of:
- "export" — save a conversation. Requires: title, messages ({role: "user"|"agent", summary, verbatim?}). Recommended: client_session_id (stable session id, so a re-export updates instead of duplicating), overview, deliverables, learnings, session_date, source, project, folder. Read op="guide" first.
- "append" — add messages to an exported chat. Requires: chat_id, messages.
- "update" — a chat's header fields, or share/unshare via visibility. Owner-only. Requires: chat_id plus the fields to change. A filed chat INHERITS its folder's sharing, so filing re-scopes it and visibility on a filed chat is rejected.
- "list" — chats the user can read, newest first. On the FREE PLAN a 90-day history window hides older chats — nothing is deleted, and the result says so whenever any are hidden. Optional: scope ("private" | "shared" | "all", default "all"), query (filters TITLE and OVERVIEW only — transcripts are not searched, and neither is the archive by dopl_search).
- "get" — one chat in full: header, deliverables, learnings, summarized transcript. Requires: chat_id.
- "folders" — the user's chat folders with their sharing scope.
- "create_folder" — private by default. Requires: name.
- "update_folder" — rename and/or re-scope. Requires: folder_id plus name and/or visibility. ⚠ Changing sharing re-scopes EVERY chat in the folder — confirm with the user first.
- "guide" — export etiquette: message style, header discipline, idempotency, privacy.

No delete op — deleting is APP-ONLY and permanent: no trash, nothing to restore.`;
const MessageShape = zod_1.z.object({
    role: zod_1.z.enum(["user", "agent"]),
    summary: zod_1.z.string().min(1).max(4000),
    verbatim: zod_1.z.string().min(1).max(20000).optional(),
});
const DeliverableShape = zod_1.z.object({
    label: zod_1.z.string().min(1).max(300),
    done: zod_1.z.boolean(),
});
function registerChatTools(register, client) {
    register("dopl_chats", CHATS_DESCRIPTION, {
        op: zod_1.z
            .enum(["export", "append", "update", "list", "get", "folders", "create_folder", "update_folder", "guide"])
            .describe("Operation to perform."),
        chat_id: zod_1.z.string().optional().describe("Chat id. Required for append, update, get."),
        title: zod_1.z.string().min(1).max(200).optional().describe("op=export (required) / op=update: chat title — specific enough to disambiguate later."),
        overview: zod_1.z.string().max(2000).optional().describe("op=export / op=update: one-paragraph framing of what the session was about."),
        messages: zod_1.z.array(MessageShape).max(500).optional().describe("op=export (required) / op=append: ordered transcript entries. Summarize each message concisely; verbatim only when the user asked."),
        deliverables: zod_1.z.array(DeliverableShape).max(50).optional().describe("op=export / op=update: what was completed (done=true) or agreed but unfinished (done=false)."),
        learnings: zod_1.z.array(zod_1.z.string().min(1).max(1000)).max(50).optional().describe("op=export / op=update: durable facts worth recalling in future sessions."),
        client_session_id: zod_1.z.string().min(1).max(200).optional().describe("op=export: your stable session id — idempotency key so re-exports update instead of duplicate. Always pass one."),
        session_date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("op=export / op=update: date the session happened (YYYY-MM-DD)."),
        source: zod_1.z.enum(["claude-code", "claude-desktop", "codex", "cursor", "other"]).optional().describe("op=export: which client the session ran in."),
        project: zod_1.z.string().max(120).optional().describe("op=export / op=update: repo or project name the session worked on. op=update: pass empty string to clear it."),
        folder: zod_1.z.string().max(80).optional().describe("op=export / op=update: folder NAME to file the chat under (created if missing). Filing makes the chat INHERIT the folder's sharing scope. op=update: pass empty string to unfile."),
        visibility: zod_1.z.enum(["private", "public"]).optional().describe("op=update / op=update_folder: share ('public') or unshare ('private') with the workspace. Rejected on a chat that sits in a folder — the folder's scope is authoritative. op=export: defaults to private — only set public when the user explicitly says so (superseded when folder is passed)."),
        pinned: zod_1.z.boolean().optional().describe("op=update: pin/unpin the chat."),
        scope: zod_1.z.enum(["private", "shared", "all"]).optional().describe("op=list: which chats to list (default all)."),
        query: zod_1.z.string().max(200).optional().describe("op=list: case-insensitive title/overview filter."),
        name: zod_1.z.string().min(1).max(80).optional().describe("op=create_folder (required) / op=update_folder: folder name."),
        folder_id: zod_1.z.string().optional().describe("op=update_folder (required): folder id."),
    }, async (args) => {
        switch (args.op) {
            case "guide":
                return (0, respond_1.ok)(EXPORT_GUIDE);
            case "export": {
                const miss = (0, respond_1.missingParams)("export", args, ["title", "messages"]);
                if (miss)
                    return miss;
                if (typeof args.title === "string" && args.title.trim().length === 0) {
                    return (0, respond_1.err)(`op="export" got a blank title — pass a specific, non-empty title (whitespace-only is rejected).`);
                }
                if ((args.messages ?? []).length === 0) {
                    return (0, respond_1.err)(`op="export" got an empty messages array — summarize the conversation's messages and pass at least one entry.`);
                }
                return opExport(client, args);
            }
            case "append": {
                const miss = (0, respond_1.missingParams)("append", args, ["chat_id", "messages"]);
                if (miss)
                    return miss;
                if ((args.messages ?? []).length === 0) {
                    return (0, respond_1.err)(`op="append" got an empty messages array — pass at least one entry.`);
                }
                return opAppend(client, args.chat_id, args.messages ?? []);
            }
            case "update": {
                const miss = (0, respond_1.missingParams)("update", args, ["chat_id"]);
                if (miss)
                    return miss;
                return opUpdate(client, args.chat_id, args);
            }
            case "list":
                return opList(client, args.scope ?? "all", args.query);
            case "get": {
                const miss = (0, respond_1.missingParams)("get", args, ["chat_id"]);
                if (miss)
                    return miss;
                return opGet(client, args.chat_id);
            }
            case "folders":
                return opFolders(client);
            case "create_folder": {
                const miss = (0, respond_1.missingParams)("create_folder", args, ["name"]);
                if (miss)
                    return miss;
                return opCreateFolder(client, args.name);
            }
            case "update_folder": {
                const miss = (0, respond_1.missingParams)("update_folder", args, ["folder_id"]);
                if (miss)
                    return miss;
                if (args.name === undefined && args.visibility === undefined) {
                    return (0, respond_1.err)(`op="update_folder" needs name and/or visibility to change.`);
                }
                return opUpdateFolder(client, args.folder_id, {
                    name: args.name,
                    visibility: args.visibility,
                });
            }
        }
    });
}
async function opExport(client, args) {
    try {
        const chat = await client.exportChat({
            title: args.title,
            overview: args.overview,
            messages: args.messages ?? [],
            deliverables: args.deliverables,
            learnings: args.learnings,
            clientSessionId: args.client_session_id,
            sessionDate: args.session_date,
            source: args.source,
            project: args.project || undefined,
            folder: args.folder || undefined,
            visibility: args.visibility,
        });
        const idempotency = args.client_session_id
            ? `Re-exporting with client_session_id \`${args.client_session_id}\` updates this chat.`
            : `No client_session_id passed — a re-export would create a duplicate. Pass one next time.`;
        return (0, respond_1.ok)([
            `Exported ${(0, chats_render_1.chatTitle)(chat.title)} (\`${chat.id}\`) — ${chat.messageCount} messages, ${chat.visibility}.`,
            idempotency,
        ].join("\n"));
    }
    catch (e) {
        return (0, respond_1.err)(`Export failed: ${(0, chats_render_1.failureDetail)(e)}`);
    }
}
async function opAppend(client, chatId, messages) {
    try {
        const chat = await client.appendChatMessages(chatId, messages);
        return (0, respond_1.ok)(`Appended ${messages.length} message${messages.length === 1 ? "" : "s"} to ${(0, chats_render_1.chatTitle)(chat.title)} — transcript is now ${chat.messageCount} messages.`);
    }
    catch (e) {
        return (0, respond_1.err)(`Append failed: ${(0, chats_render_1.failureDetail)(e)}`);
    }
}
async function opUpdate(client, chatId, args) {
    const patch = {
        title: args.title,
        overview: args.overview,
        sessionDate: args.session_date,
        deliverables: args.deliverables,
        learnings: args.learnings,
        visibility: args.visibility,
        pinned: args.pinned,
        ...(args.project !== undefined
            ? { project: args.project === "" ? null : args.project }
            : {}),
        ...(args.folder !== undefined
            ? { folder: args.folder === "" ? null : args.folder }
            : {}),
    };
    if (Object.values(patch).every((v) => v === undefined)) {
        return (0, respond_1.err)(`op="update" needs at least one field to change: title, overview, project, session_date, deliverables, learnings, folder, visibility, pinned.`);
    }
    try {
        const chat = await client.updateChat(chatId, patch);
        return (0, respond_1.ok)(`Updated ${(0, chats_render_1.chatTitle)(chat.title)} (\`${chat.id}\`) — ${chat.visibility}${chat.pinned ? ", pinned" : ""}.`);
    }
    catch (e) {
        return (0, respond_1.err)(`Update failed: ${(0, chats_render_1.failureDetail)(e)}`);
    }
}
async function opList(client, scope, query) {
    const { chats: all, hiddenCount } = await client.listChats();
    const q = query?.trim().toLowerCase();
    const chats = all.filter((c) => {
        if (scope === "private" && c.visibility !== "private")
            return false;
        if (scope === "shared" && c.visibility !== "public")
            return false;
        if (q && !c.title.toLowerCase().includes(q) && !c.overview.toLowerCase().includes(q)) {
            return false;
        }
        return true;
    });
    if (chats.length === 0) {
        const empty = query || scope !== "all"
            ? `No chats match that filter. The filter runs over TITLE and OVERVIEW only — transcripts are not searched.`
            : "No chats visible to you. The archive holds your own chats plus ones shared with you, so this is not proof the workspace has none. Use op=\"export\" to save this session.";
        return (0, respond_1.ok)(hiddenCount > 0 ? `${empty}\n\n${(0, chats_render_1.hiddenNote)(hiddenCount)}` : empty);
    }
    const lines = [];
    lines.push(`## Chat archive — ${chats.length} chat${chats.length === 1 ? "" : "s"}\n`);
    // ⚠ Framing ONLY when the listing carries someone else's chat — a header that
    // cries wolf gets skimmed.
    if ((0, chats_render_1.anyShared)(chats))
        lines.push(`${chats_render_1.UNTRUSTED_ARCHIVE_HEADER}\n`);
    for (const c of chats) {
        lines.push((0, chats_render_1.formatChatLine)(c));
    }
    if (hiddenCount > 0) {
        lines.push(`\n${(0, chats_render_1.hiddenNote)(hiddenCount)}`);
    }
    // ⚠ The retention note fires only when the PLAN hid something. `query` is a
    // second, always-silent reduction — it matches title and overview ONLY, so a
    // term appearing solely in a transcript produces "No chats match that filter"
    // from an archive that contains it.
    if (q) {
        lines.push(`\n_Filtered on TITLE and OVERVIEW only — transcripts are not searched, so a term that appears only inside one will not match here._`);
    }
    lines.push(`\nUse dopl_chats(op="get", chat_id=...) to read a transcript.`);
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opGet(client, chatId) {
    let chat;
    try {
        chat = await client.getChat(chatId);
    }
    catch (e) {
        return (0, respond_1.err)(`Chat not found or failed to load: \`${chatId}\`. ${(0, chats_render_1.failureDetail)(e)}`);
    }
    return (0, respond_1.ok)((0, chats_render_1.renderChatDetail)(chat));
}
async function opFolders(client) {
    const folders = await client.listChatFolders();
    if (folders.length === 0) {
        return (0, respond_1.ok)(`No chat folders yet. Pass folder="<name>" on export (or op="create_folder") to create one.`);
    }
    const lines = folders.map((f) => `- ${(0, narration_1.inlineOr)(f.name, "`(unnamed folder)`")} \`${f.id}\` — ${(0, chats_render_1.folderScopeLabel)(f)}`);
    return (0, respond_1.ok)(`## Chat folders — ${folders.length}\n\n${lines.join("\n")}\n\nA folder's scope is authoritative: chats filed in it inherit its sharing.`);
}
async function opCreateFolder(client, name) {
    try {
        const folder = await client.createChatFolder(name);
        return (0, respond_1.ok)(`Created folder ${(0, narration_1.inlineOr)(folder.name, "`(unnamed folder)`")} (\`${folder.id}\`) — private.`);
    }
    catch (e) {
        return (0, respond_1.err)(`Folder create failed: ${(0, chats_render_1.failureDetail)(e)}`);
    }
}
async function opUpdateFolder(client, folderId, patch) {
    try {
        const folder = await client.updateChatFolder(folderId, patch);
        const scopeNote = patch.visibility !== undefined
            ? ` Every chat in the folder now inherits this scope.`
            : "";
        return (0, respond_1.ok)(`Updated folder ${(0, narration_1.inlineOr)(folder.name, "`(unnamed folder)`")} (\`${folder.id}\`) — ${(0, chats_render_1.folderScopeLabel)(folder)}.${scopeNote}`);
    }
    catch (e) {
        return (0, respond_1.err)(`Folder update failed: ${(0, chats_render_1.failureDetail)(e)}`);
    }
}
