/**
 * `dopl_kb` non-destructive WRITE op handlers: create/update/set_visibility/grant
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
import {
  confirmGate,
  containerPublishUnacknowledged,
  RECONFIRM_REMEDY,
} from "./confirm-token";
import type { WorkspaceDirectory } from "../workspace-directory";
import {
  grantedLine,
  isGrantRefusal,
  levelForScope,
  notOwnedRefusal,
  resolveGrantScopeId,
  type GrantLevelArg,
  type GrantScopeArg,
} from "./grant";

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
 * shape every mapper in this file follows, so no new error class crosses the
 * package boundary. Returns the server's own sentence, which is the one
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
 * 🔒 CREATE, WITH THE ONE GATE THE SPEC PUTS AROUND IT.
 *
 * ⚠ **THE TWO SHELF RULES THIS DOCBLOCK OPENED WITH ARE GONE (2026-09-02, slice
 * B15, ruling B10)** — the local shelf/visibility contradiction and the server's
 * `resolveHomeScope`. The `home_scoped` column is dropped and a personal base is
 * an ordinary row in the caller's own `kind='personal'` container, so there is
 * no second shelf for a `public` base to contradict.
 *
 * ⚠ **THE CONFIRM GATE IS A TRIPWIRE** (see `confirm-token.ts`). It fires
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
    visibility?: "public" | "private";
    confirm_token?: string;
  },
): Promise<ToolResponse> {
  // 🔒 **ALWAYS SENT, NEVER LEFT TO THE SERVER'S DEFAULT** (2026-09-02) — the same
  // rule and the same reason as `agent-ops-write.ts › opCreate`, which states it
  // in full: the server's default is credential-dependent, this process cannot
  // see which credential it holds, and an omitted value let a SHARED credential
  // resolve to `public`, trip G16 and answer a 400 whose remedy was "preview
  // again" — the thing the caller had just done. `"private"` is what this tool's
  // `visibility` description already promises as the default.
  const visibility = input.visibility ?? "private";

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
        visibility,
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
      // 🔒 G16 — THE TOKEN, SPENT, BECOMES THE SERVER'S PRECONDITION. Only ever
      // `true`, and only from a token this call actually consumed. See
      // `confirm-token.ts › ConfirmVerdict`.
      acknowledgeShared: verdict.acknowledgedShared || undefined,
    });
  } catch (e) {
    // ⚠ THE AUDIENCE CEILING'S CREATE REFUSAL, RENDERED AS A REFUSAL rather
    // than rethrown as a transport-shaped error (F-323's authoring half). The
    // server's message already names the room, the cause and the remedy —
    // `knowledge/server/service-base-writes.ts › assertCreatorCanReadItBack` —
    // and this is the one path where an agent MUST be able to act on it without
    // opening the repo, because the alternative it used to get was a SUCCESS
    // string over a row it could never see again.
    const ceiling = agentCreateForbidden(e);
    if (ceiling) return err(ceiling);
    // 🔒 G16 — only ever a RACE here: the gate above already previewed and spent
    // a token, so reaching this means the room gained a member in between.
    const unacknowledged = containerPublishUnacknowledged(e, RECONFIRM_REMEDY);
    if (unacknowledged) return unacknowledged;
    throw e;
  }
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

/**
 * ⚠ **THE OTHER PUBLISHING DOOR, AND IT IS NOT PREVIEWED HERE — DELIBERATELY,
 * AND ONLY FOR NOW.** This file used to argue that gating `create_base` and not
 * `set_visibility` "would be theatre". Since G16 the SERVER gates both
 * (`src/features/knowledge/server/service-base-writes.ts › updateBase` →
 * `features/workspaces/server/shared-publish.ts`), so the asymmetry moved: an
 * agent publishing into a shared home channel is now REFUSED here rather than
 * silently allowed, and {@link containerPublishUnacknowledged} is what makes
 * that refusal legible.
 *
 * ⚠ **THE PREVIEW IS HERE SINCE 2026-09-02 (F-441, integration of A3 × A11).**
 * It was a cross-slice request while `tools/knowledge.ts` belonged to another
 * slice: `confirmGate` needs the caller's user id and the call's
 * `confirm_token`, and that arm passed neither, so a shared-container publish
 * answered with a refusal-plus-remedy instead of a preview. Both are plumbed
 * now, and this op previews and confirms exactly as `create_base` does — one
 * mechanism for one act, which is the whole of G16.
 *
 * ⚠ **THE REFUSAL PATH BELOW STAYS AND IS NOT DEAD CODE.** `confirmGate` fires
 * on the SHAPE this process can see (a shared link container); the server's own
 * predicate is the authority and includes facts this process cannot check. A
 * 400 from it still has to be legible, and {@link containerPublishUnacknowledged}
 * is what makes it so. Removing either half leaves one door unguarded.
 *
 * ⚠ NOTHING CHANGES IN A STANDARD WORKSPACE — the server's predicate is
 * `kind='link'` ∧ ≥2 members, and publishing to colleagues costs no extra call.
 */
