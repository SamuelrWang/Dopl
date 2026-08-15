/**
 * Knowledge-base methods for `DoplClient`. Free functions over
 * `DoplTransport`; the class-side method group is `client-knowledge.ts`.
 */

import type { DoplTransport } from "./transport.js";
import { DoplApiError } from "./errors.js";
import type {
  KnowledgeBase,
  KnowledgeBaseCreateInput,
  KnowledgeBaseUpdateInput,
  KnowledgeDirListing,
  KnowledgeEntry,
  KnowledgePathOpResult,
  KnowledgeSearchHit,
  KnowledgeTreeSnapshot,
  KnowledgeWriteFileInput,
  KnowledgeWriteFileResult,
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
  baseId: string,
  opts?: { entryLimit?: number; entryCursor?: string }
): Promise<KnowledgeTreeSnapshot> {
  const params = new URLSearchParams();
  if (opts?.entryLimit !== undefined) params.set("entryLimit", String(opts.entryLimit));
  if (opts?.entryCursor !== undefined) params.set("entryCursor", opts.entryCursor);
  const qs = params.toString();
  return t.request<KnowledgeTreeSnapshot>(
    `/api/knowledge/bases/${enc(baseId)}/tree${qs ? `?${qs}` : ""}`,
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
  input: KnowledgeWriteFileInput = {},
  expectedVersion?: string | null
): Promise<KnowledgeWriteFileResult> {
  // Optimistic concurrency, tri-state on `expectedVersion`:
  //   - string    → atomic compare-and-swap (412 on mismatch).
  //   - undefined → strict: existing entry refuses 412 — caller must read_file
  //                 first and pass the Version it saw. ⚠ Do NOT re-add the old
  //                 read-at-write auto-guard: it only proved nothing changed in
  //                 the microseconds before the PUT, and silently clobbered
  //                 writes landing after the caller's real read. 404 → create,
  //                 no precondition.
  //   - null      → force: blind overwrite, no precondition.
  let version: string | undefined;
  if (expectedVersion === null) {
    version = undefined;
  } else if (expectedVersion === undefined) {
    let exists = false;
    try {
      await readKbFileByPath(t, baseId, path);
      exists = true;
    } catch (e) {
      if (!(e instanceof DoplApiError) || e.status !== 404) throw e;
    }
    if (exists) {
      throw new DoplApiError(
        412,
        JSON.stringify({
          error: {
            code: "EXPECTED_VERSION_REQUIRED",
            message:
              "This entry already exists. read_file it first and pass its Version as expected_version (or force to overwrite).",
          },
        })
      );
    }
  } else {
    version = expectedVersion;
  }
  const data = await t.request<KnowledgeWriteFileResult>(
    `/api/knowledge/bases/${enc(baseId)}/files`,
    {
      method: "PUT",
      body: { path, ...input },
      toolName: "kb_write_file",
      customHeaders: version ? { "X-Updated-At": version } : undefined,
    }
  );
  return data;
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
  path: string,
  description?: string | null
): Promise<import("./knowledge-types.js").KnowledgeFolder> {
  const data = await t.request<{
    folder: import("./knowledge-types.js").KnowledgeFolder;
  }>(`/api/knowledge/bases/${enc(baseId)}/folders-by-path`, {
    method: "POST",
    // ⚠ Omit `description` entirely when not provided so a plain mkdir -p
    // never clears an existing folder's summary (route: `undefined` =
    // leave as-is, `null` = clear).
    body: description === undefined ? { path } : { path, description },
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

// ─── Search ─────────────────────────────────────────────────────────

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
