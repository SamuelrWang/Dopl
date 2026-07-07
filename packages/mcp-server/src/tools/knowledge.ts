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

import { z } from "zod";
import type { DoplClient, KnowledgeBase } from "@dopl/client";
import { ok, err, isConflict, isAlreadyExists, missingParams, type RegisterTool, type ToolResponse } from "./respond";

/**
 * Resolves a base reference (slug or UUID) to a `KnowledgeBase` row.
 * Returns null when nothing matches. Calls `listKbBases` once per
 * invocation — fine for agent throughput, not great for tight loops.
 */
async function resolveBase(client: DoplClient, ref: string): Promise<KnowledgeBase | null> {
  const bases = await client.listKbBases();
  return bases.find((b) => b.slug === ref || b.id === ref) ?? null;
}

/**
 * resolveBase + the standard not-found error. Returns the base, or a
 * ToolResponse error (caller short-circuits on the `isError` branch).
 */
async function resolveBaseOr(client: DoplClient, ref: string): Promise<KnowledgeBase | ToolResponse> {
  const base = await resolveBase(client, ref);
  if (!base)
    return err(`Knowledge base not found: ${ref}. If you may have deleted it, check \`dopl_kb(op='list_trash')\` and restore with \`dopl_kb(op='restore_base')\`.`);
  return base;
}

