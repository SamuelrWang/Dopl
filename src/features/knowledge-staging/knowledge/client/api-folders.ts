"use client";

/** STAGING: the folder half of the staging `./api.ts` (re-exported from there). */
import type { KnowledgeFolder } from "@/features/knowledge/types";
import type {
  KnowledgeFolderCreateInput,
  KnowledgeFolderMoveInput,
  KnowledgeFolderUpdateInput,
} from "@/features/knowledge/schema";
import { knowledgeDb, latency, newId, nowIso } from "@/features/knowledge-staging/fake-store";
import { STAGING_USER_ID } from "@/features/knowledge-staging/data";
import { KnowledgeApiError } from "./api";

function notFound(what: string): KnowledgeApiError {
  return new KnowledgeApiError(404, "NOT_FOUND", `${what} not found`);
}

// ─── Folders ────────────────────────────────────────────────────────

export type FolderCreateBody = Omit<KnowledgeFolderCreateInput, "knowledgeBaseId">;

export async function createFolder(
  baseId: string,
  body: FolderCreateBody,
  workspaceId?: string
): Promise<KnowledgeFolder> {
  await latency();
  const db = knowledgeDb();
  const base = db.bases.find((b) => b.id === baseId);
  if (!base) throw notFound("Knowledge base");
  const at = nowIso();
  const siblings = db.folders.filter(
    (f) => f.knowledgeBaseId === baseId && f.parentId === (body.parentId ?? null)
  );
  const folder: KnowledgeFolder = {
    id: newId("f"),
    workspaceId: workspaceId ?? base.workspaceId,
    knowledgeBaseId: baseId,
    parentId: body.parentId ?? null,
    name: body.name,
    description: body.description ?? null,
    position: body.position ?? siblings.length,
    createdBy: STAGING_USER_ID,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
  db.folders.push(folder);
  return { ...folder };
}

export async function updateFolder(
  folderId: string,
  patch: KnowledgeFolderUpdateInput,
  workspaceId?: string,
  expectedUpdatedAt?: string
): Promise<KnowledgeFolder> {
  void workspaceId;
  void expectedUpdatedAt;
  await latency();
  const folder = knowledgeDb().folders.find((f) => f.id === folderId);
  if (!folder) throw notFound("Folder");
  if (patch.name !== undefined) folder.name = patch.name;
  if (patch.description !== undefined) folder.description = patch.description;
  if (patch.position !== undefined) folder.position = patch.position;
  folder.updatedAt = nowIso();
  return { ...folder };
}

export async function deleteFolder(
  folderId: string,
  workspaceId?: string
): Promise<void> {
  void workspaceId;
  await latency();
  const db = knowledgeDb();
  // The folder and its whole subtree, entries included.
  const doomed = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of db.folders) {
      if (f.parentId && doomed.has(f.parentId) && !doomed.has(f.id)) {
        doomed.add(f.id);
        grew = true;
      }
    }
  }
  db.folders = db.folders.filter((f) => !doomed.has(f.id));
  db.entries = db.entries.filter((e) => !e.folderId || !doomed.has(e.folderId));
}

export async function moveFolder(
  folderId: string,
  input: KnowledgeFolderMoveInput,
  workspaceId?: string
): Promise<KnowledgeFolder> {
  void workspaceId;
  await latency();
  const folder = knowledgeDb().folders.find((f) => f.id === folderId);
  if (!folder) throw notFound("Folder");
  folder.parentId = input.parentId;
  if (input.position !== undefined) folder.position = input.position;
  folder.updatedAt = nowIso();
  return { ...folder };
}

