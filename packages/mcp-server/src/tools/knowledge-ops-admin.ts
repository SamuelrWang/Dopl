/**
 * `dopl_kb_admin` DESTRUCTIVE op handlers: delete_base, delete_folder,
 * delete_file. Every op is a soft-delete (restorable from trash). The
 * agent-write-denied (403) mapping keeps read-only bases from throwing raw.
 * Routed from the registrar in knowledge.ts.
 */

import type { DoplClient } from "@dopl/client";
import { inlineOr } from "./narration";
import { ok, err, type ToolResponse } from "./respond";
import { agentWriteDenied, isErr, resolveBaseOr } from "./knowledge-shared";

/** Same rule as the write ops: a stored name or a path is a value. */
const NO_NAME = "`(unnamed)`";
const NO_PATH = "`(unreadable path)`";

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
    `Deleted ${inlineOr(base.name, NO_NAME)} (slug: \`${base.slug}\`). Restore with \`dopl_kb(op='restore_base')\`.`
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
      `Path ${inlineOr(path, NO_PATH)} resolved to a ${result.kind}, not a folder. ` +
        `Use \`dopl_kb_admin(op='delete_file')\` for entries.`
    );
  }
  return ok(`Folder deleted at ${inlineOr(path, NO_PATH)}.`);
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
      `Path ${inlineOr(path, NO_PATH)} resolved to a ${result.kind}, not an entry. ` +
        `Use \`dopl_kb_admin(op='delete_folder')\` for folders.`
    );
  }
  return ok(`Entry deleted at ${inlineOr(path, NO_PATH)}. Restore via \`dopl_kb(op='list_trash')\` + \`dopl_kb(op='restore_file')\`.`);
}
