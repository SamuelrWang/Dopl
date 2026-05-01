/**
 * Knowledge-base methods for `DoplClient` (Item 4). Each function takes
 * the shared `DoplTransport` as its first arg and hits the matching
 * Next.js API route. The `DoplClient` class wraps these into instance
 * methods for caller ergonomics.
 *
 * Path-based methods (`writeFileByPath`, `readFileByPath`,
 * `createFolderByPath`, `listDirByPath`, `moveByPath`, `deleteByPath`)
 * use the path-based REST endpoints added in Phase 4.C.
 */

import type { DoplTransport } from "./transport.js";
import type {
  KnowledgeBase,
  KnowledgeBaseCreateInput,
  KnowledgeBaseUpdateInput,
  KnowledgeDirListing,
  KnowledgeEntry,
  KnowledgePathOpResult,
  KnowledgeSearchHit,
  KnowledgeTrashSnapshot,
  KnowledgeTreeSnapshot,
  KnowledgeWriteFileInput,
} from "./knowledge-types.js";

const enc = encodeURIComponent;

// ─── Bases ──────────────────────────────────────────────────────────

export async function listKbBases(t: DoplTransport): Promise<KnowledgeBase[]> {
  const data = await t.request<{ bases: KnowledgeBase[] }>(
    "/api/knowledge/bases",
    { toolName: "kb_list_bases" }
  );
  return data.bases;
}

export async function getKbBase(
  t: DoplTransport,
  baseId: string
): Promise<KnowledgeBase> {
  const data = await t.request<{ base: KnowledgeBase }>(
    `/api/knowledge/bases/${enc(baseId)}`,
    { toolName: "kb_get_base" }
  );
  return data.base;
}

export async function getKbTree(
  t: DoplTransport,
  baseId: string
): Promise<KnowledgeTreeSnapshot> {
  return t.request<KnowledgeTreeSnapshot>(
    `/api/knowledge/bases/${enc(baseId)}/tree`,
    { toolName: "kb_get_tree" }
  );
}

export async function createKbBase(
  t: DoplTransport,
  input: KnowledgeBaseCreateInput
): Promise<KnowledgeBase> {
  const data = await t.request<{ base: KnowledgeBase }>(
    "/api/knowledge/bases",
    { method: "POST", body: input, toolName: "kb_create_base" }
  );
  return data.base;
}

export async function updateKbBase(
  t: DoplTransport,
  baseId: string,
  patch: KnowledgeBaseUpdateInput
): Promise<KnowledgeBase> {
  const data = await t.request<{ base: KnowledgeBase }>(
    `/api/knowledge/bases/${enc(baseId)}`,
    { method: "PATCH", body: patch, toolName: "kb_update_base" }
  );
  return data.base;
}

export async function deleteKbBase(
  t: DoplTransport,
  baseId: string
): Promise<void> {
  await t.requestNoContent(
    `/api/knowledge/bases/${enc(baseId)}`,
    "DELETE",
    "kb_delete_base"
  );
}

export async function restoreKbBase(
  t: DoplTransport,
  baseId: string
): Promise<KnowledgeBase> {
  const data = await t.request<{ base: KnowledgeBase }>(
    `/api/knowledge/bases/${enc(baseId)}/restore`,
    { method: "POST", toolName: "kb_restore_base" }
  );
  return data.base;
}

// ─── Path-based file/folder ops ─────────────────────────────────────

export async function readKbFileByPath(
  t: DoplTransport,
  baseId: string,
  path: string
): Promise<KnowledgeEntry> {
  const data = await t.request<{ entry: KnowledgeEntry }>(
    `/api/knowledge/bases/${enc(baseId)}/files?path=${enc(path)}`,
    { toolName: "kb_read_file" }
  );
  return data.entry;
}

