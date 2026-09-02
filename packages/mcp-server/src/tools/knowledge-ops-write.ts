/**
 * `dopl_kb` non-destructive WRITE op handlers: create/update/set_visibility
 * on bases, create/move folders, write/move entries. Every write maps @dopl/client errors — conflict (412),
 * already-exists (409), agent-write-denied (403), and validation (400) —
 * to actionable tool messages. Routed from the registrar in knowledge.ts.
 */

import type { DoplClient } from "@dopl/client";
import { inlineOr } from "./narration";
import { ok, err, isConflict, isAlreadyExists, isNotFound, type ToolResponse } from "./respond";
import {
  agentWriteDenied,
  isErr,
  resolveBaseOr,
  updateBaseValidationError,
  writeFileValidationError,
} from "./knowledge-shared";
import { confirmGate } from "./confirm-token";
import { homeShelfForbidden, type ShelfArg } from "./shelf";

/**
 * ⚠ Write confirmations read back the STORED value, not the argument (a
 * canonicalised base name, a title derived from a path), spliced into our own
 * narration — and a path can carry a backtick, since `NAME_RE` bans control and
 * zero-width characters, NOT markdown. A name is a VALUE.
 */
const NO_NAME = "`(unnamed)`";
const NO_PATH = "`(unreadable path)`";

/**
 * A 403 `AGENT_WRITE_DISABLED` off `create_base` — ⚠ duck-typed on the CODE, the
 * shape `homeShelfForbidden` above established, so no new error class crosses
 * the package boundary. Returns the server's own sentence, which is the one
 * place this refusal is worded.
 */
function agentCreateForbidden(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  if ((e as { status?: number }).status !== 403) return null;
  if ((e as { code?: unknown }).code !== "AGENT_WRITE_DISABLED") return null;
  const msg = (e as { apiMessage?: unknown }).apiMessage;
  const detail =
    typeof msg === "string" && msg
      ? msg
      : "An agent cannot create a knowledge base here.";
  return `${detail} Nothing was created — no row, no slug taken, so retrying the same call will fail the same way.`;
}

/**
 * 🔒 CREATE, ON EITHER SHELF, WITH THE TWO GATES THE SPEC PUTS AROUND IT.
 *
 * 1. **THE SHELF CONTRADICTION IS REFUSED LOCALLY, BEFORE THE ROUND TRIP**
 *    (spec §7.2, the `channel-ops-write.ts` refuse-before-send idiom).
 *    `shelf: "personal"` sends `homeScoped: true` + `visibility: "private"`, so
 *    an explicit `visibility: "public"` beside it is two incompatible
 *    instructions — and the server's 403 ("the /home shelf holds private bases
 *    only") is correct but reads as a permission problem rather than as
 *    something the caller can fix by dropping one argument.
 *
 * 2. 🔒 **THE HOME-SHELF FENCE STAYS THE SERVER'S.**
 *    `src/features/knowledge/server/service-base-writes.ts › resolveHomeScope`
 *    wants a PERSON's credential, a PRIVATE row, and the caller's OWN default
 *    standard workspace, all three, and 403s otherwise. Nothing here relaxes it
 *    — `shelf.ts › homeShelfForbidden` only makes the refusal actionable.
 *
 * 3. ⚠ **THE CONFIRM GATE IS A TRIPWIRE** (see `confirm-token.ts`). It fires
 *    only for `visibility: "public"` inside a SHARED link container — a base
 *    published into the room a peer is standing in, which is the knowledge half
 *    of the audience-changing class. It does NOT fire in a standard workspace:
 *    `set_visibility` has published bases workspace-wide with no confirm since
 *    long before this wave, and gating one door and not the other would be
 *    theatre.
 */
