"use client";

/**
 * Live-data half of the playground KNOWLEDGE pane. Chains three GET polls
 * through the guest bearer (session.tsx › usePlaygroundPoll):
 *
 *   1. /api/knowledge/bases                → pick the first visible base
 *   2. /api/knowledge/bases/[baseId]/tree  → folders + entries (bodies stripped)
 *   3. /api/knowledge/entries/[entryId]    → the selected entry WITH body
 *
 * and folds them into the same view model the pane's static demo corpus uses,
 * so the JSX renders either source unchanged. `active` stays false until the
 * first tree snapshot lands — the pane keeps its demo content until then.
 */

import { useMemo } from "react";
import type {
  KnowledgeBase,
  KnowledgeEntry,
  KnowledgeFolder,
} from "@/features/knowledge/types";
import { usePlaygroundPoll, usePlaygroundSession } from "../../session";

// ─── View model (demo corpus conforms to the same shapes) ───────────

export interface KnowledgeViewFile {
  id: string;
  title: string;
}

export interface KnowledgeViewFolder {
  id: string;
  name: string;
  files: KnowledgeViewFile[];
  children: KnowledgeViewFolder[];
}

export interface KnowledgeViewDoc {
  folderName: string | null;
  title: string;
  excerpt: string | null;
  updatedAt: string | null;
  /** Blank-line-split body paragraphs; null while the body is in flight. */
  paragraphs: string[] | null;
}

export interface LiveKnowledge {
  /** True once a tree snapshot exists; false = render the static demo. */
  active: boolean;
  baseName: string;
  folders: KnowledgeViewFolder[];
  rootFiles: KnowledgeViewFile[];
  /** Resolved selection (falls back to the first file); null = empty base. */
  selectedFileId: string | null;
  doc: KnowledgeViewDoc | null;
}

const INACTIVE: LiveKnowledge = {
  active: false,
  baseName: "",
  folders: [],
  rootFiles: [],
  selectedFileId: null,
  doc: null,
};

// ─── Tree folding ───────────────────────────────────────────────────

interface FileMeta {
  title: string;
  folderName: string | null;
  excerpt: string | null;
  updatedAt: string | null;
}

interface TreeModel {
  folders: KnowledgeViewFolder[];
  rootFiles: KnowledgeViewFile[];
  /** Display order (folder files depth-first, then root files). */
  fileOrder: string[];
  meta: Record<string, FileMeta>;
}

const byPosition = (
  a: { position: number; createdAt: string },
  b: { position: number; createdAt: string }
) => a.position - b.position || a.createdAt.localeCompare(b.createdAt);

/** Flat snapshot → nested rail model. Orphaned parent/folder ids (visibility-
 *  filtered rows) degrade to root rather than vanishing. */
function buildModel(
  folders: KnowledgeFolder[],
  entries: KnowledgeEntry[]
): TreeModel {
  const folderIds = new Set(folders.map((f) => f.id));
  const childFolders = new Map<string | null, KnowledgeFolder[]>();
  for (const folder of [...folders].sort(byPosition)) {
    const parent =
      folder.parentId && folderIds.has(folder.parentId) ? folder.parentId : null;
    const list = childFolders.get(parent);
    if (list) list.push(folder);
    else childFolders.set(parent, [folder]);
  }
  const filesByFolder = new Map<string | null, KnowledgeEntry[]>();
  for (const entry of [...entries].sort(byPosition)) {
    const fid =
      entry.folderId && folderIds.has(entry.folderId) ? entry.folderId : null;
    const list = filesByFolder.get(fid);
    if (list) list.push(entry);
    else filesByFolder.set(fid, [entry]);
  }

  const fileOrder: string[] = [];
  const meta: Record<string, FileMeta> = {};
  const toFile = (entry: KnowledgeEntry, folderName: string | null) => {
    fileOrder.push(entry.id);
    meta[entry.id] = {
      title: entry.title,
      folderName,
      excerpt: entry.excerpt,
      updatedAt: entry.updatedAt,
    };
    return { id: entry.id, title: entry.title };
  };
  const buildFolders = (parent: string | null): KnowledgeViewFolder[] =>
    (childFolders.get(parent) ?? []).map((folder) => ({
      id: folder.id,
      name: folder.name,
      files: (filesByFolder.get(folder.id) ?? []).map((e) =>
        toFile(e, folder.name)
      ),
      children: buildFolders(folder.id),
    }));

  const viewFolders = buildFolders(null);
  const rootFiles = (filesByFolder.get(null) ?? []).map((e) => toFile(e, null));
  return { folders: viewFolders, rootFiles, fileOrder, meta };
}

/** Member/agent-authored markdown-ish body → plain-text paragraphs. */
export function splitBody(body: string): string[] {
  return body
    .split(/\r?\n[ \t]*\r?\n+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

// ─── The hook ───────────────────────────────────────────────────────

/**
 * `selectedId` is the pane's raw click state; it may be a demo id or a
 * deleted entry — anything not in the live tree falls back to the first file.
 */
export function useLiveKnowledge(selectedId: string | null): LiveKnowledge {
  const { session } = usePlaygroundSession();

  const bases = usePlaygroundPoll<{ bases: KnowledgeBase[] }>(
    session ? "/api/knowledge/bases" : null
  );
  const baseId = bases.data?.bases[0]?.id ?? null;

  const tree = usePlaygroundPoll<{
    base: KnowledgeBase;
    folders: KnowledgeFolder[];
    entries: KnowledgeEntry[];
  }>(baseId ? `/api/knowledge/bases/${baseId}/tree` : null);

  const model = useMemo(
    () => (tree.data ? buildModel(tree.data.folders, tree.data.entries) : null),
    [tree.data]
  );

  const effectiveId = model
    ? selectedId && model.meta[selectedId]
      ? selectedId
      : (model.fileOrder[0] ?? null)
    : null;

  const entry = usePlaygroundPoll<{ entry: KnowledgeEntry }>(
    effectiveId ? `/api/knowledge/entries/${effectiveId}` : null
  );

  if (!tree.data || !model) return INACTIVE;

  const meta = effectiveId ? model.meta[effectiveId] : null;
  // ⚠ The poll holds the LAST payload across a path change — only trust the
  // body once it is the selected entry's, else render the loading ghost.
  const loaded =
    entry.data && effectiveId && entry.data.entry.id === effectiveId
      ? entry.data.entry
      : null;

  return {
    active: true,
    baseName: tree.data.base.name,
    folders: model.folders,
    rootFiles: model.rootFiles,
    selectedFileId: effectiveId,
    doc:
      effectiveId && meta
        ? {
            folderName: meta.folderName,
            title: loaded?.title ?? meta.title,
            excerpt: loaded?.excerpt ?? meta.excerpt,
            updatedAt: loaded?.updatedAt ?? meta.updatedAt,
            paragraphs: loaded ? splitBody(loaded.body) : null,
          }
        : null,
  };
}
