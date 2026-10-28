/** The staged folder and entry routes. Entry writes append a changelog row, as the server does. */
import type {
  KnowledgeEntryCreateInput,
  KnowledgeEntryMoveInput,
  KnowledgeEntryUpdateInput,
  KnowledgeFolderCreateInput,
  KnowledgeFolderMoveInput,
  KnowledgeFolderUpdateInput,
} from "@/features/knowledge/schema";
import type { KnowledgeEntry, KnowledgeFolder } from "@/features/knowledge/types";
import { STAGING_USER_ID } from "../data";
import { knowledgeDb, newId, nowIso, recordRevision } from "../fake-store";
import { notFound } from "./http";

function baseOf(baseId: string) {
  const base = knowledgeDb().bases.find((b) => b.id === baseId);
  if (!base) throw notFound("Knowledge base");
  return base;
}

function folderOf(folderId: string): KnowledgeFolder {
  const folder = knowledgeDb().folders.find((f) => f.id === folderId);
  if (!folder) throw notFound("Folder");
  return folder;
}

function entryOf(entryId: string): KnowledgeEntry {
  const entry = knowledgeDb().entries.find((e) => e.id === entryId);
  if (!entry) throw notFound("Entry");
  return entry;
}

export function createFolder(
  baseId: string,
  body: Omit<KnowledgeFolderCreateInput, "knowledgeBaseId">,
  workspaceId: string | undefined
): { folder: KnowledgeFolder } {
  const db = knowledgeDb();
  const base = baseOf(baseId);
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
  return { folder: { ...folder } };
}

export function updateFolder(folderId: string, patch: KnowledgeFolderUpdateInput): { folder: KnowledgeFolder } {
  const folder = folderOf(folderId);
  if (patch.name !== undefined) folder.name = patch.name;
  if (patch.description !== undefined) folder.description = patch.description;
  if (patch.position !== undefined) folder.position = patch.position;
  folder.updatedAt = nowIso();
  return { folder: { ...folder } };
}

/** The folder and its whole subtree, entries included. */
export function deleteFolder(folderId: string): void {
  const db = knowledgeDb();
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

export function moveFolder(folderId: string, input: KnowledgeFolderMoveInput): { folder: KnowledgeFolder } {
  const folder = folderOf(folderId);
  folder.parentId = input.parentId;
  if (input.position !== undefined) folder.position = input.position;
  folder.updatedAt = nowIso();
  return { folder: { ...folder } };
}

export function getEntry(entryId: string): { entry: KnowledgeEntry } {
  return { entry: { ...entryOf(entryId) } };
}

export function createEntry(
  baseId: string,
  body: Omit<KnowledgeEntryCreateInput, "knowledgeBaseId">,
  workspaceId: string | undefined
): { entry: KnowledgeEntry } {
  const db = knowledgeDb();
  const base = baseOf(baseId);
  const at = nowIso();
  const siblings = db.entries.filter(
    (e) => e.knowledgeBaseId === baseId && e.folderId === (body.folderId ?? null)
  );
  const entry: KnowledgeEntry = {
    id: newId("e"),
    workspaceId: workspaceId ?? base.workspaceId,
    knowledgeBaseId: baseId,
    folderId: body.folderId ?? null,
    title: body.title,
    excerpt: body.excerpt ?? null,
    body: body.body ?? "",
    entryType: body.entryType ?? "doc",
    position: body.position ?? siblings.length,
    createdBy: STAGING_USER_ID,
    lastEditedBy: STAGING_USER_ID,
    lastEditedSource: "user",
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
  db.entries.push(entry);
  recordRevision(entry, "create");
  return { entry: { ...entry } };
}

export function updateEntry(entryId: string, patch: KnowledgeEntryUpdateInput): { entry: KnowledgeEntry } {
  const entry = entryOf(entryId);
  const renamed = patch.title !== undefined && patch.title !== entry.title;
  const edited = patch.body !== undefined && patch.body !== entry.body;
  if (patch.title !== undefined) entry.title = patch.title;
  if (patch.excerpt !== undefined) entry.excerpt = patch.excerpt;
  if (patch.body !== undefined) entry.body = patch.body;
  if (patch.entryType !== undefined) entry.entryType = patch.entryType;
  if (patch.position !== undefined) entry.position = patch.position;
  entry.updatedAt = nowIso();
  entry.lastEditedBy = STAGING_USER_ID;
  entry.lastEditedSource = "user";
  if (edited) recordRevision(entry, "edit");
  else if (renamed) recordRevision(entry, "rename");
  return { entry: { ...entry } };
}

export function deleteEntry(entryId: string): void {
  const db = knowledgeDb();
  db.entries = db.entries.filter((e) => e.id !== entryId);
}

export function moveEntry(entryId: string, input: KnowledgeEntryMoveInput): { entry: KnowledgeEntry } {
  const entry = entryOf(entryId);
  entry.folderId = input.folderId;
  if (input.position !== undefined) entry.position = input.position;
  entry.updatedAt = nowIso();
  recordRevision(entry, "move");
  return { entry: { ...entry } };
}
