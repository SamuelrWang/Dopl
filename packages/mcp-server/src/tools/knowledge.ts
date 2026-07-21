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

/**
 * Clean surface for the F-10 read-only-base delete rejection. The API
 * returns 403 `AGENT_WRITE_DISABLED` when an agent tries to delete a base
 * (or anything inside it) that's flagged `agent_write_enabled=false`.
 * Surface the server's actionable message verbatim instead of a raw throw
 * or a `CODE: message` dump. Returns null otherwise so the caller rethrows.
 * Duck-typed on `.status` / `.code` to avoid importing the @dopl/client
 * error class across the module boundary (same pattern as isConflict).
 */
function agentWriteDenied(e: unknown): ToolResponse | null {
  if (
    typeof e !== "object" ||
    e === null ||
    (e as { status?: number }).status !== 403 ||
    (e as { code?: unknown }).code !== "AGENT_WRITE_DISABLED"
  ) {
    return null;
  }
  const msg = (e as { apiMessage?: unknown }).apiMessage;
  return err(
    typeof msg === "string" && msg
      ? msg
      : "This knowledge base is read-only to agents — delete it from the Dopl web UI."
  );
}

/**
 * True when a thrown @dopl/client error is a 400 schema-validation
 * failure (`{ error: { code: "VALIDATION_FAILED", details } }`). Duck-typed
 * on `.status` / `.code` so it works across the @dopl/client module
 * boundary without importing the error class (same pattern as isConflict).
 */
function isValidationError(
  e: unknown
): e is { status: number; code: string; details: unknown } {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { status?: number }).status === 400 &&
    (e as { code?: unknown }).code === "VALIDATION_FAILED"
  );
}

/** Field names named by a validation error's zod-issue `details` array. */
function validationFields(details: unknown): Set<string> {
  const fields = new Set<string>();
  if (Array.isArray(details)) {
    for (const issue of details) {
      const path = (issue as { path?: unknown }).path;
      const first = Array.isArray(path) ? path[0] : undefined;
      if (typeof first === "string") fields.add(first);
    }
  }
  return fields;
}

/**
 * Bidirectional / directional-formatting control chars the name schema
 * rejects as an anti-spoofing measure: embeddings + overrides
 * (U+202A–U+202E), isolates (U+2066–U+2069), the LTR/RTL marks
 * (U+200E/U+200F), and the Arabic letter mark (U+061C). Named explicitly
 * so the validation error can point at the exact offending code point.
 */
const BIDI_CONTROL_RE = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/;

