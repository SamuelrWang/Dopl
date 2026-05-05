"use strict";
/**
 * MCP tools for managing the user's knowledge bases (Item 4).
 *
 * 17 tools total. The agent talks to these like a filesystem:
 * `kb_write_file`, `kb_read_file`, `kb_create_folder`, `kb_list_dir`,
 * `kb_move_file`. Bases are addressed by slug (or id — both work);
 * folders/entries by `/`-separated path.
 *
 * Distinct from the read-only knowledge-pack tools (`kb_list_packs`,
 * `kb_list`, `kb_get`) in server.ts: those expose Dopl's own curated
 * specialist verticals; these expose the user's own editable bases.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerKnowledgeTools = registerKnowledgeTools;
const zod_1 = require("zod");
/**
 * Resolves a base reference (slug or UUID) to a `KnowledgeBase` row.
 * Returns null when nothing matches. Calls `listKbBases` once per
 * invocation — fine for agent throughput, not great for tight loops.
 */
async function resolveBase(client, ref) {
    const bases = await client.listKbBases();
    return bases.find((b) => b.slug === ref || b.id === ref) ?? null;
}
function err(message) {
    return { content: [{ type: "text", text: message }], isError: true };
}
function ok(text) {
    return { content: [{ type: "text", text }] };
}
function registerKnowledgeTools(register, client) {
    // ── kb_list_bases ────────────────────────────────────────────────
    register("kb_list_bases", "List the knowledge bases the caller can access in the active workspace. Each base is a folder/file tree. Returns slugs to address with subsequent kb_* tools.", {}, async () => {
        const bases = await client.listKbBases();
        if (bases.length === 0)
            return ok("No knowledge bases yet. Create one with `kb_create_base`.");
        const lines = ["## Knowledge bases\n"];
        for (const b of bases) {
            // Show visibility — that's the access signal that matters.
            // The legacy `agent_write_enabled` column is no longer a write
            // gate; per-resource access lives in the workspace member matrix.
            const visBadge = b.visibility === "private" ? " _(private)_" : "";
            const desc = b.description ? `\n  ${b.description}` : "";
            lines.push(`- **${b.name}** (slug: \`${b.slug}\`)${visBadge}${desc}`);
        }
        return ok(lines.join("\n"));
    });
    // ── kb_get_tree ──────────────────────────────────────────────────
    register("kb_get_tree", "Get the full folder/entry tree for a knowledge base — metadata only, bodies stripped. Use as the first call when exploring a base. For an entry's body, follow up with `kb_read_file`.", { base: zod_1.z.string().describe("Base slug or id") }, async ({ base: ref }) => {
        const base = await resolveBase(client, ref);
        if (!base)
            return err(`Knowledge base not found: ${ref}. If you may have deleted it, check \`kb_list_trash\` and restore with \`kb_restore_base\`.`);
        const tree = await client.getKbTree(base.id);
        const lines = [
            `## ${tree.base.name} \`${tree.base.slug}\``,
            `Folders: ${tree.folders.length} · Entries: ${tree.entries.length}`,
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
                lines.push(`${prefix}📁 ${f.name}/`);
                dump(f.id, prefix + "  ");
            }
            for (const e of childEntries.get(parentId) ?? []) {
                lines.push(`${prefix}📄 ${e.title}`);
            }
        }
        dump(null, "");
        return ok(lines.join("\n"));
    });
    // ── kb_create_base ───────────────────────────────────────────────
    register("kb_create_base", "Create a new knowledge base in the active workspace. New bases are private to the creator by default — only the creator (and their agent) can read or write. The creator can later publish to the whole workspace from the base's settings page.", {
        name: zod_1.z.string().min(1).max(120),
        description: zod_1.z.string().max(2000).optional(),
    }, async ({ name, description }) => {
        const base = await client.createKbBase({ name, description });
        const visNote = base.visibility === "private"
            ? "Private to you — only you and your agent can see it."
            : "Visible to the whole workspace.";
        return ok(`Created knowledge base **${base.name}** (slug: \`${base.slug}\`). ${visNote}`);
    });
    // ── kb_update_base ───────────────────────────────────────────────
    register("kb_update_base", "Update knowledge-base metadata: name, description, slug. Real access control (who can read/write each base) is the workspace member matrix; that's not edited here.", {
        base: zod_1.z.string().describe("Base slug or id"),
        name: zod_1.z.string().min(1).max(120).optional(),
        description: zod_1.z.string().max(2000).nullable().optional(),
        slug: zod_1.z.string().min(1).max(80).optional(),
    }, async ({ base: ref, name, description, slug }) => {
        const base = await resolveBase(client, ref);
        if (!base)
            return err(`Knowledge base not found: ${ref}. If you may have deleted it, check \`kb_list_trash\` and restore with \`kb_restore_base\`.`);
        const updated = await client.updateKbBase(base.id, {
            name,
            description,
            slug,
        });
        return ok(`Updated **${updated.name}** (slug: \`${updated.slug}\`).`);
    });
    // ── kb_delete_base ───────────────────────────────────────────────
    register("kb_delete_base", "Soft-delete a knowledge base. The base + its folders + entries become invisible but remain restorable from trash via `kb_restore_base`. Confirm with the user before calling — this is destructive from the user's perspective.", { base: zod_1.z.string().describe("Base slug or id") }, async ({ base: ref }) => {
        const base = await resolveBase(client, ref);
        if (!base)
            return err(`Knowledge base not found: ${ref}. If you may have deleted it, check \`kb_list_trash\` and restore with \`kb_restore_base\`.`);
        await client.deleteKbBase(base.id);
        return ok(`Deleted **${base.name}** (slug: \`${base.slug}\`). Restore with \`kb_restore_base\`.`);
    });
    // ── kb_restore_base ──────────────────────────────────────────────
    register("kb_restore_base", "Restore a soft-deleted knowledge base. Use after `kb_list_trash` if the user wants something back. Accepts a base slug (preferred — what `kb_list_trash` shows) or a UUID.", { base: zod_1.z.string().describe("Base slug or id") }, async ({ base: ref }) => {
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
            return err(`No deleted base matches "${ref}". Use \`kb_list_trash\` to see available restores; or the base may already be active.`);
        }
        const restored = await client.restoreKbBase(trashed.id);
        return ok(`Restored **${restored.name}** (slug: \`${restored.slug}\`).`);
    });
    // ── kb_list_dir ──────────────────────────────────────────────────
    register("kb_list_dir", "List the immediate folders + entries at a path inside a knowledge base. Empty/omitted path = the base root. Returns metadata only.", {
        base: zod_1.z.string().describe("Base slug or id"),
        path: zod_1.z.string().optional().describe("'/' or '' for root, else 'foo/bar'"),
    }, async ({ base: ref, path }) => {
        const base = await resolveBase(client, ref);
        if (!base)
            return err(`Knowledge base not found: ${ref}. If you may have deleted it, check \`kb_list_trash\` and restore with \`kb_restore_base\`.`);
        const listing = await client.listKbDirByPath(base.id, path ?? "");
        const lines = [];
        const where = listing.folder ? listing.folder.name : "(root)";
        lines.push(`## ${base.name} → ${where}`);
        if (listing.folders.length === 0 && listing.entries.length === 0) {
            lines.push("Empty.");
        }
        else {
            for (const f of listing.folders)
                lines.push(`📁 ${f.name}/`);
            for (const e of listing.entries)
                lines.push(`📄 ${e.title}`);
        }
        return ok(lines.join("\n"));
    });
    // ── kb_create_folder ─────────────────────────────────────────────
    register("kb_create_folder", "Create a folder at a path. Idempotent: existing folders are no-op'd; missing parent folders are created (mkdir -p semantics). Errors only if the path already resolves to an entry of the same name.", {
        base: zod_1.z.string().describe("Base slug or id"),
        path: zod_1.z.string().min(1).describe("Folder path, e.g. 'projects/foo'"),
    }, async ({ base: ref, path }) => {
        const base = await resolveBase(client, ref);
        if (!base)
            return err(`Knowledge base not found: ${ref}. If you may have deleted it, check \`kb_list_trash\` and restore with \`kb_restore_base\`.`);
        const folder = await client.createKbFolderByPath(base.id, path);
        return ok(`Folder ready at \`${path}\` (id: \`${folder.id}\`).`);
    });
    // ── kb_delete_folder ─────────────────────────────────────────────
    register("kb_delete_folder", "Soft-delete the folder at the given path. Children remain in the DB but stop appearing in active listings. Restorable from trash. Confirm with the user before calling.", {
        base: zod_1.z.string().describe("Base slug or id"),
        path: zod_1.z.string().min(1),
    }, async ({ base: ref, path }) => {
        const base = await resolveBase(client, ref);
        if (!base)
            return err(`Knowledge base not found: ${ref}. If you may have deleted it, check \`kb_list_trash\` and restore with \`kb_restore_base\`.`);
        const result = await client.deleteKbByPath(base.id, path);
        if (result.kind !== "folder") {
            return err(`Path "${path}" resolved to a ${result.kind}, not a folder. ` +
                `Use \`kb_delete_file\` for entries.`);
        }
        return ok(`Folder deleted at \`${path}\`.`);
    });
    // ── kb_move_folder ───────────────────────────────────────────────
    register("kb_move_folder", "Move + rename a folder in one shot. The target path's leaf becomes the new folder name; missing parent folders along the new path are created. Cycles (moving a folder under its own descendant) return an error.", {
        base: zod_1.z.string().describe("Base slug or id"),
        from_path: zod_1.z.string().min(1),
        to_path: zod_1.z.string().min(1),
    }, async ({ base: ref, from_path, to_path }) => {
        const base = await resolveBase(client, ref);
        if (!base)
            return err(`Knowledge base not found: ${ref}. If you may have deleted it, check \`kb_list_trash\` and restore with \`kb_restore_base\`.`);
        const result = await client.moveKbByPath(base.id, from_path, to_path);
        if (result.kind !== "folder") {
            return err(`Path "${from_path}" resolved to a ${result.kind}, not a folder.`);
        }
        return ok(`Folder moved: \`${from_path}\` → \`${to_path}\`.`);
    });
    // ── kb_read_file ─────────────────────────────────────────────────
    register("kb_read_file", "Read an entry's full markdown body by path. The path must resolve to an entry, not a folder.", {
        base: zod_1.z.string().describe("Base slug or id"),
        path: zod_1.z.string().min(1).describe("Entry path, e.g. 'notes/q4-plan.md'"),
    }, async ({ base: ref, path }) => {
        const base = await resolveBase(client, ref);
        if (!base)
            return err(`Knowledge base not found: ${ref}. If you may have deleted it, check \`kb_list_trash\` and restore with \`kb_restore_base\`.`);
        const entry = await client.readKbFileByPath(base.id, path);
        const lines = [
            `# ${entry.title}`,
            `Path: \`${path}\` · Last edited: ${entry.lastEditedSource} on ${entry.updatedAt}`,
            "",
            "---",
            "",
            entry.body,
        ];
        return ok(lines.join("\n"));
    });
    // ── kb_write_file ────────────────────────────────────────────────
    register("kb_write_file", "Upsert an entry. The `path` argument is the storage path (used to resolve an existing entry to update); for **new** entries, the entry's title becomes its addressable path going forward — pass `title` explicitly when you want a clean human-readable title (the leaf path segment is a fallback when no title is given). Parent folders are created mkdir-p. After creation, address the entry by its title for subsequent reads/moves. Returns the entry's new state.", {
        base: zod_1.z.string().describe("Base slug or id"),
        path: zod_1.z
            .string()
            .min(1)
            .describe("Entry path, e.g. 'specs/api/v1.md'"),
        body: zod_1.z.string().describe("Markdown body"),
        title: zod_1.z
            .string()
            .min(1)
            .max(300)
            .optional()
            .describe("Override the title (defaults to the leaf path segment)"),
    }, async ({ base: ref, path, body, title }) => {
        const base = await resolveBase(client, ref);
        if (!base)
            return err(`Knowledge base not found: ${ref}. If you may have deleted it, check \`kb_list_trash\` and restore with \`kb_restore_base\`.`);
        const entry = await client.writeKbFileByPath(base.id, path, {
            body,
            title,
        });
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
        return ok(`Wrote \`${canonicalPath}\` (entry id: \`${entry.id}\`, ${entry.body.length} chars).${note}`);
    });
    // ── kb_delete_file ───────────────────────────────────────────────
    register("kb_delete_file", "Soft-delete an entry at the given path. Restorable from trash. Confirm with the user before calling.", {
        base: zod_1.z.string().describe("Base slug or id"),
        path: zod_1.z.string().min(1),
    }, async ({ base: ref, path }) => {
        const base = await resolveBase(client, ref);
        if (!base)
            return err(`Knowledge base not found: ${ref}. If you may have deleted it, check \`kb_list_trash\` and restore with \`kb_restore_base\`.`);
        const result = await client.deleteKbByPath(base.id, path);
        if (result.kind !== "entry") {
            return err(`Path "${path}" resolved to a ${result.kind}, not an entry. ` +
                `Use \`kb_delete_folder\` for folders.`);
        }
        return ok(`Entry deleted at \`${path}\`. Restore via \`kb_list_trash\` + \`kb_restore_file\`.`);
    });
    // ── kb_move_file ─────────────────────────────────────────────────
    register("kb_move_file", "Move + rename an entry. Target path's parents are mkdir-p'd; leaf becomes the new title.", {
        base: zod_1.z.string().describe("Base slug or id"),
        from_path: zod_1.z.string().min(1),
        to_path: zod_1.z.string().min(1),
    }, async ({ base: ref, from_path, to_path }) => {
        const base = await resolveBase(client, ref);
        if (!base)
            return err(`Knowledge base not found: ${ref}. If you may have deleted it, check \`kb_list_trash\` and restore with \`kb_restore_base\`.`);
        const result = await client.moveKbByPath(base.id, from_path, to_path);
        if (result.kind !== "entry") {
            return err(`Path "${from_path}" resolved to a ${result.kind}, not an entry.`);
        }
        return ok(`Entry moved: \`${from_path}\` → \`${to_path}\`.`);
    });
    // ── kb_list_trash ────────────────────────────────────────────────
    register("kb_list_trash", "List soft-deleted bases, folders, and entries. Scope to one base with the optional arg, or omit to see workspace-wide trash.", { base: zod_1.z.string().optional().describe("Optional: base slug or id") }, async ({ base: ref }) => {
        let baseId;
        if (ref) {
            const base = await resolveBase(client, ref);
            if (!base)
                return err(`Knowledge base not found: ${ref}. If you may have deleted it, check \`kb_list_trash\` and restore with \`kb_restore_base\`.`);
            baseId = base.id;
        }
        const trash = await client.listKbTrash(baseId);
        const total = trash.bases.length + trash.folders.length + trash.entries.length;
        if (total === 0)
            return ok("Trash is empty.");
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
        return ok(lines.join("\n"));
    });
    // ── kb_restore_folder ────────────────────────────────────────────
    register("kb_restore_folder", "Restore a soft-deleted folder by id (paths don't apply post-deletion). Get the id from `kb_list_trash`.", { folder_id: zod_1.z.string().uuid() }, async ({ folder_id }) => {
        const folder = await client.restoreKbFolder(folder_id);
        return ok(`Restored folder **${folder.name}** (id: \`${folder.id}\`).`);
    });
    // ── kb_restore_file ──────────────────────────────────────────────
    register("kb_restore_file", "Restore a soft-deleted entry by id. Get the id from `kb_list_trash`.", { entry_id: zod_1.z.string().uuid() }, async ({ entry_id }) => {
        const entry = await client.restoreKbEntry(entry_id);
        return ok(`Restored entry **${entry.title}** (id: \`${entry.id}\`).`);
    });
    // ── kb_search ────────────────────────────────────────────────────
    register("kb_search", "Full-text search across the workspace's knowledge bases. Returns ranked entries with title, snippet (with `<b>` tags around matches), and the path you can pass to `kb_read_file` to fetch the body. Optional `base` slug narrows the search to one base.", {
        query: zod_1.z.string().min(1).describe("Free-text query, e.g. 'cold open template'"),
        base: zod_1.z.string().optional().describe("Optional base slug to narrow results"),
        limit: zod_1.z.number().int().min(1).max(100).optional().describe("Max hits (default 20)"),
    }, async ({ query, base, limit }) => {
        const hits = await client.searchKb(query, { baseSlug: base, limit });
        if (hits.length === 0) {
            return ok(`No matches for "${query}".`);
        }
        const lines = [`## ${hits.length} match${hits.length === 1 ? "" : "es"} for "${query}"\n`];
        for (const h of hits) {
            // Strip the highlight tags for plain-text agent consumption.
            const cleanSnippet = h.snippet.replace(/<\/?b>/g, "**");
            lines.push(`- **${h.title}** _(rank ${h.rank.toFixed(2)})_ — entry id: \`${h.entryId}\`\n  ${cleanSnippet}`);
        }
        return ok(lines.join("\n"));
    });
}