function isErr(x: KnowledgeBase | ToolResponse): x is ToolResponse {
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

Destructive deletes live in the separate \`dopl_kb_admin\` tool.`;

const KB_ADMIN_DESCRIPTION = `DESTRUCTIVE knowledge-base operations on the caller's OWN editable bases. Every op here is a soft-delete — the resource becomes invisible in active listings but stays restorable from trash (\`dopl_kb\` op=list_trash + the matching restore op). Confirm with the user before calling. Set \`op\` to one of:
- "delete_base" — soft-delete a base (+ its folders + entries). Restore with \`dopl_kb\` op=restore_base.
- "delete_folder" — soft-delete the folder at a path. Children stop appearing in active listings; restorable from trash.
- "delete_file" — soft-delete the entry at a path. Restorable from trash.`;

export function registerKnowledgeTools(register: RegisterTool, client: DoplClient): void {
  // ── dopl_kb — read + non-destructive writes ──────────────────────
  register(
    "dopl_kb",
    KB_DESCRIPTION,
    {
      op: z
        .enum([
          "list_bases", "get_tree", "list_dir", "create_base", "update_base",
          "restore_base", "create_folder", "move_folder", "read_file", "write_file",
          "move_file", "list_trash", "restore_file", "restore_folder", "search",
          "set_visibility",
        ])
        .describe("Operation to perform."),
      base: z.string().optional().describe("Base slug or id. Required for get_tree/list_dir/update_base/restore_base/create_folder/move_folder/read_file/write_file/move_file; optional scope for list_trash/search."),
      path: z.string().optional().describe("Path within the base. list_dir: '/' or '' for root. create_folder: required, e.g. 'projects/foo'. read_file/write_file: required entry path. delete uses dopl_kb_admin."),
      from_path: z.string().optional().describe("move_folder/move_file: source path."),
      to_path: z.string().optional().describe("move_folder/move_file: destination path (leaf becomes the new name/title)."),
      name: z.string().optional().describe("create_base: required base name (1-120 chars). update_base: optional new name."),
      description: z.string().optional().describe("create_base/update_base: optional base description (max 2000)."),
      slug: z.string().optional().describe("update_base: optional new slug (1-80 chars)."),
      body: z.string().optional().describe("write_file: required markdown body."),
      title: z.string().optional().describe("write_file: optional title override (defaults to the leaf path segment)."),
      expected_version: z.string().optional().describe("write_file: the entry's version from a prior read_file, to avoid overwriting a concurrent edit (412 on mismatch). Omit to auto-guard against the current version."),
      force: z.boolean().optional().describe("write_file: overwrite even if the entry changed since you read it. Discards the other edit — use only when intentional."),
      folder_id: z.string().optional().describe("restore_folder: required folder UUID (from list_trash)."),
      entry_id: z.string().optional().describe("restore_file: required entry UUID (from list_trash)."),
      query: z.string().optional().describe("search: required free-text query."),
      limit: z.number().optional().describe("search: max hits (default 20)."),
      visibility: z.enum(["public", "private"]).optional().describe("op=set_visibility: 'public' to publish a base you created (makes it workspace-visible + referenceable in workflows). One-way — 'private' is rejected."),
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "list_bases":
          return opListBases(client);
        case "get_tree": {
          const miss = missingParams("get_tree", args, ["base"]);
          if (miss) return miss;
          return opGetTree(client, args.base as string);
        }
        case "list_dir": {
          const miss = missingParams("list_dir", args, ["base"]);
          if (miss) return miss;
          return opListDir(client, args.base as string, args.path);
        }
        case "create_base": {
          const miss = missingParams("create_base", args, ["name"]);
          if (miss) return miss;
          return opCreateBase(client, args.name as string, args.description);
        }
        case "update_base": {
          const miss = missingParams("update_base", args, ["base"]);
          if (miss) return miss;
          return opUpdateBase(client, args.base as string, args.name, args.description, args.slug);
        }
        case "restore_base": {
          const miss = missingParams("restore_base", args, ["base"]);
          if (miss) return miss;
          return opRestoreBase(client, args.base as string);
        }
        case "create_folder": {
          const miss = missingParams("create_folder", args, ["base", "path"]);
          if (miss) return miss;
          return opCreateFolder(client, args.base as string, args.path as string);
        }
        case "move_folder": {
          const miss = missingParams("move_folder", args, ["base", "from_path", "to_path"]);
          if (miss) return miss;
          return opMoveFolder(client, args.base as string, args.from_path as string, args.to_path as string);
        }
        case "read_file": {
          const miss = missingParams("read_file", args, ["base", "path"]);
          if (miss) return miss;
          return opReadFile(client, args.base as string, args.path as string);
        }
        case "write_file": {
          const miss = missingParams("write_file", args, ["base", "path", "body"]);
          if (miss) return miss;
          return opWriteFile(client, args.base as string, args.path as string, args.body as string, args.title, args.expected_version, args.force);
        }
        case "move_file": {
          const miss = missingParams("move_file", args, ["base", "from_path", "to_path"]);
          if (miss) return miss;
          return opMoveFile(client, args.base as string, args.from_path as string, args.to_path as string);
        }
        case "list_trash":
          return opListTrash(client, args.base);
        case "restore_file": {
          const miss = missingParams("restore_file", args, ["entry_id"]);
          if (miss) return miss;
          return opRestoreFile(client, args.entry_id as string);
        }
        case "restore_folder": {
          const miss = missingParams("restore_folder", args, ["folder_id"]);
          if (miss) return miss;
          return opRestoreFolder(client, args.folder_id as string);
        }
        case "search": {
          const miss = missingParams("search", args, ["query"]);
          if (miss) return miss;
          return opSearch(client, args.query as string, args.base, args.limit);
        }
        case "set_visibility": {
          const miss = missingParams("set_visibility", args, ["base", "visibility"]);
          if (miss) return miss;
          return opSetVisibility(client, args.base as string, args.visibility as string);
        }
      }
    }
  );

  // ── dopl_kb_admin — DESTRUCTIVE soft-deletes ─────────────────────
  register(
    "dopl_kb_admin",
    KB_ADMIN_DESCRIPTION,
    {
      op: z
        .enum(["delete_base", "delete_folder", "delete_file"])
        .describe("Destructive operation to perform."),
      base: z.string().optional().describe("Base slug or id. Required for all ops."),
      path: z
        .string()
        .optional()
        .describe("delete_folder/delete_file: required path of the resource to soft-delete."),
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "delete_base": {
          const miss = missingParams("delete_base", args, ["base"]);
          if (miss) return miss;
          return opDeleteBase(client, args.base as string);
        }
        case "delete_folder": {
          const miss = missingParams("delete_folder", args, ["base", "path"]);
          if (miss) return miss;
          return opDeleteFolder(client, args.base as string, args.path as string);
        }
        case "delete_file": {
          const miss = missingParams("delete_file", args, ["base", "path"]);
          if (miss) return miss;
          return opDeleteFile(client, args.base as string, args.path as string);
        }
      }
    }
  );
}

