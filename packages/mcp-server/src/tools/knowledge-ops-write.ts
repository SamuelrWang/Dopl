/**
 * `dopl_kb` non-destructive WRITE op handlers: create/update/set_visibility/grant
 * on bases, create/move folders, write/move entries. Every write maps @dopl/client errors — conflict (412),
 * already-exists (409), agent-write-denied (403), and validation (400) —
 * to actionable tool messages. Routed from the registrar in knowledge.ts.
 */

import type { DoplClient } from "@dopl/client";
import { inlineOr, NO_NAME, NO_PATH } from "./narration";
import { ok, err, isConflict, isAlreadyExists, isApiError, apiMessage, type ToolResponse } from "./respond";
import { KB_TARGET_VANISHED, refusal, versionConflict } from "./tool-errors";
import { agentWriteDenied, resolveBaseOr } from "./knowledge-shared";
// ⚠ THE `zod` → SENTENCE TRANSLATION LIVES APART (S52, 2026-09-18) — see
// `knowledge-validation.ts`'s header for the seam and for the rule it enforces.
import {
  createFolderValidationError,
  updateBaseValidationError,
  writeFileValidationError,
} from "./knowledge-validation";
import { isErr } from "./channel-shared";
import {
  confirmGate,
  containerPublishUnacknowledged,
  RECONFIRM_REMEDY,
} from "./confirm-token";
import type { WorkspaceDirectory } from "../workspace-directory";
import {
  homeChannelRowNotShared,
  resolveChannelShareTarget,
} from "./container-destination";
import {
  KB_SECTION_NUDGE_CHARS,
  outlineFooter,
  unsectionedNudge,
} from "./knowledge-sections";

/*
 * ⚠ Write confirmations read back the STORED value, not the argument (a
 * canonicalised base name, a title derived from a path), spliced into our own
 * narration — and a path can carry a backtick, since `NAME_RE` bans control and
 * zero-width characters, NOT markdown. A name is a VALUE.
 *
 * The fallbacks themselves are `narration.ts › NO_NAME` / `NO_PATH` (2026-09-17).
 */

/**
 * Run a write, mapping the ONE 403 EVERY base write can raise. Six hand-written
 * copies of this catch lived in this file (2026-09-17).
 *
 * ⚠ `more` runs FIRST, for the per-op codes — 409, 412 and 400, every one of
 * them disjoint from `AGENT_WRITE_DISABLED`, so the order is a convenience and
 * not a precedence. Anything neither maps RETHROWS: a catch that swallowed an
 * outage would report it as a refusal.
 */
