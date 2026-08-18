"use strict";
/**
 * `dopl_kb` + `dopl_kb_admin` — the user's editable knowledge bases, addressed
 * like a filesystem (bases by slug or id, folders/entries by `/`-separated
 * path). `dopl_kb` = read + non-destructive writes; ⚠ `dopl_kb_admin` is the
 * delete surface and REFUSES every op it publishes.
 *
 * Thin registrar: two tool schemas + op routing, delegating to
 *   - `knowledge-shared.ts`    — base resolution + error/validation mappers
 *   - `knowledge-ops-read.ts`  — list_bases/get_tree/list_dir/read_file/search
 *   - `knowledge-ops-write.ts` — create/update/move/write ops
 *   - `knowledge-ops-admin.ts` — the (refused) delete ops
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerKnowledgeTools = registerKnowledgeTools;
const zod_1 = require("zod");
const delete_policy_js_1 = require("../delete-policy.js");
const identity_1 = require("./identity");
const respond_1 = require("./respond");
const knowledge_ops_read_1 = require("./knowledge-ops-read");
const knowledge_ops_write_1 = require("./knowledge-ops-write");
const knowledge_ops_admin_1 = require("./knowledge-ops-admin");
const KB_DESCRIPTION = `Manage the caller's own editable knowledge bases. Talk to these like a filesystem. Bases are addressed by slug or id; folders/entries by \`/\`-separated path. Set \`op\` to one of:
- "list_bases" — the bases the caller can READ in the active workspace. Returns slugs to address with subsequent ops. Bases another member keeps private and bases scoped to a team you have no grant on are absent, so this is your view and not the workspace's base count.
- "get_tree" — folder/entry tree for a base (metadata only, bodies stripped). FOLDERS ship in full; ENTRIES are paged, 400 per call by default, and the result says so and hands back an entry_cursor when there are more. First call when exploring a base; for a body follow up with op=read_file.
- "list_dir" — immediate folders + entries at a path. Empty/omitted path = base root. Metadata only.
- "create_base" — create a new base. New bases are private to the creator by default.
- "update_base" — update base metadata (name, description, slug). Access control is the workspace member matrix, not edited here.
- "create_folder" — create a folder at a path. mkdir -p semantics; idempotent on existing folders. Pass \`description\` to set the folder's short agent-facing summary (shown in get_tree/list_dir); re-calling with a \`description\` on an existing folder UPDATES it (the way to edit a folder summary without touching its contents).
- "move_folder" — move + rename a folder; leaf becomes the new name, missing parents created, cycles rejected.
- "read_file" — read an entry's full markdown body by path (must resolve to an entry, not a folder). Returns a Version token — pass it to write_file as \`expected_version\`.
- "write_file" — upsert an entry. Pass \`path\` to target an existing entry (or a new one at that path); for a brand-new entry you may instead pass just \`title\` and it becomes the addressable path. Titles can't contain \`/\` — it's the path separator. Pass \`excerpt\` to set the entry's short agent-facing summary (shown in get_tree/list_dir); on an update, \`excerpt\` is only changed when provided. Parents mkdir-p'd. Overwriting an existing entry REQUIRES \`expected_version\` from a prior read_file (412 without it) so a concurrent edit can't be silently overwritten; \`force=true\` skips the check. Creates need no version.
- "move_file" — move + rename an entry; parents mkdir-p'd, leaf becomes the new title.
- "search" — hybrid keyword + semantic search over the entry BODIES of the bases you can read. Returns ranked entries with snippet + path for op=read_file. A RANKED SAMPLE, not an exhaustive scan: the backend considers a bounded candidate set per leg before fusing, drops semantically distant entries, caps at \`limit\` (default 20), and removes hits in bases you cannot read AFTER ranking — so fewer hits than \`limit\` is normal and never means "there are no others". Zero hits is not proof of absence; try op="get_tree" or a different phrasing. Optional \`base\` narrows to one base.
- "set_visibility" — publish a base you created (\`visibility="public"\`: readable by every member of the workspace). One-way — un-publishing and team scope are human-only (Dopl web UI).

Deleting is not available to you over MCP: \`dopl_kb_admin\` refuses every op it lists and removes nothing, and there is no trash to restore from. Ask the user to delete in the Dopl app.`;
const KB_ADMIN_DESCRIPTION = (0, delete_policy_js_1.deleteAdminDescription)([
    { op: "delete_base", effect: "would have deleted a base and its folders + entries" },
    { op: "delete_folder", effect: "would have deleted the folder at a path" },
    { op: "delete_file", effect: "would have deleted the entry at a path" },
], `Reach for instead: \`dopl_kb\` op=write_file to replace an entry's contents, op=move_file / op=move_folder to reorganize. If something genuinely has to go, say so and ask the user to delete it in the Dopl app.`);
function registerKnowledgeTools(register, client, 
// ⚠ Read for exactly ONE thing: whether an entry BODY is somebody else's,
// which decides `UNTRUSTED_ENTRY_BODY_HEADER`. Nothing about visibility is
// decided from it — the server already filtered.
caller = identity_1.UNKNOWN_CALLER) {
    // ── dopl_kb — read + non-destructive writes ──────────────────────
    register("dopl_kb", KB_DESCRIPTION, {
        op: zod_1.z
            .enum([
            "list_bases", "get_tree", "list_dir", "create_base", "update_base",
            "create_folder", "move_folder", "read_file", "write_file",
            "move_file", "search", "set_visibility",
        ])
            .describe("Operation to perform."),
        base: zod_1.z.string().optional().describe("Base slug or id. Required for get_tree/list_dir/update_base/create_folder/move_folder/read_file/write_file/move_file; optional scope for search."),
        path: zod_1.z.string().optional().describe("Path within the base. list_dir: '/' or '' for root. create_folder: required, e.g. 'projects/foo'. read_file: required entry path. write_file: entry path — required unless you pass `title` (then the title becomes the path). There is no delete op — deletion is app-only."),
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
        query: zod_1.z.string().optional().describe("search: required free-text query."),
        // ⚠ coerce: MCP clients sometimes send numbers as strings, which strict
        // z.number() rejects with an opaque -32602.
        limit: zod_1.z.coerce.number().int().min(1).max(100).optional().describe("search: max hits (default 20, 1-100)."),
        entry_limit: zod_1.z.coerce.number().int().min(1).max(1000).optional().describe("get_tree: max entries per page (default 400, 1-1000). Folders always ship in full."),
        entry_cursor: zod_1.z.string().optional().describe("get_tree: opaque cursor from a prior page's 'more entries' notice — fetches the next page."),
        visibility: zod_1.z.enum(["public", "private"]).optional().describe("op=set_visibility: 'public' to publish a base you created (makes it readable by every member of the workspace). One-way — 'private' is rejected."),
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
                return (0, knowledge_ops_read_1.opReadFile)(client, args.base, args.path, caller.userId);
            }
            case "write_file": {
                const miss = (0, respond_1.missingParams)("write_file", args, ["base"]);
                if (miss)
                    return miss;
                // Title-only creation: the op doc says a new entry's title becomes
                // its addressable path, so derive it when `path` is omitted.
                const path = args.path !== undefined && args.path !== ""
                    ? args.path
                    : args.title;
                if (path === undefined || path === "") {
                    return (0, respond_1.err)(`op="write_file" is missing required param: path (pass path, or a title to derive it).`);
                }
                // ⚠ An empty-string body is a real value the caller can fix, not a
                // "missing param" — keep the two messages distinct.
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
    // ── dopl_kb_admin — the delete surface, every op refused ─────────
    register("dopl_kb_admin", KB_ADMIN_DESCRIPTION, {
        op: zod_1.z
            .enum(["delete_base", "delete_folder", "delete_file"])
            .describe("Destructive operation to perform."),
        base: zod_1.z.string().optional().describe("Base slug or id. Required for all ops."),
        path: zod_1.z
            .string()
            .optional()
            .describe("delete_folder/delete_file: required path of the resource the refused op names."),
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