async function opListBases(client: DoplClient): Promise<ToolResponse> {
  const bases = await client.listKbBases();
  if (bases.length === 0)
    return ok("No knowledge bases yet. Create one with `dopl_kb(op='create_base')`.");
  const lines = ["## Knowledge bases\n"];
  for (const b of bases) {
    // Surface the immutable id alongside the slug (the slug changes on
    // rename; the id is a stable handle) plus the access signal.
    const vis = b.visibility === "private" ? "private" : "public";
    const desc = b.description ? `\n  ${b.description}` : "";
    lines.push(
      `- **${b.name}** (slug: \`${b.slug}\` · id: \`${b.id}\` · ${vis})${desc}`,
    );
  }
  return ok(lines.join("\n"));
}

const TREE_ENTRY_CAP = 400;

async function opGetTree(client: DoplClient, ref: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  const tree = await client.getKbTree(base.id);
  const vis = tree.base.visibility === "private" ? "private" : "public";
  const lines = [
    `## ${tree.base.name} \`${tree.base.slug}\``,
    `id: \`${tree.base.id}\` · ${vis} · agent-write ${tree.base.agentWriteEnabled ? "on" : "off"}`,
    ...(tree.base.description ? [tree.base.description] : []),
    `Folders: ${tree.folders.length} · Entries: ${tree.entries.length}`,
    "",
  ];
  let printedEntries = 0;
  let truncated = false;
  // Build a tree view by walking parent_id / folder_id.
  const childFolders = new Map<string | null, typeof tree.folders>();
  for (const f of tree.folders) {
    const arr = childFolders.get(f.parentId) ?? [];
    arr.push(f);
    childFolders.set(f.parentId, arr);
  }
  for (const arr of childFolders.values())
    arr.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const childEntries = new Map<string | null, typeof tree.entries>();
  for (const e of tree.entries) {
    const arr = childEntries.get(e.folderId) ?? [];
    arr.push(e);
    childEntries.set(e.folderId, arr);
  }
  for (const arr of childEntries.values())
    arr.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
  function dump(parentId: string | null, prefix: string): void {
    for (const f of childFolders.get(parentId) ?? []) {
      lines.push(`${prefix}📁 ${f.name}/${descSuffix(f.description)}`);
      dump(f.id, prefix + "  ");
    }
    for (const e of childEntries.get(parentId) ?? []) {
      if (printedEntries >= TREE_ENTRY_CAP) {
        truncated = true;
        return;
      }
      printedEntries += 1;
      lines.push(`${prefix}📄 ${e.title}${descSuffix(e.excerpt)}`);
    }
  }
  dump(null, "");
  if (truncated) {
    lines.push(
      "",
      `_Tree truncated at ${TREE_ENTRY_CAP} of ${tree.entries.length} entries. Browse a folder with op="list_dir" or find entries by content with op="search"._`
    );
  }
  return ok(lines.join("\n"));
}

/**
 * ` — description` suffix for tree / directory rows. Folder
 * `description` and entry `excerpt` are the user-curated, agent-facing
 * summaries (≤300 chars) — surfacing them here lets agents pick the
 * right file from a listing instead of read_file-ing everything.
 * Newlines are flattened so one row stays one line.
 */
function descSuffix(text: string | null | undefined): string {
  if (!text) return "";
  return ` — ${text.replace(/\s*\n+\s*/g, " ")}`;
}

async function opListDir(client: DoplClient, ref: string, path?: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  const listing = await client.listKbDirByPath(base.id, path ?? "");
  const lines: string[] = [];
  const where = listing.folder ? listing.folder.name : "(root)";
  lines.push(`## ${base.name} → ${where}`);
  if (listing.folder?.description) lines.push(listing.folder.description);
  if (listing.folders.length === 0 && listing.entries.length === 0) {
    lines.push("Empty.");
  } else {
    for (const f of listing.folders)
      lines.push(`📁 ${f.name}/${descSuffix(f.description)}`);
    for (const e of listing.entries)
      lines.push(`📄 ${e.title}${descSuffix(e.excerpt)}`);
  }
  return ok(lines.join("\n"));
}