async function writeOr<T>(
  run: () => Promise<T>,
  more: (e: unknown) => ToolResponse | null = () => null,
): Promise<T | ToolResponse> {
  try {
    return await run();
  } catch (e) {
    const mapped = more(e) ?? agentWriteDenied(e);
    if (mapped) return mapped;
    throw e;
  }
}

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
    /** S53 — passed through untouched; the server probes it and returns the
     *  first base rather than minting a second. */
    client_write_id?: string;
  },
  /** ⚠ OPTIONAL — absent means "not known": the create goes out unshared and
   *  the SERVER refuses it (`container-destination.ts`). */
  directory?: WorkspaceDirectory,
): Promise<ToolResponse> {
  // 🔒 **DESTINATION 2, IN ONE SERVER CALL** (Samuel, 2026-09-18; the model is
  // `container-destination.ts`'s header). A home channel holds only what is
  // SHARED into it. ⚠ **THE BASE STAYS `private` AND THE GRANT IS THE AUDIENCE**,
  // which is why this does not touch `visibility` as the template lane does.
  const shareToChannelId = await resolveChannelShareTarget(client, directory);
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
        // ⚠ ON THE DIGEST: a token is bound to what LANDS, grant included.
        shareToChannelId: shareToChannelId ?? null,
      },
    },
    {
      publishes: visibility === "public",
      token: input.confirm_token,
      // 🔒 **THE PREVIEW RUNS THE SAME GATE AS THE CONFIRMED CALL** (task 11's
      // missing pin). Observed live: this op previewed a public create in a
      // shared home channel, handed back a token, and the echoed call was then
      // refused by the server's create gate — the preview promised an act the
      // gate forbids.
      //
      // ⚠ **THE SERVER ANSWERS, BECAUSE THE SERVER REFUSES.** Whether a create
      // may land depends on the audience ceiling and on whether the operator
      // has armed this room for their personal shelf — grant rows and arming
      // rows this process cannot see. So the precheck asks the create's OWN
      // gate chain (`assertCreateBaseAllowed` behind `?dryRun=1`) rather than
      // re-deciding here, which is the only version of "the same gate" that
      // stays true after the next gate is added.
      //
      // ⚠ **THE BODY IS THE ONE THE CONFIRM WILL SEND**, `acknowledgeShared`
      // included: the confirmed call carries it from the spent token, and
      // asking without it would refuse on the missing acknowledgement — the
      // very thing this preview exists to obtain.
      precheck: async () => {
        try {
          await client.dryRunKbBase({
            name: input.name,
            description: input.description,
            visibility,
            // ⚠ PART OF THE CONFIRMED BODY: without it a dry run previews an
            // act the gate forbids (2026-09-18).
            shareToChannelId,
            acknowledgeShared: true,
          });
        } catch (e) {
          // The server's own sentence, which already names the room, the cause
          // and the remedy — and it is TRUE of a dry run word for word:
          // nothing was created, no slug taken.
          const ceiling = agentCreateForbidden(e);
          if (ceiling) return err(ceiling);
          // ⚠ ANYTHING ELSE RETHROWS RATHER THAN MINTING. "I could not check"
          // is not "it is allowed", and the caller loses nothing by retrying:
          // no row was written and no token was spent.
          throw e;
        }
        return null;
      },
    },
  );
  if (verdict.kind === "halt") return verdict.response;

  let base;
  try {
    base = await client.createKbBase({
      name: input.name,
      clientWriteId: input.client_write_id,
      description: input.description,
      visibility,
      // 🔒 DESTINATION 2, ATOMIC — the base rolls back if the grant fails.
      shareToChannelId,
      // 🔒 G16 — THE TOKEN, SPENT, BECOMES THE SERVER'S PRECONDITION. Only ever
      // `true`, and only from a token this call actually consumed. See
      // `confirm-token.ts › ConfirmVerdict`.
      acknowledgeShared: verdict.acknowledgedShared || undefined,
    });
  } catch (e) {
    // ⚠ THE AUDIENCE CEILING'S CREATE REFUSAL, RENDERED AS A REFUSAL rather
    // than rethrown as a transport-shaped error (F-323's authoring half). The
    // server's message already names the room, the cause and the remedy —
    // `knowledge/server/service-base-gates.ts › resolveCreateDestination` —
    // and this is the one path where an agent MUST be able to act on it without
    // opening the repo, because the alternative it used to get was a SUCCESS
    // string over a row it could never see again.
    const ceiling = agentCreateForbidden(e);
    if (ceiling) return err(ceiling);
    // 🔒 The destination fence (2026-09-18): the probe fails open, so this is
    const unshared = homeChannelRowNotShared(e); // the SERVER refusing.
    if (unshared) return unshared;
    // 🔒 G16 — only ever a RACE here: the gate above already previewed and spent
    // a token, so reaching this means the room gained a member in between.
    const unacknowledged = containerPublishUnacknowledged(e, RECONFIRM_REMEDY);
    if (unacknowledged) return unacknowledged;
    throw e;
  }
  // ⚠ THE GRANT IS THE AUDIENCE (2026-09-18): a shared base is stored `private`.
  const visNote = shareToChannelId
    ? "Shared in this channel — everyone here can read it."
    : base.visibility === "private"
      ? "Private to you — only you and your agent can see it."
      : "Visible to the whole workspace.";
  return ok(
    `Created knowledge base ${inlineOr(base.name, NO_NAME)} (slug: \`${base.slug}\`). ${visNote}`
  );
}

export async function opUpdateBase(client: DoplClient, ref: string, name?: string, description?: string | null, slug?: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  const updated = await writeOr(
    () => client.updateKbBase(base.id, { name, description, slug }),
    updateBaseValidationError,
  );
  if (isErr(updated)) return updated;
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

  // 🔒 G16 — the server's publish precondition. See the docblock above for why
  // this op answers with a REMEDY rather than a preview.
  const updated = await writeOr(
    () =>
      client.updateKbBase(base.id, {
        visibility: "public",
        // 🔒 The token, SPENT, becomes the server's precondition — the same
        // mapping `create_base` makes, one op over.
        acknowledgeShared: verdict.acknowledgedShared || undefined,
      }),
    (e) =>
      containerPublishUnacknowledged(
        e,
        `This call already previewed and confirmed, so the server is refusing on a fact this process cannot see — re-previewing would answer the same. Ask your operator to publish the base from the Dopl app, where the audience change is stated before they press.`,
      ),
  );
  if (isErr(updated)) return updated;
  return ok(
    `Published knowledge base ${inlineOr(updated.name, NO_NAME)} (slug: \`${updated.slug}\`) — now visible workspace-wide.`,
  );
}