export async function writeKbFileByPath(
  t: DoplTransport,
  baseId: string,
  path: string,
  input: KnowledgeWriteFileInput = {}
): Promise<KnowledgeEntry> {
  const data = await t.request<{ entry: KnowledgeEntry }>(
    `/api/knowledge/bases/${enc(baseId)}/files`,
    {
      method: "PUT",
      body: { path, ...input },
      toolName: "kb_write_file",
    }
  );
  return data.entry;
}

export async function listKbDirByPath(
  t: DoplTransport,
  baseId: string,
  path: string = ""
): Promise<KnowledgeDirListing> {
  const qs = path ? `?path=${enc(path)}` : "";
  return t.request<KnowledgeDirListing>(
    `/api/knowledge/bases/${enc(baseId)}/folders-by-path${qs}`,
    { toolName: "kb_list_dir" }
  );
}

export async function createKbFolderByPath(
  t: DoplTransport,
  baseId: string,
  path: string
): Promise<import("./knowledge-types.js").KnowledgeFolder> {
  const data = await t.request<{
    folder: import("./knowledge-types.js").KnowledgeFolder;
  }>(`/api/knowledge/bases/${enc(baseId)}/folders-by-path`, {
    method: "POST",
    body: { path },
    toolName: "kb_create_folder",
  });
  return data.folder;
}

export async function deleteKbByPath(
  t: DoplTransport,
  baseId: string,
  path: string
): Promise<KnowledgePathOpResult> {
  return t.request<KnowledgePathOpResult>(
    `/api/knowledge/bases/${enc(baseId)}/folders-by-path?path=${enc(path)}`,
    { method: "DELETE", toolName: "kb_delete_by_path" }
  );
}

export async function moveKbByPath(
  t: DoplTransport,
  baseId: string,
  fromPath: string,
  toPath: string
): Promise<KnowledgePathOpResult> {
  return t.request<KnowledgePathOpResult>(
    `/api/knowledge/bases/${enc(baseId)}/move-by-path`,
    {
      method: "POST",
      body: { fromPath, toPath },
      toolName: "kb_move_by_path",
    }
  );
}

// ─── Trash ──────────────────────────────────────────────────────────

export async function listKbTrash(
  t: DoplTransport,
  baseId?: string
): Promise<KnowledgeTrashSnapshot> {
  const qs = baseId ? `?baseId=${enc(baseId)}` : "";
  return t.request<KnowledgeTrashSnapshot>(
    `/api/knowledge/trash${qs}`,
    { toolName: "kb_list_trash" }
  );
}

export async function restoreKbFolder(
  t: DoplTransport,
  folderId: string
): Promise<import("./knowledge-types.js").KnowledgeFolder> {
  const data = await t.request<{
    folder: import("./knowledge-types.js").KnowledgeFolder;
  }>(`/api/knowledge/folders/${enc(folderId)}/restore`, {
    method: "POST",
    toolName: "kb_restore_folder",
  });
  return data.folder;
}

export async function restoreKbEntry(
  t: DoplTransport,
  entryId: string
): Promise<KnowledgeEntry> {
  const data = await t.request<{ entry: KnowledgeEntry }>(
    `/api/knowledge/entries/${enc(entryId)}/restore`,
    { method: "POST", toolName: "kb_restore_file" }
  );
  return data.entry;
}

// ─── Search (Item 5.D) ──────────────────────────────────────────────

export async function searchKb(
  t: DoplTransport,
  query: string,
  opts: { baseSlug?: string; limit?: number } = {}
): Promise<KnowledgeSearchHit[]> {
  const qs = new URLSearchParams({ q: query });
  if (opts.baseSlug) qs.set("base", opts.baseSlug);
  if (opts.limit !== undefined) qs.set("limit", String(opts.limit));
  const data = await t.request<{ hits: KnowledgeSearchHit[] }>(
    `/api/knowledge/search?${qs.toString()}`,
    { toolName: "kb_search" }
  );
  return data.hits;
}
