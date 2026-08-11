/**
 * `dopl_kb` non-destructive WRITE op handlers: create/update/set_visibility
 * on bases, create/move folders, write/move entries. Every write maps @dopl/client errors — conflict (412),
 * already-exists (409), agent-write-denied (403), and validation (400) —
 * to actionable tool messages. Routed from the registrar in knowledge.ts.
 */

import type { DoplClient } from "@dopl/client";
import { inlineOr } from "./narration";
import { ok, err, isConflict, isAlreadyExists, type ToolResponse } from "./respond";
import {
  agentWriteDenied,
  isErr,
  resolveBaseOr,
  updateBaseValidationError,
  writeFileValidationError,
} from "./knowledge-shared";

/**
 * Write confirmations read back the STORED value, not the argument: a base
 * name the server canonicalised, an entry title derived from a path. Every one
 * of them is spliced into a line of our own narration, and a path can carry a
 * backtick (`NAME_RE` bans control and zero-width characters, not markdown),
 * which escapes the very code span we wrap it in. Same rule as everywhere else:
 * a name is a value.
 */
const NO_NAME = "`(unnamed)`";
const NO_PATH = "`(unreadable path)`";

export async function opCreateBase(client: DoplClient, name: string, description?: string): Promise<ToolResponse> {
  const base = await client.createKbBase({ name, description });
  const visNote =
    base.visibility === "private"
      ? "Private to you — only you and your agent can see it."
      : "Visible to the whole workspace.";
  return ok(
    `Created knowledge base ${inlineOr(base.name, NO_NAME)} (slug: \`${base.slug}\`). ${visNote}`
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
    `Updated ${inlineOr(updated.name, NO_NAME)} (slug: \`${updated.slug}\`).`
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
    `Published knowledge base ${inlineOr(updated.name, NO_NAME)} (slug: \`${updated.slug}\`) — now visible workspace-wide.`,
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
  return ok(`Folder ready at ${inlineOr(path, NO_PATH)} (id: \`${folder.id}\`).${descNote}`);
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
      `Path ${inlineOr(from_path, NO_PATH)} resolved to a ${result.kind}, not a folder.`
    );
  }
  return ok(`Folder moved: ${inlineOr(from_path, NO_PATH)} → ${inlineOr(to_path, NO_PATH)}.`);
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
        `${inlineOr(path, NO_PATH)} changed since you last read it. Call dopl_kb(op="read_file", base, path) to get the current content + version, reconcile your changes, then retry write_file with that expected_version (or pass force=true to overwrite).`
      );
    }
    if (isAlreadyExists(e)) {
      return err(
        `An entry titled ${inlineOr(title ?? path.split("/").filter(Boolean).pop(), NO_NAME)} already exists in that folder. Pick a different title/path, or read+overwrite the existing entry with dopl_kb(op="read_file" → "write_file").`
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
      ? ` Address future reads/moves with path ${inlineOr(canonicalPath, NO_PATH)}.`
      : "";
  return ok(
    `Wrote ${inlineOr(canonicalPath, NO_PATH)} (entry id: \`${entry.id}\`, ${entry.body.length} chars). New version: \`${entry.updatedAt}\`.${note}\nView in Dopl: ${webUrl}`
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
      `Path ${inlineOr(from_path, NO_PATH)} resolved to a ${result.kind}, not an entry.`
    );
  }
  return ok(`Entry moved: ${inlineOr(from_path, NO_PATH)} → ${inlineOr(to_path, NO_PATH)}.`);
}