export async function opCreateFolder(client: DoplClient, ref: string, path: string, description?: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  // ⚠ **THE 400 WAS RETHROWN RAW UNTIL 2026-09-18 (S52).** `description` is
  // capped at 300 like an entry's `excerpt`, and this op had no mapper at all —
  // so the folder half of the pair reached the agent as an unhandled
  // `VALIDATION_FAILED` with no field, no number and no remedy.
  const folder = await writeOr(
    () => client.createKbFolderByPath(base.id, path, description),
    createFolderValidationError,
  );
  if (isErr(folder)) return folder;
  const descNote = description !== undefined ? " Description set." : "";
  return ok(`Folder ready at ${inlineOr(path, NO_PATH)} (id: \`${folder.id}\`).${descNote}`);
}

/**
 * `move_folder` and `move_file` — ONE mover (2026-09-17). They were two
 * functions differing only in a noun: `moveKbByPath` is path-addressed and
 * kind-agnostic, so the only per-op logic is checking that the path resolved to
 * the KIND the caller named — which is a refusal, because moving an entry on a
 * `move_folder` would be a write the caller never asked for.
 */
export async function opMove(
  client: DoplClient,
  ref: string,
  from_path: string,
  to_path: string,
  kind: "folder" | "entry",
): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  const result = await writeOr(() =>
    client.moveKbByPath(base.id, from_path, to_path),
  );
  if (isErr(result)) return result;
  if (result.kind !== kind) {
    return err(
      `Path ${inlineOr(from_path, NO_PATH)} resolved to a ${result.kind}, not ${kind === "folder" ? "a folder" : "an entry"}.`
    );
  }
  const noun = kind === "folder" ? "Folder" : "Entry";
  return ok(`${noun} moved: ${inlineOr(from_path, NO_PATH)} → ${inlineOr(to_path, NO_PATH)}.`);
}

/**
 * ⚠ **`section` MAKES THIS A READ-MODIFY-WRITE, AND THE SERVER DOES ALL THREE.**
 * The splice happens against the row `expected_version` was just checked on, so
 * a sectioned write is exactly as safe as a whole-body one — where a caller
 * merging locally would be merging onto a body it fetched in an earlier request.
 *
 * ⚠ **THE RESULT ALWAYS ENDS WITH THE OUTLINE OF WHAT WAS SAVED**, which is the
 * addresses the next read can use, and it LEADS with `reason=UNSECTIONED` when a
 * long body carries no headings at all. **The write lands either way** (Samuel's
 * ruling): refusing would refuse the user's content over our formatting taste.
 */
