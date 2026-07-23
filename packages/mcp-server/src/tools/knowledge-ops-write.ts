/**
 * `dopl_kb` non-destructive WRITE op handlers: create/update/set_visibility
 * on bases, create/move folders, write/move entries, and the restore
 * (recovery) ops. Every write maps @dopl/client errors — conflict (412),
 * already-exists (409), agent-write-denied (403), and validation (400) —
 * to actionable tool messages. Routed from the registrar in knowledge.ts.
 */

import type { DoplClient } from "@dopl/client";
import { ok, err, isConflict, isAlreadyExists, type ToolResponse } from "./respond";
import {
  agentWriteDenied,
  isErr,
  resolveBaseOr,
  updateBaseValidationError,
  writeFileValidationError,
} from "./knowledge-shared";

export async function opCreateBase(client: DoplClient, name: string, description?: string): Promise<ToolResponse> {
  const base = await client.createKbBase({ name, description });
  const visNote =
    base.visibility === "private"
      ? "Private to you — only you and your agent can see it."
      : "Visible to the whole workspace.";
  return ok(
    `Created knowledge base **${base.name}** (slug: \`${base.slug}\`). ${visNote}`
  );
}

export async function opUpdateBase(client: DoplClient, ref: string, name?: string, description?: string | null, slug?: string): Promise<ToolResponse> {
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

export async function opSetVisibility(client: DoplClient, ref: string, visibility: string): Promise<ToolResponse> {
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

export async function opRestoreBase(client: DoplClient, ref: string): Promise<ToolResponse> {
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

export async function opCreateFolder(client: DoplClient, ref: string, path: string, description?: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  let folder;
  try {
    folder = await client.createKbFolderByPath(base.id, path, description);
  } catch (e) {
    // F-10b: read-only-to-agents base — clean message, not a raw
    // AGENT_WRITE_DISABLED dump.
    const denied = agentWriteDenied(e);
    if (denied) return denied;
    throw e;
  }
  const descNote = description !== undefined ? " Description set." : "";
  return ok(`Folder ready at \`${path}\` (id: \`${folder.id}\`).${descNote}`);
}

export async function opMoveFolder(client: DoplClient, ref: string, from_path: string, to_path: string): Promise<ToolResponse> {
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

export async function opWriteFile(client: DoplClient, ref: string, path: string, body: string, title?: string, expected_version?: string, force?: boolean, excerpt?: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  let entry;
  let webUrl: string;
  try {
    const res = await client.writeKbFileByPath(
      base.id,
      path,
      { body, title, excerpt },
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

export async function opMoveFile(client: DoplClient, ref: string, from_path: string, to_path: string): Promise<ToolResponse> {
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

export async function opRestoreFolder(client: DoplClient, folder_id: string): Promise<ToolResponse> {
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

export async function opRestoreFile(client: DoplClient, entry_id: string): Promise<ToolResponse> {
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