export async function opCreateBase(
  client: DoplClient,
  callerUserId: string | null,
  input: {
    name: string;
    description?: string;
    shelf?: ShelfArg;
    visibility?: "public" | "private";
    confirm_token?: string;
  },
): Promise<ToolResponse> {
  const personal = input.shelf === "personal";
  if (personal && input.visibility !== undefined && input.visibility !== "private") {
    return err(
      `Refused before sending: shelf="personal" and visibility="${input.visibility}" contradict each other, so nothing was created. Your personal shelf holds PRIVATE bases only — a public base on it would be readable by every member on a surface no member navigates to. Either drop \`visibility\` (personal implies private) or drop \`shelf\`.`,
    );
  }
  const visibility = personal ? "private" : input.visibility;

  const verdict = await confirmGate(
    client,
    {
      tool: "dopl_kb",
      op: "create_base",
      callerUserId,
      what: `a knowledge base named ${inlineOr(input.name, NO_NAME)}, readable by the whole home channel`,
      audience: `everyone in that home channel — the peer standing in it can list it and read everything you put in it`,
      payload: {
        name: input.name,
        description: input.description ?? null,
        visibility: visibility ?? null,
        shelf: input.shelf ?? null,
      },
    },
    { publishes: visibility === "public", token: input.confirm_token },
  );
  if (verdict.kind === "halt") return verdict.response;

  let base;
  try {
    base = await client.createKbBase({
      name: input.name,
      description: input.description,
      visibility,
      // ⚠ Only ever `true` — an explicit `false` and an omission mean the same
      // thing to `resolveHomeScope` ("the default is false and silent").
      homeScoped: personal ? true : undefined,
    });
  } catch (e) {
    const home = homeShelfForbidden(e);
    if (home) return err(home);
    // ⚠ THE AUDIENCE CEILING'S CREATE REFUSAL, RENDERED AS A REFUSAL rather
    // than rethrown as a transport-shaped error (F-323's authoring half). The
    // server's message already names the room, the cause and the remedy —
    // `knowledge/server/service-base-writes.ts › assertCreatorCanReadItBack` —
    // and this is the one path where an agent MUST be able to act on it without
    // opening the repo, because the alternative it used to get was a SUCCESS
    // string over a row it could never see again.
    const ceiling = agentCreateForbidden(e);
    if (ceiling) return err(ceiling);
    throw e;
  }
  const visNote =
    base.visibility === "private"
      ? "Private to you — only you and your agent can see it."
      : "Visible to the whole workspace.";
  const shelfNote = personal
    ? " It is on your personal shelf, so the workspace Knowledge page will not list it."
    : "";
  return ok(
    `Created knowledge base ${inlineOr(base.name, NO_NAME)} (slug: \`${base.slug}\`). ${visNote}${shelfNote}`
  );
}

/**
 * ⚠ THE SHELF IS NOT PATCHABLE, AND THE REFUSAL SAYS SO RATHER THAN IGNORING
 * THE ARG — the twin of `agent-ops-write.ts › opUpdate`'s, word for word in
 * substance. `home_scoped` is set at create and never written again for bases
 * and templates alike (F-342; Samuel's ruling Q8, 2026-08-28 keeps it that way
 * for v1), and the server's update schema does not accept it — so a silently
 * dropped `shelf` here would return a 2xx over a move that never happened.
 *
 * ⚠ `shelf` RIDES `dopl_kb`'s SHARED OP SCHEMA, so it is spellable on every op;
 * this is the ONE other op where it would read as an instruction the server
 * carried out. The reads ignore it exactly as `dopl_agent(op="get")` does.
 */
export async function opUpdateBase(client: DoplClient, ref: string, name?: string, description?: string | null, slug?: string, shelf?: ShelfArg): Promise<ToolResponse> {
  if (shelf !== undefined) {
    return err(
      `op="update_base" does not take \`shelf\`, and nothing was changed. A base's shelf is fixed when it is created and there is no move: to put an existing base on your personal shelf, create a NEW one there with op="create_base", shelf="personal". ⚠ The copy and the original are STRANGERS — writing to one never touches the other.`,
    );
  }
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
    // Read-only-to-agents base — the clean message, not a raw
    // AGENT_WRITE_DISABLED dump.
    const denied = agentWriteDenied(e);
    if (denied) return denied;
    // ⚠ Name the field + rule, never a raw "VALIDATION_FAILED".
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
      `set_visibility only publishes (visibility="public") a base you created. Un-publishing is human-only — use the Dopl web UI.`,
    );
  }
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  let updated;
  try {
    updated = await client.updateKbBase(base.id, { visibility: "public" });
  } catch (e) {
    // Read-only-to-agents base — the clean message, not a raw dump.
    const denied = agentWriteDenied(e);
    if (denied) return denied;
    throw e;
  }
  return ok(
    `Published knowledge base ${inlineOr(updated.name, NO_NAME)} (slug: \`${updated.slug}\`) — now visible workspace-wide.`,
  );
}