export async function opWriteFile(client: DoplClient, ref: string, path: string, body: string, title?: string, expected_version?: string, force?: boolean, excerpt?: string, section?: string, clientWriteId?: string): Promise<ToolResponse> {
  const base = await resolveBaseOr(client, ref);
  if (isErr(base)) return base;
  const res = await writeOr(
    () =>
      client.writeKbFileByPath(
        base.id,
        path,
        { body, title, excerpt, section, clientWriteId },
        force ? null : expected_version
      ),
    (e) => {
      // ⚠ THE ONE REFUSAL `section` ADDS, and it is a refusal rather than a
      // first-match because the write it would have made is unrecoverable.
      if (isApiError(e, 409, "KNOWLEDGE_SECTION_AMBIGUOUS")) {
        return err(
          `reason=SECTION_AMBIGUOUS · ${apiMessage(e) ?? "that heading names more than one section."} · retry=none, they have the same name\n\nNOTHING was written. Rename one of them, or drop \`section\` and write the whole body.`,
        );
      }
      // 🔒 **THE TARGET VANISHED, AND IT IS NOT A VERSION PROBLEM (S40,
      // 2026-09-18).** Discriminated on the CODE and placed BEFORE both
      // status-only arms below, which would otherwise read this 409 as
      // "an entry with that title already exists" — the opposite fact.
      if (isApiError(e, 409, "KNOWLEDGE_TARGET_VANISHED")) {
        return err(
          refusal(
            KB_TARGET_VANISHED,
            `NOTHING was written at ${inlineOr(path, NO_PATH)}. A path is a POSITION, not an identity: op="move_file" and a retitle both vacate one. ⚠ Do NOT re-issue this call with force=true — write_file is an UPSERT, so a forced write at a vacated path CREATES A SECOND ENTRY that nothing afterwards can tell from the first. Find where it went with op="list_dir" (or op="get_tree"), then write at the path it is at now. An ENTRY ID survives a move; a path does not.`,
          ),
        );
      }
      // ⚠ **THE MOVE AND THE DUPLICATE RISK ARE NAMED HERE TOO (S40).** A
      // conflict says somebody wrote after your read — and the write that
      // "somebody" made may have been a MOVE, in which case the path you are
      // holding is about to stop resolving. An agent told only "reconcile and
      // retry" reaches for `force`, which is the one input that used to walk
      // past the server's own anti-duplicate guard.
      if (isConflict(e)) {
        return err(
          refusal(
            versionConflict('op="read_file"'),
            `NOTHING was written at ${inlineOr(path, NO_PATH)}. Read it again for the current body and Version, reconcile, then re-issue with that expected_version. ⚠ The other write may have MOVED or RENAMED this entry rather than edited it — check op="list_dir" before you retry, because write_file is an UPSERT and a forced write at a vacated path creates a DUPLICATE rather than overwriting anything.`,
          ),
        );
      }
      if (isAlreadyExists(e)) {
        return err(
          `An entry titled ${inlineOr(title ?? path.split("/").filter(Boolean).pop(), NO_NAME)} already exists in that folder. Pick a different title/path, or read+overwrite the existing entry with dopl_kb(op="read_file" → "write_file").`
        );
      }
      // ⚠ Name the failing field + rule, never a raw "VALIDATION_FAILED".
      return writeFileValidationError(e, title);
    },
  );
  if (isErr(res)) return res;
  const { entry, outline, sectionCreated } = res;
  // 🔒 **THE CONVERGED RESULT SAYS SO, FIRST, AND IT IS NOT AN ERROR** (S53).
  // The row came back off `client_write_id`, so THIS call wrote nothing and the
  // body stored is the FIRST call's. An agent told only "Wrote …" over a
  // converged result would believe its second, different body is what is saved
  // — which is worse than the timeout it was recovering from.
  // ⚠ `retry=none` BECAUSE THE WRITE LANDED: the same grammar the PIN_LARGE
  // warning uses for a nudge that rides a SUCCESS, so nothing here reads as a
  // refusal. ⚠ `?? false` (INVARIANTS §8): an older server sends no such key and
  // absent must read as "this call wrote", the behaviour before the field.
  const convergedNote = (res.converged ?? false)
    ? `reason=converged · this call wrote NOTHING — client_write_id matched an earlier write of yours, and what is below is THAT write's entry · retry=none, it landed. If the body you just sent differs from the stored one, read_file it and write again with a NEW key.`
    : null;
  // ⚠ The addressable path's leaf is the entry's TITLE, not the input path's
  // leaf segment — print it, and surface the canonical form when a passed
  // `title` slugs differently from the input leaf.
  const parentSegments = path.split("/").slice(0, -1).filter(Boolean);
  const canonicalPath = [...parentSegments, entry.title].join("/");
  const note =
    canonicalPath !== path
      ? ` Address future reads/moves with path ${inlineOr(canonicalPath, NO_PATH)}.`
      : "";
  // ⚠ THE NUDGE LEADS, because a `reason=` line read after the success sentence
  // is a line an agent has already decided it does not need.
  const unsectioned =
    entry.body.length > KB_SECTION_NUDGE_CHARS &&
    (outline?.sections.length ?? 0) === 0;
  const sectionNote =
    section === undefined
      ? ""
      : sectionCreated
        ? ` Section ${inlineOr(section, "`(unreadable)`")} did not exist and was APPENDED at \`##\` level.`
        : ` Replaced section ${inlineOr(section, "`(unreadable)`")}; the rest of the entry is untouched.`;
  return ok(
    [
      ...(convergedNote ? [convergedNote, ""] : []),
      ...(unsectioned ? [unsectionedNudge(), ""] : []),
      `Wrote ${inlineOr(canonicalPath, NO_PATH)} (entry id: \`${entry.id}\`, ${entry.body.length} chars). New version: \`${entry.updatedAt}\`.${note}${sectionNote}`,
      ...[outlineFooter(outline)].filter((l): l is string => l !== null),
    ].join("\n")
  );
}
