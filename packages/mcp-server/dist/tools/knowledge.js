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
 * Distinct from the read-only knowledge-pack tools (`dopl_packs(op='list')`,
 * `dopl_packs(op='list_files')`, `dopl_packs(op='get_file')`) in server.ts: those expose Dopl's own curated
 * specialist verticals; these expose the user's own editable bases.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerKnowledgeTools = registerKnowledgeTools;
const zod_1 = require("zod");
const respond_1 = require("./respond");
/**
 * Resolves a base reference (slug or UUID) to a `KnowledgeBase` row.
 * Returns null when nothing matches. Calls `listKbBases` once per
 * invocation — fine for agent throughput, not great for tight loops.
 */
async function resolveBase(client, ref) {
    const bases = await client.listKbBases();
    return bases.find((b) => b.slug === ref || b.id === ref) ?? null;
}
/**
 * resolveBase + the standard not-found error. Returns the base, or a
 * ToolResponse error (caller short-circuits on the `isError` branch).
 */
async function resolveBaseOr(client, ref) {
    const base = await resolveBase(client, ref);
    if (!base)
        return (0, respond_1.err)(`Knowledge base not found: ${ref}. If you may have deleted it, check \`dopl_kb(op='list_trash')\` and restore with \`dopl_kb(op='restore_base')\`.`);
    return base;
}
function isErr(x) {
    return "isError" in x && x.isError === true;
}
const KB_DESCRIPTION = `Manage the caller's own editable knowledge bases — the user's bases, NOT the read-only Dopl knowledge packs (use \`dopl_packs(op='list')\`/\`dopl_packs(op='list_files')\`/\`dopl_packs(op='get_file')\` for those). Talk to these like a filesystem. Bases are addressed by slug or id; folders/entries by \`/\`-separated path. Set \`op\` to one of:
- "list_bases" — list the bases the caller can access in the active workspace. Returns slugs to address with subsequent ops.
- "get_tree" — full folder/entry tree for a base (metadata only, bodies stripped). First call when exploring a base; for a body follow up with op=read_file.
- "list_dir" — immediate folders + entries at a path. Empty/omitted path = base root. Metadata only.
- "create_base" — create a new base. New bases are private to the creator by default.
- "update_base" — update base metadata (name, description, slug). Access control is the workspace member matrix, not edited here.
- "restore_base" — restore a soft-deleted base (recovery, not deletion). Use after op=list_trash. Accepts the trashed base's slug or a UUID.
- "create_folder" — create a folder at a path. mkdir -p semantics; idempotent on existing folders.
- "move_folder" — move + rename a folder; leaf becomes the new name, missing parents created, cycles rejected.
- "read_file" — read an entry's full markdown body by path (must resolve to an entry, not a folder). Returns a Version token — pass it to write_file as \`expected_version\`.
- "write_file" — upsert an entry. \`path\` resolves an existing entry; for new entries the title becomes the addressable path (pass \`title\` for a clean one). Parents mkdir-p'd. To edit an existing entry safely, read_file first and pass its Version as \`expected_version\` so a concurrent edit can't be silently overwritten (you'll get a 412 to reconcile instead).
- "move_file" — move + rename an entry; parents mkdir-p'd, leaf becomes the new title.
- "list_trash" — list soft-deleted bases/folders/entries. Optional \`base\` scopes to one base; omit for workspace-wide.
- "restore_file" — restore a soft-deleted entry by id (from op=list_trash).
- "restore_folder" — restore a soft-deleted folder by id (from op=list_trash).
- "search" — full-text search across the workspace's bases. Returns ranked entries with snippet + path for op=read_file. Optional \`base\` narrows to one base.
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
        path: zod_1.z.string().optional().describe("Path within the base. list_dir: '/' or '' for root. create_folder: required, e.g. 'projects/foo'. read_file/write_file: required entry path. delete uses dopl_kb_admin."),
        from_path: zod_1.z.string().optional().describe("move_folder/move_file: source path."),
        to_path: zod_1.z.string().optional().describe("move_folder/move_file: destination path (leaf becomes the new name/title)."),
        name: zod_1.z.string().optional().describe("create_base: required base name (1-120 chars). update_base: optional new name."),
        description: zod_1.z.string().optional().describe("create_base/update_base: optional base description (max 2000)."),
        slug: zod_1.z.string().optional().describe("update_base: optional new slug (1-80 chars)."),
        body: zod_1.z.string().optional().describe("write_file: required markdown body."),
        title: zod_1.z.string().optional().describe("write_file: optional title override (defaults to the leaf path segment)."),
        expected_version: zod_1.z.string().optional().describe("write_file: the entry's version from a prior read_file, to avoid overwriting a concurrent edit (412 on mismatch). Omit to auto-guard against the current version."),
        force: zod_1.z.boolean().optional().describe("write_file: overwrite even if the entry changed since you read it. Discards the other edit — use only when intentional."),
        folder_id: zod_1.z.string().optional().describe("restore_folder: required folder UUID (from list_trash)."),
        entry_id: zod_1.z.string().optional().describe("restore_file: required entry UUID (from list_trash)."),
        query: zod_1.z.string().optional().describe("search: required free-text query."),
        // coerce: MCP clients sometimes send numbers as strings; strict
        // z.number() rejects them with an opaque -32602.
        limit: zod_1.z.coerce.number().optional().describe("search: max hits (default 20)."),
        entry_limit: zod_1.z.coerce.number().optional().describe("get_tree: max entries per page (default 400, max 1000). Folders always ship in full."),
        entry_cursor: zod_1.z.string().optional().describe("get_tree: opaque cursor from a prior page's 'more entries' notice — fetches the next page."),
        visibility: zod_1.z.enum(["public", "private"]).optional().describe("op=set_visibility: 'public' to publish a base you created (makes it workspace-visible + referenceable in workflows). One-way — 'private' is rejected."),
    }, async (args) => {
        switch (args.op) {
            case "list_bases":
                return opListBases(client);
            case "get_tree": {
                const miss = (0, respond_1.missingParams)("get_tree", args, ["base"]);
                if (miss)
                    return miss;
                return opGetTree(client, args.base, args.entry_limit, args.entry_cursor);
            }
            case "list_dir": {
                const miss = (0, respond_1.missingParams)("list_dir", args, ["base"]);
                if (miss)
                    return miss;
                return opListDir(client, args.base, args.path);
            }
            case "create_base": {
                const miss = (0, respond_1.missingParams)("create_base", args, ["name"]);
                if (miss)
                    return miss;
                return opCreateBase(client, args.name, args.description);
            }
            case "update_base": {
                const miss = (0, respond_1.missingParams)("update_base", args, ["base"]);
                if (miss)
                    return miss;
                return opUpdateBase(client, args.base, args.name, args.description, args.slug);
            }
            case "restore_base": {
                const miss = (0, respond_1.missingParams)("restore_base", args, ["base"]);
                if (miss)
                    return miss;
                return opRestoreBase(client, args.base);
            }
            case "create_folder": {
                const miss = (0, respond_1.missingParams)("create_folder", args, ["base", "path"]);
                if (miss)
                    return miss;
                return opCreateFolder(client, args.base, args.path);
            }
            case "move_folder": {
                const miss = (0, respond_1.missingParams)("move_folder", args, ["base", "from_path", "to_path"]);
                if (miss)
                    return miss;
                return opMoveFolder(client, args.base, args.from_path, args.to_path);
            }
            case "read_file": {
                const miss = (0, respond_1.missingParams)("read_file", args, ["base", "path"]);
                if (miss)
                    return miss;
                return opReadFile(client, args.base, args.path);
            }
            case "write_file": {
                const miss = (0, respond_1.missingParams)("write_file", args, ["base", "path", "body"]);
                if (miss)
                    return miss;
                return opWriteFile(client, args.base, args.path, args.body, args.title, args.expected_version, args.force);
            }
            case "move_file": {
                const miss = (0, respond_1.missingParams)("move_file", args, ["base", "from_path", "to_path"]);
                if (miss)
                    return miss;
                return opMoveFile(client, args.base, args.from_path, args.to_path);
            }
            case "list_trash":
                return opListTrash(client, args.base);
            case "restore_file": {
                const miss = (0, respond_1.missingParams)("restore_file", args, ["entry_id"]);
                if (miss)
                    return miss;
                return opRestoreFile(client, args.entry_id);
            }
            case "restore_folder": {
                const miss = (0, respond_1.missingParams)("restore_folder", args, ["folder_id"]);
                if (miss)
                    return miss;
                return opRestoreFolder(client, args.folder_id);
            }
            case "search": {
                const miss = (0, respond_1.missingParams)("search", args, ["query"]);
                if (miss)
                    return miss;
                return opSearch(client, args.query, args.base, args.limit);
            }
            case "set_visibility": {
                const miss = (0, respond_1.missingParams)("set_visibility", args, ["base", "visibility"]);
                if (miss)
                    return miss;
                return opSetVisibility(client, args.base, args.visibility);
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
                return opDeleteBase(client, args.base);
            }
            case "delete_folder": {
                const miss = (0, respond_1.missingParams)("delete_folder", args, ["base", "path"]);
                if (miss)
                    return miss;
                return opDeleteFolder(client, args.base, args.path);
            }
            case "delete_file": {
                const miss = (0, respond_1.missingParams)("delete_file", args, ["base", "path"]);
                if (miss)
                    return miss;
                return opDeleteFile(client, args.base, args.path);
            }
        }
    });
}
async function opListBases(client) {
    const bases = await client.listKbBases();
    if (bases.length === 0)
        return (0, respond_1.ok)("No knowledge bases yet. Create one with `dopl_kb(op='create_base')`.");
    const lines = ["## Knowledge bases\n"];
    for (const b of bases) {
        // Surface the immutable id alongside the slug (the slug changes on
        // rename; the id is a stable handle) plus the access signal.
        const vis = b.visibility === "private" ? "private" : "public";
        const desc = b.description ? `\n  ${b.description}` : "";
        lines.push(`- **${b.name}** (slug: \`${b.slug}\` · id: \`${b.id}\` · ${vis})${desc}`);
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
const TREE_ENTRY_CAP = 400;
const TREE_ENTRY_MAX = 1000;
async function opGetTree(client, ref, entryLimit, entryCursor) {
    const base = await resolveBaseOr(client, ref);
    if (isErr(base))
        return base;
    // Entries are paged at the API (folders always ship in full), so the
    // wire payload matches what gets rendered instead of always shipping
    // the whole base.
    const limit = Math.min(Math.max(1, Math.floor(entryLimit ?? TREE_ENTRY_CAP)), TREE_ENTRY_MAX);
    const tree = await client.getKbTree(base.id, {
        entryLimit: limit,
        entryCursor,
    });
    const entryTotal = tree.entryTotal ?? tree.entries.length;
    const vis = tree.base.visibility === "private" ? "private" : "public";
    const lines = [
        `## ${tree.base.name} \`${tree.base.slug}\``,
        `id: \`${tree.base.id}\` · ${vis} · agent-write ${tree.base.agentWriteEnabled ? "on" : "off"}`,
        ...(tree.base.description ? [tree.base.description] : []),
        `Folders: ${tree.folders.length} · Entries: ${entryTotal}${tree.entries.length < entryTotal ? ` (showing ${tree.entries.length})` : ""}`,
        "",
    ];
    // Build a tree view by walking parent_id / folder_id.
    const childFolders = new Map();
    for (const f of tree.folders) {
        const arr = childFolders.get(f.parentId) ?? [];
        arr.push(f);
        childFolders.set(f.parentId, arr);
    }
    for (const arr of childFolders.values())
        arr.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    const childEntries = new Map();
    for (const e of tree.entries) {
        const arr = childEntries.get(e.folderId) ?? [];
        arr.push(e);
        childEntries.set(e.folderId, arr);
    }
    for (const arr of childEntries.values())
        arr.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
    function dump(parentId, prefix) {
        for (const f of childFolders.get(parentId) ?? []) {
            lines.push(`${prefix}📁 ${f.name}/${descSuffix(f.description)}`);
            dump(f.id, prefix + "  ");
        }
        for (const e of childEntries.get(parentId) ?? []) {
            lines.push(`${prefix}📄 ${e.title}${descSuffix(e.excerpt)}`);
        }
    }
    dump(null, "");
    if (tree.nextEntryCursor) {
        lines.push("", `_Showing ${tree.entries.length} of ${entryTotal} entries. Pass entry_cursor="${tree.nextEntryCursor}" for the next page, or narrow with op="list_dir" / op="search"._`);
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
/**
 * ` — description` suffix for tree / directory rows. Folder
 * `description` and entry `excerpt` are the user-curated, agent-facing
 * summaries (≤300 chars) — surfacing them here lets agents pick the
 * right file from a listing instead of read_file-ing everything.
 * Newlines are flattened so one row stays one line.
 */
function descSuffix(text) {
    if (!text)
        return "";
    return ` — ${text.replace(/\s*\n+\s*/g, " ")}`;
}
async function opListDir(client, ref, path) {
    const base = await resolveBaseOr(client, ref);
    if (isErr(base))
        return base;
    const listing = await client.listKbDirByPath(base.id, path ?? "");
    const lines = [];
    const where = listing.folder ? listing.folder.name : "(root)";
    lines.push(`## ${base.name} → ${where}`);
    if (listing.folder?.description)
        lines.push(listing.folder.description);
    if (listing.folders.length === 0 && listing.entries.length === 0) {
        lines.push("Empty.");
    }
    else {
        for (const f of listing.folders)
            lines.push(`📁 ${f.name}/${descSuffix(f.description)}`);
        for (const e of listing.entries)
            lines.push(`📄 ${e.title}${descSuffix(e.excerpt)}`);
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opCreateBase(client, name, description) {
    const base = await client.createKbBase({ name, description });
    const visNote = base.visibility === "private"
        ? "Private to you — only you and your agent can see it."
        : "Visible to the whole workspace.";
    return (0, respond_1.ok)(`Created knowledge base **${base.name}** (slug: \`${base.slug}\`). ${visNote}`);
}
async function opUpdateBase(client, ref, name, description, slug) {
    const base = await resolveBaseOr(client, ref);
    if (isErr(base))
        return base;
    const updated = await client.updateKbBase(base.id, {
        name,
        description,
        slug,
    });
    return (0, respond_1.ok)(`Updated **${updated.name}** (slug: \`${updated.slug}\`).`);
}
async function opSetVisibility(client, ref, visibility) {
    if (visibility !== "public") {
        return (0, respond_1.err)(`set_visibility only publishes (visibility="public") a base you created. Un-publishing and team scope are human-only — use the Dopl web UI.`);
    }
    const base = await resolveBaseOr(client, ref);
    if (isErr(base))
        return base;
    const updated = await client.updateKbBase(base.id, { visibility: "public" });
    return (0, respond_1.ok)(`Published knowledge base **${updated.name}** (slug: \`${updated.slug}\`) — now visible workspace-wide and referenceable in workflows.`);
}
async function opRestoreBase(client, ref) {
    // Audit fix #30: was 3 round-trips (listKbBases → listKbTrash →
    // restoreKbBase). Drop the listKbBases call — if the user
    // mistakenly tries to restore an already-active base it'll just
    // fall into the "not in trash" error below, which is clearer
    // anyway ("No deleted base matches" vs "Base is already active"
    // both correctly tell them not to retry).
    //
    // The restore endpoint takes a UUID, not a slug. Look up the
    // trashed base by slug or id via workspace-wide trash listing.
    const trash = await client.listKbTrash();
    const trashed = trash.bases.find((b) => b.slug === ref || b.id === ref);
    if (!trashed) {
        return (0, respond_1.err)(`No deleted base matches "${ref}". Use \`dopl_kb(op='list_trash')\` to see available restores; or the base may already be active.`);
    }
    const restored = await client.restoreKbBase(trashed.id);
    return (0, respond_1.ok)(`Restored **${restored.name}** (slug: \`${restored.slug}\`).`);
}
async function opCreateFolder(client, ref, path) {
    const base = await resolveBaseOr(client, ref);
    if (isErr(base))
        return base;
    const folder = await client.createKbFolderByPath(base.id, path);
    return (0, respond_1.ok)(`Folder ready at \`${path}\` (id: \`${folder.id}\`).`);
}
async function opMoveFolder(client, ref, from_path, to_path) {
    const base = await resolveBaseOr(client, ref);
    if (isErr(base))
        return base;
    const result = await client.moveKbByPath(base.id, from_path, to_path);
    if (result.kind !== "folder") {
        return (0, respond_1.err)(`Path "${from_path}" resolved to a ${result.kind}, not a folder.`);
    }
    return (0, respond_1.ok)(`Folder moved: \`${from_path}\` → \`${to_path}\`.`);
}
async function opReadFile(client, ref, path) {
    const base = await resolveBaseOr(client, ref);
    if (isErr(base))
        return base;
    const entry = await client.readKbFileByPath(base.id, path);
    const lines = [
        `# ${entry.title}`,
        `Path: \`${path}\` · entry id: \`${entry.id}\` · type: ${entry.entryType}`,
        `Version: \`${entry.updatedAt}\` (pass as expected_version to write_file) · last edited by ${entry.lastEditedSource} · created ${entry.createdAt}`,
        "",
        "---",
        "",
        entry.body,
    ];
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opWriteFile(client, ref, path, body, title, expected_version, force) {
    const base = await resolveBaseOr(client, ref);
    if (isErr(base))
        return base;
    let entry;
    let webUrl;
    try {
        const res = await client.writeKbFileByPath(base.id, path, { body, title }, force ? null : expected_version);
        entry = res.entry;
        webUrl = res.webUrl;
    }
    catch (e) {
        if ((0, respond_1.isConflict)(e)) {
            return (0, respond_1.err)(`\`${path}\` changed since you last read it. Call dopl_kb(op="read_file", base, path) to get the current content + version, reconcile your changes, then retry write_file with that expected_version (or pass force=true to overwrite).`);
        }
        if ((0, respond_1.isAlreadyExists)(e)) {
            return (0, respond_1.err)(`An entry titled "${title ?? path.split("/").filter(Boolean).pop()}" already exists in that folder. Pick a different title/path, or read+overwrite the existing entry with dopl_kb(op="read_file" → "write_file").`);
        }
        throw e;
    }
    // The addressable path's leaf is the entry's title (not the input
    // path's leaf segment). Print it so callers can read the entry
    // back without guessing. When `title` was passed and the slug-of-
    // title differs from the input path's leaf, surface the canonical
    // form explicitly.
    const parentSegments = path.split("/").slice(0, -1).filter(Boolean);
    const canonicalPath = [...parentSegments, entry.title].join("/");
    const note = canonicalPath !== path
        ? ` Address future reads/moves with path \`${canonicalPath}\`.`
        : "";
    return (0, respond_1.ok)(`Wrote \`${canonicalPath}\` (entry id: \`${entry.id}\`, ${entry.body.length} chars). New version: \`${entry.updatedAt}\`.${note}\nView in Dopl: ${webUrl}`);
}
async function opMoveFile(client, ref, from_path, to_path) {
    const base = await resolveBaseOr(client, ref);
    if (isErr(base))
        return base;
    const result = await client.moveKbByPath(base.id, from_path, to_path);
    if (result.kind !== "entry") {
        return (0, respond_1.err)(`Path "${from_path}" resolved to a ${result.kind}, not an entry.`);
    }
    return (0, respond_1.ok)(`Entry moved: \`${from_path}\` → \`${to_path}\`.`);
}
async function opListTrash(client, ref) {
    let baseId;
    if (ref) {
        const base = await resolveBaseOr(client, ref);
        if (isErr(base))
            return base;
        baseId = base.id;
    }
    const trash = await client.listKbTrash(baseId);
    const total = trash.bases.length + trash.folders.length + trash.entries.length;
    if (total === 0)
        return (0, respond_1.ok)("Trash is empty.");
    const lines = [`## Trash (${total} item${total === 1 ? "" : "s"})\n`];
    if (trash.bases.length > 0) {
        lines.push("### Bases");
        for (const b of trash.bases)
            lines.push(`- **${b.name}** (slug: \`${b.slug}\`) — deleted ${b.deletedAt}`);
        lines.push("");
    }
    if (trash.folders.length > 0) {
        lines.push("### Folders");
        for (const f of trash.folders)
            lines.push(`- ${f.name} (id: \`${f.id}\`) — deleted ${f.deletedAt}`);
        lines.push("");
    }
    if (trash.entries.length > 0) {
        lines.push("### Entries");
        for (const e of trash.entries)
            lines.push(`- ${e.title} (id: \`${e.id}\`) — deleted ${e.deletedAt}`);
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opRestoreFolder(client, folder_id) {
    let folder;
    try {
        folder = await client.restoreKbFolder(folder_id);
    }
    catch (e) {
        if ((0, respond_1.isAlreadyExists)(e)) {
            return (0, respond_1.err)(`Can't restore this folder — an ancestor folder is still in the trash. Restore the ancestor first (dopl_kb(op="list_trash") to find it); restoring a folder brings its contents back.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Restored folder **${folder.name}** (id: \`${folder.id}\`).`);
}
async function opRestoreFile(client, entry_id) {
    let entry;
    try {
        entry = await client.restoreKbEntry(entry_id);
    }
    catch (e) {
        if ((0, respond_1.isAlreadyExists)(e)) {
            return (0, respond_1.err)(`Can't restore this entry — its parent folder is still in the trash. Restore the folder first (dopl_kb(op="list_trash") to find it); restoring a folder brings its contents back.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Restored entry **${entry.title}** (id: \`${entry.id}\`).`);
}
async function opSearch(client, query, base, limit) {
    const hits = await client.searchKb(query, { baseSlug: base, limit });
    if (hits.length === 0) {
        return (0, respond_1.ok)(`No matches for "${query}".`);
    }
    const lines = [`## ${hits.length} match${hits.length === 1 ? "" : "es"} for "${query}"\n`];
    for (const h of hits) {
        // Strip the highlight tags for plain-text agent consumption.
        const cleanSnippet = h.snippet.replace(/<\/?b>/g, "**");
        lines.push(`- **${h.title}** _(rank ${h.rank.toFixed(2)})_ — entry id: \`${h.entryId}\`\n  ${cleanSnippet}`);
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opDeleteBase(client, ref) {
    const base = await resolveBaseOr(client, ref);
    if (isErr(base))
        return base;
    await client.deleteKbBase(base.id);
    return (0, respond_1.ok)(`Deleted **${base.name}** (slug: \`${base.slug}\`). Restore with \`dopl_kb(op='restore_base')\`.`);
}
async function opDeleteFolder(client, ref, path) {
    const base = await resolveBaseOr(client, ref);
    if (isErr(base))
        return base;
    const result = await client.deleteKbByPath(base.id, path);
    if (result.kind !== "folder") {
        return (0, respond_1.err)(`Path "${path}" resolved to a ${result.kind}, not a folder. ` +
            `Use \`dopl_kb_admin(op='delete_file')\` for entries.`);
    }
    return (0, respond_1.ok)(`Folder deleted at \`${path}\`.`);
}
async function opDeleteFile(client, ref, path) {
    const base = await resolveBaseOr(client, ref);
    if (isErr(base))
        return base;
    const result = await client.deleteKbByPath(base.id, path);
    if (result.kind !== "entry") {
        return (0, respond_1.err)(`Path "${path}" resolved to a ${result.kind}, not an entry. ` +
            `Use \`dopl_kb_admin(op='delete_folder')\` for folders.`);
    }
    return (0, respond_1.ok)(`Entry deleted at \`${path}\`. Restore via \`dopl_kb(op='list_trash')\` + \`dopl_kb(op='restore_file')\`.`);
}