/**
 * PINNED STARTUP CONTEXT (T81) — put a base (or one entry of it) into what every
 * agent session launched in this workspace is handed at startup, or take it out.
 *
 * ⚠ ONE HANDLER, TWO OPS, AND THE BOOLEAN IS THE ONLY DIFFERENCE. `pin` and
 * `unpin` are separate ops rather than one op with a flag for the reason the
 * REST routes are two verbs: a request that states the END STATE is safe to
 * retry after an ambiguous failure, where a toggle silently un-does a write that
 * landed. On workspace-wide state that un-do changes what every session started
 * afterwards begins with.
 *
 * ⚠ `path` IS WHAT PICKS THE TARGET, and the two are different objects: with a
 * path this pins ONE ENTRY, without it the WHOLE BASE. The result says which,
 * because an agent that believes it pinned a base when it pinned one document
 * will not pin the rest.
 *
 * ⚠ THE ENTRY LOOKUP IS A READ THROUGH THE ORDINARY PATH RESOLVER, so an
 * unreadable base or a path that names a FOLDER refuses before anything is
 * written — the server's own gates (`service-pins.ts › pinEntry` chases the
 * entry up to its base) are what actually refuse; this only makes the refusal
 * legible.
 */
export async function opPin(
  client: DoplClient,
  ref: string,
  path: string | undefined,
  pinned: boolean,
): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  const verb = pinned ? "Pinned" : "Unpinned";
  try {
    if (path === undefined || path === "") {
      await client.setKbBasePinned(base.id, pinned);
      return ok(
        `${verb} knowledge base ${inlineOr(base.name, NO_NAME)} (slug: \`${base.slug}\`). ${pinned ? "Every entry in it is now included in the startup context of agent sessions launched in this workspace." : "Its entries are no longer included in the startup context of new agent sessions."}`,
      );
    }
    const entry = await client.readKbFileByPath(base.id, path);
    await client.setKbEntryPinned(entry.id, pinned);
    return ok(
      `${verb} ${inlineOr(path, NO_PATH)} in ${inlineOr(base.name, NO_NAME)} (entry id: \`${entry.id}\`). ${pinned ? "This ONE entry is now included in the startup context of agent sessions launched in this workspace — the rest of the base is not." : "It is no longer included on its own; if its BASE is pinned it still arrives with the base."}`,
    );
  } catch (e) {
    // Read-only-to-agents base — clean message, not a raw dump.
    const denied = agentWriteDenied(e);
    if (denied) return denied;
    if (isNotFound(e)) {
      return err(
        `No entry at ${inlineOr(path, NO_PATH)} in ${inlineOr(base.name, NO_NAME)}, so nothing was ${pinned ? "pinned" : "unpinned"}. Paths must resolve to an ENTRY, not a folder — check dopl_kb(op="get_tree", base) for the exact path, or omit \`path\` to ${pinned ? "pin" : "unpin"} the whole base.`,
      );
    }
    throw e;
  }
}

export async function opCreateFolder(client: DoplClient, ref: string, path: string, description?: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  let folder;
  try {
    folder = await client.createKbFolderByPath(base.id, path, description);
  } catch (e) {
    // Read-only-to-agents base — clean message, not a raw dump.
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
    // Read-only-to-agents base — clean message, not a raw dump.
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
  try {
    const res = await client.writeKbFileByPath(
      base.id,
      path,
      { body, title, excerpt },
      force ? null : expected_version
    );
    entry = res.entry;
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
    // Read-only-to-agents base — clean message, not a raw dump.
    const denied = agentWriteDenied(e);
    if (denied) return denied;
    // ⚠ Name the failing field + rule, never a raw "VALIDATION_FAILED".
    const mapped = writeFileValidationError(e, title);
    if (mapped) return mapped;
    throw e;
  }
  // ⚠ The addressable path's leaf is the entry's TITLE, not the input path's
  // leaf segment — print it, and surface the canonical form when a passed
  // `title` slugs differently from the input leaf.
  const parentSegments = path.split("/").slice(0, -1).filter(Boolean);
  const canonicalPath = [...parentSegments, entry.title].join("/");
  const note =
    canonicalPath !== path
      ? ` Address future reads/moves with path ${inlineOr(canonicalPath, NO_PATH)}.`
      : "";
  return ok(
    `Wrote ${inlineOr(canonicalPath, NO_PATH)} (entry id: \`${entry.id}\`, ${entry.body.length} chars). New version: \`${entry.updatedAt}\`.${note}`
  );
}

export async function opMoveFile(client: DoplClient, ref: string, from_path: string, to_path: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  let result;
  try {
    result = await client.moveKbByPath(base.id, from_path, to_path);
  } catch (e) {
    // Read-only-to-agents base — clean message, not a raw dump.
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
