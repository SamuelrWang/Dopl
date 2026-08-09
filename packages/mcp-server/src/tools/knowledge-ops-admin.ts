/**
 * `dopl_kb_admin` DESTRUCTIVE op handlers: delete_base, delete_folder,
 * delete_file. Deletion is permanent — there is no trash to restore from. The
 * agent-write-denied (403) mapping keeps read-only bases from throwing raw.
 * Routed from the registrar in knowledge.ts.
 *
 * UNREACHABLE since §2b: `server.ts` refuses every op on this tool before
 * dispatch (`delete-policy.ts`). Kept so the capability returns by removing the
 * gate rather than by rewriting handlers — which is also why their narration
 * has to stay honest about what a delete would actually do.
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
    `Deleted ${inlineOr(base.name, NO_NAME)} (slug: \`${base.slug}\`) and everything in it. Permanent — there is nothing to restore it from.`
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
  return ok(`Entry deleted at ${inlineOr(path, NO_PATH)}. Permanent — there is nothing to restore it from.`);
}