/** `U+XXXX` for the first bidi control char in `text`, else null. */
function namedBidiChar(text: string): string | null {
  const m = BIDI_CONTROL_RE.exec(text);
  if (!m) return null;
  const cp = m[0].codePointAt(0) ?? 0;
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * Maps a `write_file` validation failure to a tool-shaped message naming
 * the field + rule + recovery (F-18). Returns null when the error isn't a
 * recognized validation failure so the caller rethrows.
 */
function writeFileValidationError(e: unknown, title?: string): ToolResponse | null {
  if (!isValidationError(e)) return null;
  const fields = validationFields(e.details);
  // path is the only other write_file field and carries no schema rule
  // (z.string()), so a validation failure is a title (or body-size) issue.
  if (fields.has("title") || fields.size === 0) {
    const t = title ?? "";
    const bidi = namedBidiChar(t);
    if (bidi) {
      return err(
        `write_file: title contains a disallowed bidirectional control character (${bidi}) — remove it and retry (this block prevents right-to-left path spoofing).`
      );
    }
    if (t.includes("/")) {
      return err(
        `write_file: titles can't contain '/' (it's the path separator) — use a different title, or create the folder via the path and give the entry a clean title.`
      );
    }
    if (fields.has("title")) {
      return err(
        `write_file: title is invalid — it can't contain control or zero-width characters or leading/trailing whitespace. Use a plain title.`
      );
    }
  }
  if (fields.has("body")) {
    return err(`write_file: body is too large — the limit is 1 MB. Split it into multiple entries.`);
  }
  return err(
    `write_file: request body failed validation${fields.size ? ` (field: ${[...fields].join(", ")})` : ""}. Titles can't contain '/', control, or zero-width characters.`
  );
}

/**
 * Maps an `update_base` validation failure to a tool-shaped message
 * naming the field + rule + recovery (F-18). Returns null when the error
 * isn't a recognized validation failure so the caller rethrows.
 */
function updateBaseValidationError(e: unknown): ToolResponse | null {
  if (!isValidationError(e)) return null;
  const fields = validationFields(e.details);
  if (fields.has("slug")) {
    return err(
      `update_base: slug must match ^[a-z0-9-]+$ — lowercase letters, digits, and hyphens only (no leading/trailing hyphen, no spaces).`
    );
  }
  if (fields.has("name")) {
    return err(`update_base: name can't be blank — pass a non-empty name, or omit it to leave the name unchanged.`);
  }
  if (fields.has("description")) {
    return err(`update_base: description is too long.`);
  }
  return err(
    `update_base: request body failed validation${fields.size ? ` (field: ${[...fields].join(", ")})` : ""}.`
  );
}

const KB_DESCRIPTION = `Manage the caller's own editable knowledge bases. Talk to these like a filesystem. Bases are addressed by slug or id; folders/entries by \`/\`-separated path. Set \`op\` to one of:
- "list_bases" — list the bases the caller can access in the active workspace. Returns slugs to address with subsequent ops.
- "get_tree" — full folder/entry tree for a base (metadata only, bodies stripped). First call when exploring a base; for a body follow up with op=read_file.
- "list_dir" — immediate folders + entries at a path. Empty/omitted path = base root. Metadata only.
- "create_base" — create a new base. New bases are private to the creator by default.
- "update_base" — update base metadata (name, description, slug). Access control is the workspace member matrix, not edited here.
- "restore_base" — restore a soft-deleted base (recovery, not deletion). Use after op=list_trash. Accepts the trashed base's slug or a UUID.
- "create_folder" — create a folder at a path. mkdir -p semantics; idempotent on existing folders.
- "move_folder" — move + rename a folder; leaf becomes the new name, missing parents created, cycles rejected.
- "read_file" — read an entry's full markdown body by path (must resolve to an entry, not a folder). Returns a Version token — pass it to write_file as \`expected_version\`.
- "write_file" — upsert an entry. Pass \`path\` to target an existing entry (or a new one at that path); for a brand-new entry you may instead pass just \`title\` and it becomes the addressable path. Titles can't contain \`/\` — it's the path separator. Parents mkdir-p'd. Overwriting an existing entry REQUIRES \`expected_version\` from a prior read_file (412 without it) so a concurrent edit can't be silently overwritten; \`force=true\` skips the check. Creates need no version.
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
      path: z.string().optional().describe("Path within the base. list_dir: '/' or '' for root. create_folder: required, e.g. 'projects/foo'. read_file: required entry path. write_file: entry path — required unless you pass `title` (then the title becomes the path). delete uses dopl_kb_admin."),
      from_path: z.string().optional().describe("move_folder/move_file: source path."),
      to_path: z.string().optional().describe("move_folder/move_file: destination path (leaf becomes the new name/title)."),
      name: z.string().optional().describe("create_base: required base name (1-120 chars). update_base: optional new name."),
      description: z.string().optional().describe("create_base/update_base: optional base description (max 2000)."),
      slug: z.string().optional().describe("update_base: optional new slug (1-80 chars)."),
      body: z.string().max(1_048_576).optional().describe("write_file: required markdown body. Can't be empty — pass a single space for a deliberate stub."),
      title: z.string().optional().describe("write_file: title for the entry — can't contain '/'. Doubles as the addressable path for a new entry when `path` is omitted; otherwise an optional override (defaults to the leaf path segment)."),
      expected_version: z.string().optional().describe("write_file: the entry's Version from a prior read_file. Required when overwriting an existing entry — omitting it fails with 412; only force=true skips the check. Creates need no version."),
      force: z.boolean().optional().describe("write_file: overwrite even if the entry changed since you read it. Discards the other edit — use only when intentional."),
      folder_id: z.string().optional().describe("restore_folder: required folder UUID (from list_trash)."),
      entry_id: z.string().optional().describe("restore_file: required entry UUID (from list_trash)."),
      query: z.string().optional().describe("search: required free-text query."),
      // coerce: MCP clients sometimes send numbers as strings; strict
      // z.number() rejects them with an opaque -32602.
      limit: z.coerce.number().int().min(1).max(100).optional().describe("search: max hits (default 20, 1-100)."),
      entry_limit: z.coerce.number().int().min(1).max(1000).optional().describe("get_tree: max entries per page (default 400, 1-1000). Folders always ship in full."),
      entry_cursor: z.string().optional().describe("get_tree: opaque cursor from a prior page's 'more entries' notice — fetches the next page."),
      visibility: z.enum(["public", "private"]).optional().describe("op=set_visibility: 'public' to publish a base you created (makes it workspace-visible + referenceable in workflows). One-way — 'private' is rejected."),
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "list_bases":
          return opListBases(client);
        case "get_tree": {
          const miss = missingParams("get_tree", args, ["base"]);
          if (miss) return miss;
          return opGetTree(client, args.base as string, args.entry_limit, args.entry_cursor);
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
          const miss = missingParams("write_file", args, ["base"]);
          if (miss) return miss;
          // F-21: title-only creation. The op doc says a new entry's title
          // becomes its addressable path, so derive the path from title when
          // path is omitted. Existing path-based calls are unaffected.
          const path =
            args.path !== undefined && args.path !== ""
              ? args.path
              : args.title;
          if (path === undefined || path === "") {
            return err(
              `op="write_file" is missing required param: path (pass path, or a title to derive it).`
            );
          }
          // F-17: an empty-string body is a real value the caller can fix,
          // not a "missing param" — distinguish it from a genuinely omitted
          // body so the message is actionable.
          if (args.body === undefined) {
            return err(`op="write_file" is missing required param: body.`);
          }
          if (args.body === "") {
            return err(
              `write_file: body cannot be empty — pass content (or a single space for a stub).`
            );
          }
          return opWriteFile(client, args.base as string, path, args.body, args.title, args.expected_version, args.force);
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
const TREE_ENTRY_MAX = 1000;

async function opGetTree(
  client: DoplClient,
  ref: string,
  entryLimit?: number,
  entryCursor?: string
): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
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
      lines.push(`${prefix}📄 ${e.title}${descSuffix(e.excerpt)}`);
    }
  }
  dump(null, "");
  if (tree.nextEntryCursor) {
    lines.push(
      "",
      `_Showing ${tree.entries.length} of ${entryTotal} entries. Pass entry_cursor="${tree.nextEntryCursor}" for the next page, or narrow with op="list_dir" / op="search"._`
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
  let updated;
  try {
    updated = await client.updateKbBase(base.id, {
      name,
      description,
      slug,
    });
  } catch (e) {
    // F-10b: read-only-to-agents base — surface the clean message the
    // delete ops use, not a raw AGENT_WRITE_DISABLED dump.
    const denied = agentWriteDenied(e);
    if (denied) return denied;
    // F-18: name the field + rule instead of surfacing a raw
    // "VALIDATION_FAILED: Request body failed validation".
    const mapped = updateBaseValidationError(e);
    if (mapped) return mapped;
    throw e;
  }
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
  let updated;
  try {
    updated = await client.updateKbBase(base.id, { visibility: "public" });
  } catch (e) {
    // F-10b: read-only-to-agents base — surface the clean message the other
    // write ops use, not a raw AGENT_WRITE_DISABLED dump.
    const denied = agentWriteDenied(e);
    if (denied) return denied;
    throw e;
  }
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
  let restored;
  try {
    restored = await client.restoreKbBase(trashed.id);
  } catch (e) {
    // F-10b: read-only-to-agents base — clean message, not a raw
    // AGENT_WRITE_DISABLED dump.
    const denied = agentWriteDenied(e);
    if (denied) return denied;
    throw e;
  }
  return ok(
    `Restored **${restored.name}** (slug: \`${restored.slug}\`).`
  );
}