export async function opSetVisibility(
  client: DoplClient,
  callerUserId: string | null,
  ref: string,
  visibility: string,
  confirmToken?: string,
): Promise<ToolResponse> {
  if (visibility !== "public") {
    return err(
      `set_visibility only publishes (visibility="public") a base you created. Un-publishing is human-only — use the Dopl web UI.`,
    );
  }
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;

  // 🔒 G16 — PREVIEW, THEN PUBLISH. Resolved AFTER the base, deliberately: the
  // name the preview shows the operator has to be the base this call is about,
  // and a token minted over a base that does not resolve confirms nothing.
  const verdict = await confirmGate(
    client,
    {
      tool: "dopl_kb",
      op: "set_visibility",
      callerUserId,
      what: `the knowledge base ${inlineOr(base.name, NO_NAME)} (slug: \`${base.slug}\`), published workspace-wide`,
      audience: `everyone in that home channel — the peer standing in it can read everything in it, including what was written while it was private`,
      payload: { base: base.id, visibility: "public" },
    },
    { publishes: true, token: confirmToken },
  );
  if (verdict.kind === "halt") return verdict.response;

  let updated;
  try {
    updated = await client.updateKbBase(base.id, {
      visibility: "public",
      // 🔒 The token, SPENT, becomes the server's precondition — the same
      // mapping `create_base` makes, one op over.
      acknowledgeShared: verdict.acknowledgedShared || undefined,
    });
  } catch (e) {
    // Read-only-to-agents base — the clean message, not a raw dump.
    const denied = agentWriteDenied(e);
    if (denied) return denied;
    // 🔒 G16 — the server's publish precondition. See the docblock above for
    // why this op answers with a REMEDY rather than a preview.
    const unacknowledged = containerPublishUnacknowledged(
      e,
      `This call already previewed and confirmed, so the server is refusing on a fact this process cannot see — re-previewing would answer the same. Ask your operator to publish the base from the Dopl app, where the audience change is stated before they press.`,
    );
    if (unacknowledged) return unacknowledged;
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

/**
 * `op="grant"` — lend ONE base to a channel, container or team. The op that
 * REPLACED `op="copy_base"` (Wave B slice B15, ruling B11).
 *
 * ⚠ **THE RESOLVE IS THE ORDINARY ONE.** `resolveBaseOr` answers what this
 * caller may see, `notOwnedRefusal` then narrows that to what they CREATED (R2),
 * and the server repeats both — this tier exists to spend no round trip on a
 * refusal it can already prove and to say WHY, where the server's uniform 404
 * deliberately cannot.
 */
export async function opGrantBase(
  client: DoplClient,
  directory: WorkspaceDirectory,
  selfUserId: string | null,
  ref: string,
  scope: GrantScopeArg,
  to: string,
  level: GrantLevelArg | undefined,
): Promise<ToolResponse> {
  const chosen = levelForScope(scope, level);
  if (isGrantRefusal(chosen)) return chosen;
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  const notOwned = notOwnedRefusal(base.createdBy, selfUserId, "knowledge base", base.name);
  if (notOwned) return notOwned;
  const scopeId = await resolveGrantScopeId(directory, scope, to);
  if (isGrantRefusal(scopeId)) return scopeId;
  await client.grantResource({
    resourceType: "knowledge_base",
    resourceId: base.id,
    scopeType: scope,
    scopeId,
    level: chosen,
  });
  return grantedLine("knowledge base", base.name, scope, scopeId, chosen);
}
