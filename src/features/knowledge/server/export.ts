import "server-only";
import { strToU8, zipSync, type Zippable } from "fflate";
import { slugify } from "@/shared/lib/slug/slugify";
import { entryToMarkdown } from "../markdown";
import type { KnowledgeContext, KnowledgeEntry, KnowledgeFolder } from "../types";
import { FolderNotFoundError } from "./errors";
import * as repo from "./repository";
import { getBaseById, getEntry } from "./service";

/**
 * Knowledge export — turns a base / folder subtree into a downloadable
 * zip whose directory layout mirrors the KB tree, and a single entry
 * into a `.md` file. Each entry becomes `<slugified-title>.md`
 * (`entryToMarkdown`); folders become directories. The whole thing is
 * wrapped in one top-level dir named after the base/folder so it
 * extracts cleanly into a single directory.
 *
 * Access is enforced through `getBaseById` (workspace + private/teams
 * visibility), which every entry/folder transitively belongs to — so a
 * caller who can't read the base can't export any slice of it.
 */

export interface KnowledgeArchive {
  /** ASCII-safe download filename (slugged), e.g. `my-base.zip`. */
  filename: string;
  data: Uint8Array;
}

export interface KnowledgeFile {
  filename: string;
  content: string;
}

// ─── Public builders ────────────────────────────────────────────────

export async function buildBaseArchive(
  ctx: KnowledgeContext,
  baseId: string
): Promise<KnowledgeArchive> {
  const base = await getBaseById(ctx, baseId);
  const { folders, entries } = await loadTree(base.id);
  const data = buildZip(base.name, null, folders, entries, base.description);
  return { filename: `${slugify(base.name, "knowledge-base")}.zip`, data };
}

export async function buildFolderArchive(
  ctx: KnowledgeContext,
  folderId: string
): Promise<KnowledgeArchive> {
  const folder = await repo.findFolderById(folderId, false);
  if (!folder || folder.workspaceId !== ctx.workspaceId) {
    throw new FolderNotFoundError(folderId);
  }
  // Enforce base-level visibility (private / teams) before exporting.
  await getBaseById(ctx, folder.knowledgeBaseId);
  const { folders, entries } = await loadTree(folder.knowledgeBaseId);
  const data = buildZip(folder.name, folder.id, folders, entries, folder.description);
  return { filename: `${slugify(folder.name, "folder")}.zip`, data };
}

export async function buildEntryFile(
  ctx: KnowledgeContext,
  entryId: string
): Promise<KnowledgeFile> {
  const entry = await getEntry(ctx, entryId);
  // `getEntry` only checks the workspace; gate on base visibility too so
  // a private base's entry can't be pulled by id.
  await getBaseById(ctx, entry.knowledgeBaseId);
  return {
    filename: `${slugify(entry.title, "entry")}.md`,
    content: entryToMarkdown(entry),
  };
}

// ─── Internals ──────────────────────────────────────────────────────

async function loadTree(baseId: string): Promise<{
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
}> {
  const [folders, entries] = await Promise.all([
    repo.listFoldersForBase(baseId, false),
    repo.listEntriesForBase(baseId, { includeBody: true, includeDeleted: false }),
  ]);
  return { folders, entries };
}

/**
 * Walks the (already-loaded) flat folder/entry arrays starting at
 * `rootFolderId` (null = base root) and produces a zip whose paths
 * mirror the tree, rooted under a `<rootName>/` directory.
 */
function buildZip(
  rootName: string,
  rootFolderId: string | null,
  folders: KnowledgeFolder[],
  entries: KnowledgeEntry[],
  description: string | null
): Uint8Array {
  const foldersByParent = new Map<string | null, KnowledgeFolder[]>();
  for (const f of folders) {
    const arr = foldersByParent.get(f.parentId) ?? [];
    arr.push(f);
    foldersByParent.set(f.parentId, arr);
  }
  const entriesByFolder = new Map<string | null, KnowledgeEntry[]>();
  for (const e of entries) {
    const arr = entriesByFolder.get(e.folderId) ?? [];
    arr.push(e);
    entriesByFolder.set(e.folderId, arr);
  }
  for (const arr of foldersByParent.values()) {
    arr.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  }
  for (const arr of entriesByFolder.values()) {
    arr.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
  }

  const files: Zippable = {};
  const prefix = `${slugify(rootName, "knowledge-base")}/`;

  if (description?.trim()) {
    files[`${prefix}README.md`] = strToU8(`# ${rootName}\n\n${description.trim()}\n`);
  }

  function walk(parentId: string | null, dir: string): void {
    // One namespace per directory: dedup entry filenames and folder
    // names together so two items that slug to the same string don't
    // overwrite each other on extraction.
    const used: string[] = [];
    for (const e of entriesByFolder.get(parentId) ?? []) {
      const name = slugify(e.title, "untitled", used);
      used.push(name);
      files[`${dir}${name}.md`] = strToU8(entryToMarkdown(e));
    }
    for (const f of foldersByParent.get(parentId) ?? []) {
      const name = slugify(f.name, "folder", used);
      used.push(name);
      const childDir = `${dir}${name}/`;
      const before = Object.keys(files).length;
      walk(f.id, childDir);
      // Empty folder: emit a bare directory entry so the structure
      // stays faithful even with no files beneath it.
      if (Object.keys(files).length === before) files[childDir] = new Uint8Array(0);
    }
  }

  walk(rootFolderId, prefix);
  if (Object.keys(files).length === 0) files[prefix] = new Uint8Array(0);

  return zipSync(files, { level: 6 });
}
