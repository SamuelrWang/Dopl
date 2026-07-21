/**
 * `dopl_kb_admin` DESTRUCTIVE op handlers: delete_base, delete_folder,
 * delete_file. Every op is a soft-delete (restorable from trash). The
 * agent-write-denied (403) mapping keeps read-only bases from throwing raw.
 * Routed from the registrar in knowledge.ts.
 */

import type { DoplClient } from "@dopl/client";
import { ok, err, type ToolResponse } from "./respond";
import { agentWriteDenied, isErr, resolveBaseOr } from "./knowledge-shared";

export async function opDeleteBase(client: DoplClient, ref: string): Promise<ToolResponse> {
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

export async function opDeleteFolder(client: DoplClient, ref: string, path: string): Promise<ToolResponse> {
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

export async function opDeleteFile(client: DoplClient, ref: string, path: string): Promise<ToolResponse> {
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