async function opCreateBase(client: DoplClient, name: string, description?: string): Promise<ToolResponse> {
  const base = await client.createKbBase({ name, description });
  const visNote =
    base.visibility === "private"
      ? "Private to you — only you and your agent can see it."
      : "Visible to the whole workspace.";
  return ok(
    `Created knowledge base **${base.name}** (slug: \`${base.slug}\`). ${visNote}`
  );
}

async function opUpdateBase(client: DoplClient, ref: string, name?: string, description?: string | null, slug?: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  const updated = await client.updateKbBase(base.id, {
    name,
    description,
    slug,
  });
  return ok(
    `Updated **${updated.name}** (slug: \`${updated.slug}\`).`
  );
}

async function opSetVisibility(client: DoplClient, ref: string, visibility: string): Promise<ToolResponse> {
  if (visibility !== "public") {
    return err(
      `set_visibility only publishes (visibility="public") a base you created. Un-publishing and team scope are human-only — use the Dopl web UI.`,
    );
  }
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  const updated = await client.updateKbBase(base.id, { visibility: "public" });
  return ok(
    `Published knowledge base **${updated.name}** (slug: \`${updated.slug}\`) — now visible workspace-wide and referenceable in workflows.`,
  );
}

async function opRestoreBase(client: DoplClient, ref: string): Promise<ToolResponse> {
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
  const trashed = trash.bases.find(
    (b) => b.slug === ref || b.id === ref
  );
  if (!trashed) {
    return err(
      `No deleted base matches "${ref}". Use \`dopl_kb(op='list_trash')\` to see available restores; or the base may already be active.`
    );
  }
  const restored = await client.restoreKbBase(trashed.id);
  return ok(
    `Restored **${restored.name}** (slug: \`${restored.slug}\`).`
  );
}

async function opCreateFolder(client: DoplClient, ref: string, path: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  const folder = await client.createKbFolderByPath(base.id, path);
  return ok(`Folder ready at \`${path}\` (id: \`${folder.id}\`).`);
}

async function opMoveFolder(client: DoplClient, ref: string, from_path: string, to_path: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  const result = await client.moveKbByPath(base.id, from_path, to_path);
  if (result.kind !== "folder") {
    return err(
      `Path "${from_path}" resolved to a ${result.kind}, not a folder.`
    );
  }
  return ok(`Folder moved: \`${from_path}\` → \`${to_path}\`.`);
}

async function opReadFile(client: DoplClient, ref: string, path: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
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
  return ok(lines.join("\n"));
}

