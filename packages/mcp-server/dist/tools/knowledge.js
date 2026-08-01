"use strict";
/**
 * `dopl_kb` + `dopl_kb_admin` — the user's editable knowledge bases (Item 4).
 *
 * Consolidates the old 18 `kb_*` tools into two `op`-dispatched tools (the
 * canonical consolidated pattern — see setups.ts). The agent talks to these
 * like a filesystem; bases are addressed by slug or id, folders/entries by
 * `/`-separated path. `dopl_kb` = read + non-destructive writes (restores are
 * recovery, not deletion); `dopl_kb_admin` = the destructive soft-deletes,
 * broken out so the model can't reach them without the destructive surface.
 *
 * These expose the user's OWN editable bases (create / edit / soft-delete),
 * addressed like a filesystem.
 *
 * This file is the thin registrar: it owns the two tool schemas + op
 * routing and delegates each op to a handler in a sibling module —
 *   - `knowledge-shared.ts`    — base resolution + error/validation mappers
 *   - `knowledge-ops-read.ts`  — list_bases/get_tree/list_dir/read_file/list_trash/search
 *   - `knowledge-ops-write.ts` — create/update/move/write + restore (recovery) ops
 *   - `knowledge-ops-admin.ts` — the destructive soft-deletes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerKnowledgeTools = registerKnowledgeTools;
const zod_1 = require("zod");
const respond_1 = require("./respond");
const knowledge_ops_read_1 = require("./knowledge-ops-read");
const knowledge_ops_write_1 = require("./knowledge-ops-write");
const knowledge_ops_admin_1 = require("./knowledge-ops-admin");
const KB_DESCRIPTION = `Manage the caller's own editable knowledge bases. Talk to these like a filesystem. Bases are addressed by slug or id; folders/entries by \`/\`-separated path. Set \`op\` to one of:
- "list_bases" — the bases the caller can READ in the active workspace. Returns slugs to address with subsequent ops. Bases another member keeps private, bases scoped to a team you have no grant on, and trashed bases (op="list_trash") are absent, so this is your view and not the workspace's base count.
- "get_tree" — folder/entry tree for a base (metadata only, bodies stripped). FOLDERS ship in full; ENTRIES are paged, 400 per call by default, and the result says so and hands back an entry_cursor when there are more. Trashed folders/entries are excluded. First call when exploring a base; for a body follow up with op=read_file.
- "list_dir" — immediate folders + entries at a path. Empty/omitted path = base root. Metadata only.
- "create_base" — create a new base. New bases are private to the creator by default.
- "update_base" — update base metadata (name, description, slug). Access control is the workspace member matrix, not edited here.
- "restore_base" — restore a soft-deleted base (recovery, not deletion). Use after op=list_trash. Accepts the trashed base's slug or a UUID.
- "create_folder" — create a folder at a path. mkdir -p semantics; idempotent on existing folders. Pass \`description\` to set the folder's short agent-facing summary (shown in get_tree/list_dir); re-calling with a \`description\` on an existing folder UPDATES it (the way to edit a folder summary without touching its contents).
- "move_folder" — move + rename a folder; leaf becomes the new name, missing parents created, cycles rejected.
- "read_file" — read an entry's full markdown body by path (must resolve to an entry, not a folder). Returns a Version token — pass it to write_file as \`expected_version\`.
- "write_file" — upsert an entry. Pass \`path\` to target an existing entry (or a new one at that path); for a brand-new entry you may instead pass just \`title\` and it becomes the addressable path. Titles can't contain \`/\` — it's the path separator. Pass \`excerpt\` to set the entry's short agent-facing summary (shown in get_tree/list_dir); on an update, \`excerpt\` is only changed when provided. Parents mkdir-p'd. Overwriting an existing entry REQUIRES \`expected_version\` from a prior read_file (412 without it) so a concurrent edit can't be silently overwritten; \`force=true\` skips the check. Creates need no version.
- "move_file" — move + rename an entry; parents mkdir-p'd, leaf becomes the new title.
- "list_trash" — soft-deleted bases/folders/entries YOU CAN SEE. Scoped by the same visibility rules as op="list_bases", so another member's trashed private base is not here (admins and owners see more than members do). Optional \`base\` scopes to one base; omit for the workspace-wide view.
- "restore_file" — restore a soft-deleted entry by id (from op=list_trash).
- "restore_folder" — restore a soft-deleted folder by id (from op=list_trash).
- "search" — hybrid keyword + semantic search over the entry BODIES of the bases you can read. Returns ranked entries with snippet + path for op=read_file. A RANKED SAMPLE, not an exhaustive scan: the backend considers a bounded candidate set per leg before fusing, drops semantically distant entries, caps at \`limit\` (default 20), and removes hits in bases you cannot read AFTER ranking — so fewer hits than \`limit\` is normal and never means "there are no others". Zero hits is not proof of absence; try op="get_tree" or a different phrasing. Optional \`base\` narrows to one base.
- "set_visibility" — publish a base you created (\`visibility="public"\`: workspace-visible + referenceable in workflows). One-way — un-publishing and team scope are human-only (Dopl web UI).

Destructive deletes live in the separate \`dopl_kb_admin\` tool.`;
const KB_ADMIN_DESCRIPTION = `DESTRUCTIVE knowledge-base operations on the caller's OWN editable bases. Every op here is a soft-delete — the resource becomes invisible in active listings but stays restorable from trash (\`dopl_kb\` op=list_trash + the matching restore op). Confirm with the user before calling. Set \`op\` to one of:
- "delete_base" — soft-delete a base (+ its folders + entries). Restore with \`dopl_kb\` op=restore_base.
- "delete_folder" — soft-delete the folder at a path. Children stop appearing in active listings; restorable from trash.
- "delete_file" — soft-delete the entry at a path. Restorable from trash.`;
function registerKnowledgeTools(register, client) {
    // ── dopl_kb — read + non-destructive writes ──────────────────────
    register("dopl_kb", KB_DESCRIPTION, {
        op: zod_1.z
            .enum([
            "list_bases", "get_tree", "list_dir", "create_base", "update_base",
            "restore_base", "create_folder", "move_folder", "read_file", "write_file",
            "move_file", "list_trash", "restore_file", "restore_folder", "search",
            "set_visibility",
        ])
            .describe("Operation to perform."),
        base: zod_1.z.string().optional().describe("Base slug or id. Required for get_tree/list_dir/update_base/restore_base/create_folder/move_folder/read_file/write_file/move_file; optional scope for list_trash/search."),
        path: zod_1.z.string().optional().describe("Path within the base. list_dir: '/' or '' for root. create_folder: required, e.g. 'projects/foo'. read_file: required entry path. write_file: entry path — required unless you pass `title` (then the title becomes the path). delete uses dopl_kb_admin."),
        from_path: zod_1.z.string().optional().describe("move_folder/move_file: source path."),
        to_path: zod_1.z.string().optional().describe("move_folder/move_file: destination path (leaf becomes the new name/title)."),
        name: zod_1.z.string().optional().describe("create_base: required base name (1-120 chars). update_base: optional new name."),
        description: zod_1.z.string().optional().describe("create_base/update_base: optional base description (max 2000). create_folder: optional short agent-facing folder summary shown in get_tree/list_dir (max 300) — re-calling create_folder with a description updates an existing folder's summary."),
        slug: zod_1.z.string().optional().describe("update_base: optional new slug (1-80 chars)."),
        body: zod_1.z.string().max(1_048_576).optional().describe("write_file: required markdown body. Can't be empty — pass a single space for a deliberate stub."),
        title: zod_1.z.string().optional().describe("write_file: title for the entry — can't contain '/'. Doubles as the addressable path for a new entry when `path` is omitted; otherwise an optional override (defaults to the leaf path segment)."),
        excerpt: zod_1.z.string().optional().describe("write_file: optional short agent-facing summary shown in get_tree/list_dir (max 300) — keep it under 300 chars. On an update, only changed when provided."),
        expected_version: zod_1.z.string().optional().describe("write_file: the entry's Version from a prior read_file. Required when overwriting an existing entry — omitting it fails with 412; only force=true skips the check. Creates need no version."),
        force: zod_1.z.boolean().optional().describe("write_file: overwrite even if the entry changed since you read it. Discards the other edit — use only when intentional."),
        folder_id: zod_1.z.string().optional().describe("restore_folder: required folder UUID (from list_trash)."),
        entry_id: zod_1.z.string().optional().describe("restore_file: required entry UUID (from list_trash)."),
        query: zod_1.z.string().optional().describe("search: required free-text query."),
        // coerce: MCP clients sometimes send numbers as strings; strict
        // z.number() rejects them with an opaque -32602.
        limit: zod_1.z.coerce.number().int().min(1).max(100).optional().describe("search: max hits (default 20, 1-100)."),
        entry_limit: zod_1.z.coerce.number().int().min(1).max(1000).optional().describe("get_tree: max entries per page (default 400, 1-1000). Folders always ship in full."),
        entry_cursor: zod_1.z.string().optional().describe("get_tree: opaque cursor from a prior page's 'more entries' notice — fetches the next page."),
        visibility: zod_1.z.enum(["public", "private"]).optional().describe("op=set_visibility: 'public' to publish a base you created (makes it workspace-visible + referenceable in workflows). One-way — 'private' is rejected."),
    }, async (args) => {
        switch (args.op) {
            case "list_bases":
                return (0, knowledge_ops_read_1.opListBases)(client);
            case "get_tree": {
                const miss = (0, respond_1.missingParams)("get_tree", args, ["base"]);
                if (miss)
                    return miss;
                return (0, knowledge_ops_read_1.opGetTree)(client, args.base, args.entry_limit, args.entry_cursor);
            }
            case "list_dir": {
                const miss = (0, respond_1.missingParams)("list_dir", args, ["base"]);
                if (miss)
                    return miss;
                return (0, knowledge_ops_read_1.opListDir)(client, args.base, args.path);
            }
            case "create_base": {
                const miss = (0, respond_1.missingParams)("create_base", args, ["name"]);
                if (miss)
                    return miss;
                return (0, knowledge_ops_write_1.opCreateBase)(client, args.name, args.description);
            }
            case "update_base": {
                const miss = (0, respond_1.missingParams)("update_base", args, ["base"]);
                if (miss)
                    return miss;
                return (0, knowledge_ops_write_1.opUpdateBase)(client, args.base, args.name, args.description, args.slug);
            }
            case "restore_base": {
                const miss = (0, respond_1.missingParams)("restore_base", args, ["base"]);
                if (miss)
                    return miss;
                return (0, knowledge_ops_write_1.opRestoreBase)(client, args.base);
            }
            case "create_folder": {
                const miss = (0, respond_1.missingParams)("create_folder", args, ["base", "path"]);
                if (miss)
                    return miss;
                return (0, knowledge_ops_write_1.opCreateFolder)(client, args.base, args.path, args.description);
            }
            case "move_folder": {
                const miss = (0, respond_1.missingParams)("move_folder", args, ["base", "from_path", "to_path"]);
                if (miss)
                    return miss;
                return (0, knowledge_ops_write_1.opMoveFolder)(client, args.base, args.from_path, args.to_path);
            }
            case "read_file": {
                const miss = (0, respond_1.missingParams)("read_file", args, ["base", "path"]);
                if (miss)
                    return miss;
                return (0, knowledge_ops_read_1.opReadFile)(client, args.base, args.path);
            }
            case "write_file": {
                const miss = (0, respond_1.missingParams)("write_file", args, ["base"]);
                if (miss)
                    return miss;
                // F-21: title-only creation. The op doc says a new entry's title
                // becomes its addressable path, so derive the path from title when
                // path is omitted. Existing path-based calls are unaffected.
                const path = args.path !== undefined && args.path !== ""
                    ? args.path
                    : args.title;
                if (path === undefined || path === "") {
                    return (0, respond_1.err)(`op="write_file" is missing required param: path (pass path, or a title to derive it).`);
                }
                // F-17: an empty-string body is a real value the caller can fix,
                // not a "missing param" — distinguish it from a genuinely omitted
                // body so the message is actionable.
                if (args.body === undefined) {
                    return (0, respond_1.err)(`op="write_file" is missing required param: body.`);
                }
                if (args.body === "") {
                    return (0, respond_1.err)(`write_file: body cannot be empty — pass content (or a single space for a stub).`);
                }
                return (0, knowledge_ops_write_1.opWriteFile)(client, args.base, path, args.body, args.title, args.expected_version, args.force, args.excerpt);
            }
            case "move_file": {
                const miss = (0, respond_1.missingParams)("move_file", args, ["base", "from_path", "to_path"]);
                if (miss)
                    return miss;
                return (0, knowledge_ops_write_1.opMoveFile)(client, args.base, args.from_path, args.to_path);
            }
            case "list_trash":
                return (0, knowledge_ops_read_1.opListTrash)(client, args.base);
            case "restore_file": {
                const miss = (0, respond_1.missingParams)("restore_file", args, ["entry_id"]);
                if (miss)
                    return miss;
                return (0, knowledge_ops_write_1.opRestoreFile)(client, args.entry_id);
            }
            case "restore_folder": {
                const miss = (0, respond_1.missingParams)("restore_folder", args, ["folder_id"]);
                if (miss)
                    return miss;
                return (0, knowledge_ops_write_1.opRestoreFolder)(client, args.folder_id);
            }
            case "search": {
                const miss = (0, respond_1.missingParams)("search", args, ["query"]);
                if (miss)
                    return miss;
                return (0, knowledge_ops_read_1.opSearch)(client, args.query, args.base, args.limit);
            }
            case "set_visibility": {
                const miss = (0, respond_1.missingParams)("set_visibility", args, ["base", "visibility"]);
                if (miss)
                    return miss;
                return (0, knowledge_ops_write_1.opSetVisibility)(client, args.base, args.visibility);
            }
        }
    });
    // ── dopl_kb_admin — DESTRUCTIVE soft-deletes ─────────────────────
    register("dopl_kb_admin", KB_ADMIN_DESCRIPTION, {
        op: zod_1.z
            .enum(["delete_base", "delete_folder", "delete_file"])
            .describe("Destructive operation to perform."),
        base: zod_1.z.string().optional().describe("Base slug or id. Required for all ops."),
        path: zod_1.z
            .string()
            .optional()
            .describe("delete_folder/delete_file: required path of the resource to soft-delete."),
    }, async (args) => {
        switch (args.op) {
            case "delete_base": {
                const miss = (0, respond_1.missingParams)("delete_base", args, ["base"]);
                if (miss)
                    return miss;
                return (0, knowledge_ops_admin_1.opDeleteBase)(client, args.base);
            }
            case "delete_folder": {
                const miss = (0, respond_1.missingParams)("delete_folder", args, ["base", "path"]);
                if (miss)
                    return miss;
                return (0, knowledge_ops_admin_1.opDeleteFolder)(client, args.base, args.path);
            }
            case "delete_file": {
                const miss = (0, respond_1.missingParams)("delete_file", args, ["base", "path"]);
                if (miss)
                    return miss;
                return (0, knowledge_ops_admin_1.opDeleteFile)(client, args.base, args.path);
            }
        }
    });
}