async function opCreateFolder(client: DoplClient, ref: string, path: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  let folder;
  try {
    folder = await client.createKbFolderByPath(base.id, path);
  } catch (e) {
    // F-10b: read-only-to-agents base — clean message, not a raw
    // AGENT_WRITE_DISABLED dump.
    const denied = agentWriteDenied(e);
    if (denied) return denied;
    throw e;
  }
  return ok(`Folder ready at \`${path}\` (id: \`${folder.id}\`).`);
}

async function opMoveFolder(client: DoplClient, ref: string, from_path: string, to_path: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  let result;
  try {
    result = await client.moveKbByPath(base.id, from_path, to_path);
  } catch (e) {
    // F-10b: read-only-to-agents base — clean message, not a raw
    // AGENT_WRITE_DISABLED dump.
    const denied = agentWriteDenied(e);
    if (denied) return denied;
    throw e;
  }
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
    // F-10b: read-only-to-agents base — clean message, not a raw dump.
    const denied = agentWriteDenied(e);
    if (denied) return denied;
    // F-18: name the failing field + rule instead of surfacing a raw
    // "VALIDATION_FAILED: Request body failed validation".
    const mapped = writeFileValidationError(e, title);
    if (mapped) return mapped;
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
  let result;
  try {
    result = await client.moveKbByPath(base.id, from_path, to_path);
  } catch (e) {
    // F-10b: read-only-to-agents base — clean message, not a raw
    // AGENT_WRITE_DISABLED dump.
    const denied = agentWriteDenied(e);
    if (denied) return denied;
    throw e;
  }
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
  // F-16: `base` accepts a slug OR a UUID, like every other op. Resolve it
  // the same way the other ops do (the search endpoint only narrows by
  // slug, so pass the resolved base's slug through) instead of forwarding a
  // UUID straight to `baseSlug`, which would 404 with KNOWLEDGE_BASE_NOT_FOUND.
  let baseSlug: string | undefined;
  if (base) {
    const resolved = await resolveBaseOr(client, base);
    if (isErr(resolved)) return resolved;
    baseSlug = resolved.slug;
  }
  const hits = await client.searchKb(query, { baseSlug, limit });
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
  try {
    await client.deleteKbBase(base.id);
  } catch (e) {
    // F-10: a base flagged read-only to agents rejects agent deletes.
    const denied = agentWriteDenied(e);
    if (denied) return denied;
    throw e;
  }
  return ok(
    `Deleted **${base.name}** (slug: \`${base.slug}\`). Restore with \`dopl_kb(op='restore_base')\`.`
  );
}

async function opDeleteFolder(client: DoplClient, ref: string, path: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  let result;
  try {
    result = await client.deleteKbByPath(base.id, path);
  } catch (e) {
    const denied = agentWriteDenied(e);
    if (denied) return denied;
    throw e;
  }
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
  let result;
  try {
    result = await client.deleteKbByPath(base.id, path);
  } catch (e) {
    const denied = agentWriteDenied(e);
    if (denied) return denied;
    throw e;
  }
  if (result.kind !== "entry") {
    return err(
      `Path "${path}" resolved to a ${result.kind}, not an entry. ` +
        `Use \`dopl_kb_admin(op='delete_folder')\` for folders.`
    );
  }
  return ok(`Entry deleted at \`${path}\`. Restore via \`dopl_kb(op='list_trash')\` + \`dopl_kb(op='restore_file')\`.`);
}