async function opWriteFile(client: DoplClient, ref: string, path: string, body: string, title?: string, expected_version?: string, force?: boolean): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  let entry;
  let webUrl: string;
  try {
    const res = await client.writeKbFileByPath(
      base.id,
      path,
      { body, title },
      force ? null : expected_version
    );
    entry = res.entry;
    webUrl = res.webUrl;
  } catch (e) {
    if (isConflict(e)) {
      return err(
        `\`${path}\` changed since you last read it. Call dopl_kb(op="read_file", base, path) to get the current content + version, reconcile your changes, then retry write_file with that expected_version (or pass force=true to overwrite).`
      );
    }
    if (isAlreadyExists(e)) {
      return err(
        `An entry titled "${title ?? path.split("/").filter(Boolean).pop()}" already exists in that folder. Pick a different title/path, or read+overwrite the existing entry with dopl_kb(op="read_file" → "write_file").`
      );
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
  const note =
    canonicalPath !== path
      ? ` Address future reads/moves with path \`${canonicalPath}\`.`
      : "";
  return ok(
    `Wrote \`${canonicalPath}\` (entry id: \`${entry.id}\`, ${entry.body.length} chars). New version: \`${entry.updatedAt}\`.${note}\nView in Dopl: ${webUrl}`
  );
}

async function opMoveFile(client: DoplClient, ref: string, from_path: string, to_path: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  const result = await client.moveKbByPath(base.id, from_path, to_path);
  if (result.kind !== "entry") {
    return err(
      `Path "${from_path}" resolved to a ${result.kind}, not an entry.`
    );
  }
  return ok(`Entry moved: \`${from_path}\` → \`${to_path}\`.`);
}

async function opListTrash(client: DoplClient, ref?: string): Promise<ToolResponse> {
  let baseId: string | undefined;
  if (ref) {
    const base = await resolveBaseOr(client, ref);
    if (isErr(base)) return base;
    baseId = base.id;
  }
  const trash = await client.listKbTrash(baseId);
  const total =
    trash.bases.length + trash.folders.length + trash.entries.length;
  if (total === 0) return ok("Trash is empty.");
  const lines: string[] = [`## Trash (${total} item${total === 1 ? "" : "s"})\n`];
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
}

async function opRestoreFolder(client: DoplClient, folder_id: string): Promise<ToolResponse> {
  let folder;
  try {
    folder = await client.restoreKbFolder(folder_id);
  } catch (e) {
    if (isAlreadyExists(e)) {
      return err(
        `Can't restore this folder — an ancestor folder is still in the trash. Restore the ancestor first (dopl_kb(op="list_trash") to find it); restoring a folder brings its contents back.`
      );
    }
    throw e;
  }
  return ok(`Restored folder **${folder.name}** (id: \`${folder.id}\`).`);
}

async function opRestoreFile(client: DoplClient, entry_id: string): Promise<ToolResponse> {
  let entry;
  try {
    entry = await client.restoreKbEntry(entry_id);
  } catch (e) {
    if (isAlreadyExists(e)) {
      return err(
        `Can't restore this entry — its parent folder is still in the trash. Restore the folder first (dopl_kb(op="list_trash") to find it); restoring a folder brings its contents back.`
      );
    }
    throw e;
  }
  return ok(`Restored entry **${entry.title}** (id: \`${entry.id}\`).`);
}

async function opSearch(client: DoplClient, query: string, base?: string, limit?: number): Promise<ToolResponse> {
  const hits = await client.searchKb(query, { baseSlug: base, limit });
  if (hits.length === 0) {
    return ok(`No matches for "${query}".`);
  }
  const lines = [`## ${hits.length} match${hits.length === 1 ? "" : "es"} for "${query}"\n`];
  for (const h of hits) {
    // Strip the highlight tags for plain-text agent consumption.
    const cleanSnippet = h.snippet.replace(/<\/?b>/g, "**");
    lines.push(
      `- **${h.title}** _(rank ${h.rank.toFixed(2)})_ — entry id: \`${h.entryId}\`\n  ${cleanSnippet}`
    );
  }
  return ok(lines.join("\n"));
}

async function opDeleteBase(client: DoplClient, ref: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  await client.deleteKbBase(base.id);
  return ok(
    `Deleted **${base.name}** (slug: \`${base.slug}\`). Restore with \`dopl_kb(op='restore_base')\`.`
  );
}

async function opDeleteFolder(client: DoplClient, ref: string, path: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  const result = await client.deleteKbByPath(base.id, path);
  if (result.kind !== "folder") {
    return err(
      `Path "${path}" resolved to a ${result.kind}, not a folder. ` +
        `Use \`dopl_kb_admin(op='delete_file')\` for entries.`
    );
  }
  return ok(`Folder deleted at \`${path}\`.`);
}

async function opDeleteFile(client: DoplClient, ref: string, path: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  const result = await client.deleteKbByPath(base.id, path);
  if (result.kind !== "entry") {
    return err(
      `Path "${path}" resolved to a ${result.kind}, not an entry. ` +
        `Use \`dopl_kb_admin(op='delete_folder')\` for folders.`
    );
  }
  return ok(`Entry deleted at \`${path}\`. Restore via \`dopl_kb(op='list_trash')\` + \`dopl_kb(op='restore_file')\`.`);
}
