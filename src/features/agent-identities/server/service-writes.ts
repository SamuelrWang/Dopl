import "server-only";
import { isSharedCredential } from "@/shared/auth/credential-audience";
import type {
  AgentIdentity,
  AgentIdentityContext,
  IdentityVisibility,
} from "../types";
import type {
  AgentIdentityCreateInput,
  AgentIdentityUpdateInput,
} from "../schema";
// 🔒 G16 — the ONE statement of the publish-into-a-peer's-room precondition,
// shared with `knowledge/server/service-base-writes.ts`. Two copies of a
// tenancy predicate is how the shelf fence ended up divergent (findings §6 #3).
import { assertSharedPublishAcknowledged } from "@/features/workspaces/server/shared-publish";
// 🔒 The ONE statement of "a home channel holds only what is shared into it",
// shared with `knowledge/server/service-base-gates.ts` for the same reason the
// line above it is shared — see that module's header for the ruling.
import { assertHomeChannelRowIsShared } from "@/features/workspaces/server/home-channel-destination";
import {
  IdentityStaleVersionError,
  IdentityTeamScopeAgentForbiddenError,
  IdentityTeamNotGrantableError,
  IdentityWriteForbiddenError,
  WorkspaceKeyPrivateIdentityError,
} from "./errors";
import * as repo from "./repository";
import {
  getIdentityById,
  getIdentityForWrite,
  readIdentityById,
} from "./service-reads";
// 🔒 THE ASKING SEAM, SPLIT OUT LIKE ITS KNOWLEDGE TWIN (`knowledge/server/
// service-base-gates.ts`). Read that module's header for why it is NOT the same
// function, and for what was open before it existed.
import {
  assertTeamScopeGrantable,
  resolveIdentityCreateDestination,
} from "./service-write-gates";
import {
  assertAttachableKnowledgeScopes,
  requestedKnowledgeScopes,
} from "./service-knowledge-scopes";
import {
  isWorkspaceAdmin,
  normalizeFieldsInput,
  normalizeLabel,
  normalizeProse,
  stripNullBytes,
} from "./service-shared";

/**
 * Agent-identity writes — create / update (metadata, sharing, attachments) /
 * hard delete.
 *
 * ⚠ THE WRITE GATE IS CREATOR-OR-WORKSPACE-ADMIN, FOR EVERY FIELD. There is no
 * per-identity "editable by the team it is shared with" level, deliberately: a
 * identity is an IDENTITY someone authored, and team `visibility` shares the
 * ability to USE it, not to rewrite what it says. This is why the team linkage
 * here carries no `level` column (see the migration header).
 */

// ─── Create ─────────────────────────────────────────────────────────────

/**
 * ⚠ **THE HOME-SHELF FENCE STOOD HERE UNTIL 2026-09-02 (slice B15).**
 * `resolveIdentityHomeScope` was a hand-mirror of
 * `knowledge/server/service-base-gates.ts › resolveHomeScope`, and both are
 * DELETED with the `home_scoped` column they answered for. `shared/tenancy/
 * personal-container.ts › personalWriteWorkspaceId` is the one fence now, and
 * its docblock retires each of the three conditions by name — including the one
 * this copy's docblock argued was substantively different (an identity's
 * `private` is TERMINAL where a KB's is a floor), which stopped mattering when
 * the shelf became a container with one member.
 */

export async function createIdentity(
  ctx: AgentIdentityContext,
  input: AgentIdentityCreateInput
): Promise<AgentIdentity> {
  // Visibility default depends on the caller, the same rules as `createSkill` /
  // `createBase`: a SHARED credential defaults to `workspace` and may never own
  // a private row (it can be shared between humans, so "private to the
  // credential" means nothing); everyone else defaults to `private`.
  // ⚠ `isSharedCredential`, moved with `canSeeIdentity` on 2026-08-27 (F-333):
  // a container SESSION owns private rows exactly as its operator does, and
  // defaulting it to `workspace` would publish the operator's agent into the
  // room the peer is standing in.
  const fromWorkspaceKey = isSharedCredential(ctx);
  let visibility: IdentityVisibility;
  if (fromWorkspaceKey) {
    if (input.visibility === "private") throw new WorkspaceKeyPrivateIdentityError();
    visibility = input.visibility ?? "workspace";
  } else {
    visibility = input.visibility ?? "private";
  }

  // 🔒 **WHERE THE ROW LANDS, DECIDED BEFORE ANYTHING IS WRITTEN OR READ** —
  // gap 2 of #1077's identity half, and the fence `personal-reach.ts` was
  // missing on this side. Until this call, `input.homeScoped` went straight to
  // the repository, so an agent in an UNARMED shared room could write onto its
  // operator's personal shelf by naming a flag — a shelf the same fence forbids
  // it to even enumerate. See `service-write-gates.ts` for why this is a twin
  // rather than a call into the knowledge gate.
  // ⚠ FIRST, and it takes the RESOLVED visibility: `team` names the calling
  // container and must never be re-routed, and `input.visibility` is not the
  // landing value for a caller that named nothing.
  const destination = await resolveIdentityCreateDestination(ctx, {
    homeScoped: input.homeScoped,
    visibility,
  });

  // ⚠ VALIDATE BEFORE INSERTING. Both checks can reject, and an identity that
  // exists with the wrong sharing (or with attachments silently dropped) is
  // worse than one that was never created — there is no transaction across
  // these three statements, so the order IS the atomicity story.
  assertTeamScopeIsHuman(ctx, visibility);
  // 🔒 …AND THE CONTAINER MUST BE ONE THAT HAS TEAMS (Samuel, 2026-09-08). ⚠ THE
  // DESTINATION, not the calling room: the gate above may have re-routed the row.
  if (visibility === "team") await assertTeamScopeGrantable(destination.workspaceId);
  const teamIds =
    visibility === "team"
      ? await assertGrantableTeams(ctx, input.teamIds ?? [], [])
      : [];
  const knowledgeScopes = await assertAttachableKnowledgeScopes(
    ctx,
    requestedKnowledgeScopes(input) ?? []
  );

  // 🔒 G16 — PUBLISHING INTO THE ROOM A PEER IS STANDING IN. ⚠ The RESOLVED
  // visibility, for the same reason the shelf fence reads it: the row's landing
  // value is the audience, and `input.visibility` is not it for a caller that
  // named nothing.
  // ⚠ THE CONTAINER THE ROW LANDS IN, not the one the call stands in — the same
  // correction the knowledge create carries. G16 asks whether this publishes
  // into the room a PEER is standing in; a personal row lands on a shelf with
  // one member, so asking about the ROOM would demand an acknowledgement for an
  // audience the row never reaches. Identical to `ctx.workspaceId` for every
  // non-personal create.
  await assertSharedPublishAcknowledged({
    workspaceId: destination.workspaceId,
    publishes: visibility === "workspace",
    acknowledged: input.acknowledgeShared,
    noun: "agent",
  });

  // 🔒 **THE THIRD DESTINATION DOES NOT EXIST** (Samuel, 2026-09-18) — a
  // `private` identity inside a home channel is listed by nothing, because
  // `lib/visibility.ts › SECTIONS_CONTAINER` stopped offering the value on
  // 2026-08-27 and a container has no Agents page of its own. That ruling
  // trimmed ONE array in the editor and left every other door open; this is the
  // server half. ⚠ THE DESTINATION, like both gates above it: a row re-routed to
  // the personal container is destination 1 and must not be refused.
  await assertHomeChannelRowIsShared({
    workspaceId: destination.workspaceId,
    shared: visibility !== "private",
    noun: "agent identity",
    remedy: 'visibility: "workspace"',
  });

  const identity = await repo.insertIdentity({
    // 🔒 THE DESTINATION, and the flag beside it cannot disagree with it: both
    // resolve the personal container by OWNER through `findPersonalContainerId`
    // — the gate via the fence, the router via `personalWriteWorkspaceId`.
    workspaceId: destination.workspaceId,
    name: stripNullBytes(input.name),
    description: normalizeProse(input.description),
    instructions: normalizeProse(input.instructions),
    model: normalizeLabel(input.model),
    runtime: input.runtime ?? null,
    fields: normalizeFieldsInput(input.fields),
    visibility,
    // 🔒 A ROUTING FLAG, NOT A COLUMN (B15) — see `insertIdentity`.
    homeScoped: destination.homeScoped,
    createdBy: ctx.userId,
  });

  // 🔒 **BOTH JUNCTIONS FOLLOW THE ROW, NOT THE CALL.** `resource_grants` and
  // `agent_identity_knowledge_bases` each carry a `workspace_id` and each READ
  // filters on it (`listTeamLinksForIdentities`,
  // `listKnowledgeLinksForIdentities`), so a link filed under the ROOM for a row
  // that lives in the CONTAINER is a link nothing ever reads back — the
  // identity would come back with an empty attachment list and no team.
  // ⚠ `teamIds` is empty by construction on a personal create (the gate refuses
  // `team` there), so this line is the workspace path unchanged; it names the
  // destination anyway, because the pair must not be able to drift.
  if (teamIds.length > 0) {
    await repo.replaceTeamLinks(
      destination.workspaceId,
      identity.id,
      teamIds,
      ctx.userId
    );
  }
  if (knowledgeScopes.length > 0) {
    await repo.replaceKnowledgeLinks(
      destination.workspaceId,
      identity.id,
      knowledgeScopes,
      ctx.userId
    );
  }
  // Re-read through the gated path so the response is the same shape a GET
  // returns — including the viewer-filtered attachment list.
  //
  // ⚠ **THE ID-RESOLVING READ, AND ONLY WHEN THE ROW LEFT THE CALLING
  // CONTAINER.** `getIdentityById` is keyed to `ctx.workspaceId` and is the
  // WRITE GATE, which is why create/update/delete funnel through it — but this
  // call is not a gate, it is the response shaper for a row THIS CALLER JUST
  // WROTE, and keyed to the room it answered 404 for a create that had just
  // succeeded onto the personal shelf. `readIdentityById` is the sanctioned
  // follow (A12): strictly narrower than `canSeeIdentity`, re-based context and
  // role handled by `shared/tenancy/read-resource.ts`, same 404 and never a 403.
  // ⚠ The workspace path is byte-identical — `destination.workspaceId` equals
  // `ctx.workspaceId` for every non-personal create, and the resolving read
  // costs its two extra reads ONLY on a miss in this tenancy.
  return destination.workspaceId === ctx.workspaceId
    ? getIdentityById(ctx, identity.id)
    : readIdentityById(ctx, identity.id);
}

// ─── Update ─────────────────────────────────────────────────────────────

/** ⚠ **`expectedUpdatedAt` IS OPTIONAL HERE AND REQUIRED ONE LAYER UP** (F-747),
 *  where the KB lane puts the same decision: the strictness lives in
 *  `packages/dopl-client/src/agent-identities.ts`, because the MCP server ships
 *  INSIDE the desktop app and a route demanding the header would refuse every
 *  field build that cannot send one. Absent is last-writer-wins, not a door. */
export async function updateIdentity(
  ctx: AgentIdentityContext,
  id: string,
  patch: AgentIdentityUpdateInput,
  expectedUpdatedAt?: string
): Promise<AgentIdentity> {
  // ⚠ 404 for an invisible identity happens HERE, before the write gate, so a
  // 403 can only ever be returned for a row the caller already knew about.
  // 🔓 THE ID NAMES ITS OWN CONTAINER ON A WRITE (2026-09-06). `tplCtx` is where
  // the row lives, with the caller's real role there; the row update, BOTH
  // junction replacements, the grantable-teams check and the attachable-bases
  // check all take it, because every one of them is workspace-keyed.
  const { ctx: tplCtx, value: existing } = await getIdentityForWrite(ctx, id);
  assertMayWrite(tplCtx, existing, "edit");

  const nextVisibility = patch.visibility ?? existing.visibility;

  // ⚠ **THE SAME FENCE `createIdentity` CARRIES, ON THE UPDATE PATH TOO** (F-289,
  // 2026-08-23). Without it the create guard was defeated in two calls: POST
  // `visibility: "workspace"` (accepted, `created_by` stamped with the key's
  // `ctx.userId`), then PATCH `visibility: "private"` — `getIdentityById` passes
  // because the row is still `workspace` at read time, `assertMayWrite` passes
  // because the key IS the creator, and the row commits `private`. The end state
  // is exactly the one the create fence exists to prevent: a private identity
  // minted by a credential that "may be shared between humans", readable by the
  // key owner's human session, invisible to the key itself, and invisible to
  // every workspace admin (the admin arm of `canSeeIdentity` sits BELOW the
  // private arm). The final `getIdentityById` 404s the RESPONSE, which is a tell
  // rather than a guard — the write has already landed by then.
  // ⚠ `knowledge/server/service-base-writes.ts` fences its own update path for
  // this reason in one sentence: "Workspace-scoped keys can't read private rows
  // back, so they may not create this state either." (`skills/server/
  // service-writes.ts` guards only on create — same gap, filed separately.)
  // ⚠ IT IS `nextVisibility`, NOT `patch.visibility`, ON PURPOSE: the state that
  // matters is the one the row LANDS in, and a key that already owns a private
  // row must not be able to patch its name and keep it.
  // ⚠ THE SUBJECT NARROWED ON 2026-08-27 (F-333) AND THE FENCE DID NOT MOVE:
  // it now reads `isSharedCredential`, so it still refuses every credential
  // with nobody behind it, and no longer refuses the OPERATOR's own container
  // session — which can read a private row back, so none of the reasoning above
  // applies to it.
  if (nextVisibility === "private" && isSharedCredential(ctx)) {
    throw new WorkspaceKeyPrivateIdentityError();
  }

  // 🔒 G16 — the same precondition on the UPDATE path, which is the OTHER way a
  // row reaches the shared visibility (F-289's argument, on a different axis:
  // a create fence with no update twin is a fence defeated in two calls).
  // ⚠ `patch.visibility`, NOT `nextVisibility`, AND THAT IS THE OPPOSITE CHOICE
  // FROM THE PRIVATE FENCE ABOVE — deliberately. That one asks where the row
  // LANDS, because a shared credential must not own a private row however it
  // got there. This one asks what the caller CHANGED: a row already shared is
  // already seen by the room, and making a rename acknowledge an audience it
  // did not touch would be a gate on the wrong verb.
  await assertSharedPublishAcknowledged({
    workspaceId: tplCtx.workspaceId,
    publishes: patch.visibility === "workspace",
    acknowledged: patch.acknowledgeShared,
    noun: "agent",
  });

  // 🔒 **THE UPDATE TWIN OF THE CREATE'S HOME-CHANNEL FENCE** (Samuel,
  // 2026-09-18). A create fence with no update twin is a fence defeated in two
  // calls — F-289's own argument, which this file already makes twice.
  // ⚠ `nextVisibility`, so a patch that leaves a row already `private` in a home
  // channel alone is refused too. That is deliberate and it is the narrow
  // reading of "do not touch the orphans": nothing MIGRATES them, and the first
  // write that reaches one has to move it to a destination that exists.
  await assertHomeChannelRowIsShared({
    workspaceId: tplCtx.workspaceId,
    shared: nextVisibility !== "private",
    noun: "agent identity",
    remedy: 'visibility: "workspace"',
  });

  // VISIBILITY TRANSITIONS ARE FREE FOR THE OWNER, in any direction —
  // `private → workspace → team → private`. Nothing here guards narrowing (the
  // skills service makes the same note), because narrowing removes reach and
  // the person removing it is the person who granted it.
  let teamIds: string[] | null = null;
  if (patch.visibility !== undefined || patch.teamIds !== undefined) {
    // 🔒 A8's SERVER HALF, on the update path too — a create fence with no update
    // twin is a fence defeated in two calls (F-289's own argument).
    // ⚠ `nextVisibility`, so a `teamIds`-only patch on a row that is ALREADY
    // `team` is refused as well: it MOVES the audience, which is the act.
    assertTeamScopeIsHuman(ctx, nextVisibility);
    // 🔒 THE UPDATE TWIN of the create's own container check — without it the
    // create fence is defeated in two calls. ⚠ `tplCtx`, so the question is
    // asked about the container the ROW LIVES IN.
    if (nextVisibility === "team") await assertTeamScopeGrantable(tplCtx.workspaceId);
    teamIds =
      nextVisibility === "team"
        ? await assertGrantableTeams(
            tplCtx,
            patch.teamIds ?? existing.teamIds,
            existing.teamIds
          )
        : [];
  }

  // ⚠ `null` = the patch named NEITHER spelling, which leaves the junction
  // alone; `[]` from either spelling is the REPLACE-SET emptying it.
  const requestedScopes = requestedKnowledgeScopes(patch);
  const knowledgeScopes =
    requestedScopes === null
      ? null
      : await assertAttachableKnowledgeScopes(tplCtx, requestedScopes);

  // ⚠ Typed as the repository's own patch, so a new scalar column is a compile-time absence here.
  const rowPatch: repo.UpdateIdentityPatch = {
    name: patch.name === undefined ? undefined : stripNullBytes(patch.name),
    description:
      patch.description === undefined ? undefined : normalizeProse(patch.description),
    instructions:
      patch.instructions === undefined
        ? undefined
        : normalizeProse(patch.instructions),
    model: patch.model === undefined ? undefined : normalizeLabel(patch.model),
    runtime: patch.runtime,
    fields: patch.fields === undefined ? undefined : normalizeFieldsInput(patch.fields),
    visibility: patch.visibility,
  };
  // A junction-only write still UPDATEs the row (a same-value rename, never an empty
  // body — F-404) so the touch trigger versions it and the CAS guards attachments too (P7-03).
  if (
    (teamIds !== null || knowledgeScopes !== null) &&
    !Object.values(rowPatch).some((value) => value !== undefined)
  ) {
    rowPatch.name = existing.name;
  }
  // 🔒 The CAS runs BEFORE both junction writes (no transaction spans them), so a
  // lost race moves neither the links nor the columns.
  const touchesRow = Object.values(rowPatch).some((value) => value !== undefined);
  if (expectedUpdatedAt !== undefined) {
    const saved = await repo.updateIdentityRow(
      tplCtx.workspaceId,
      id,
      rowPatch,
      expectedUpdatedAt
    );
    // null = the CAS lost the race. Re-read for the version it actually holds,
    // exactly as `knowledge/server/service-entries.ts › updateEntry` does.
    if (saved === null) {
      const fresh = await getIdentityById(tplCtx, id);
      throw new IdentityStaleVersionError(expectedUpdatedAt, fresh.updatedAt);
    }
  } else if (touchesRow) {
    await repo.updateIdentityRow(tplCtx.workspaceId, id, rowPatch);
  }

  // ⚠ REPLACE-SET, and it runs even for the empty set: leaving an identity's
  // team links behind when it goes `private` would leave rows that come back to
  // life the moment somebody re-shares it to a different set of teams.
  if (teamIds !== null) {
    await repo.replaceTeamLinks(tplCtx.workspaceId, id, teamIds, ctx.userId);
  }
  if (knowledgeScopes !== null) {
    await repo.replaceKnowledgeLinks(
      tplCtx.workspaceId,
      id,
      knowledgeScopes,
      ctx.userId
    );
  }
  // ⚠ Re-read in the container the write landed in — keyed to the calling room
  // it would 404 the RESPONSE for an edit that had just succeeded, which is the
  // exact tell `createIdentity` above already had to fix on the create path.
  return getIdentityById(tplCtx, id);
}

// ─── Delete ─────────────────────────────────────────────────────────────

/**
 * ⚠ PERMANENT — no trash, no restore (Samuel's standing ruling). Both
 * junctions go with the row via `ON DELETE CASCADE`; nothing here deletes them
 * by hand, because a hand-written cascade is a cascade that gets a new child
 * table and forgets it.
 */
export async function deleteIdentity(
  ctx: AgentIdentityContext,
  id: string
): Promise<void> {
  const { ctx: tplCtx, value: existing } = await getIdentityForWrite(ctx, id);
  assertMayWrite(tplCtx, existing, "delete");
  await repo.hardDeleteIdentity(tplCtx.workspaceId, id);
}

// ─── Gates ──────────────────────────────────────────────────────────────

function assertMayWrite(
  ctx: AgentIdentityContext,
  identity: AgentIdentity,
  action: string
): void {
  const isCreator =
    identity.createdBy !== null && identity.createdBy === ctx.userId;
  if (isCreator || isWorkspaceAdmin(ctx)) return;
  throw new IdentityWriteForbiddenError(action);
}

/**
 * Teams the caller may actually share to.
 *   * every id must be a team OF THIS WORKSPACE — checked here so the junction's
 *     workspace-guard trigger never has to surface as an opaque 500;
 *   * a workspace ADMIN may name any of them;
 *   * a non-admin owner may name only teams they BELONG TO, plus teams the
 *     identity is ALREADY shared with (so editing a set an admin built does not
 *     silently revoke the parts the owner cannot re-add).
 * Both rules are lifted verbatim from `updateSkill`'s sharing branch.
 */
/**
 * 🔒 **THE TEAM AXIS NEEDS A HUMAN** — A8's server half (2026-09-02).
 *
 * A8 took `team` off `dopl_agent`'s enum, so the MCP surface refuses it in zod.
 * The REST route's schema still accepts it and an agent credential reaches that
 * route directly, so the rule held on one road only — the prompt-only shape this
 * wave exists to remove. See {@link IdentityTeamScopeAgentForbiddenError} for why
 * it refuses the CREDENTIAL rather than the value, and why `team` stays legal for
 * a human until B4 is ruled.
 *
 * ⚠ `ctx.source === "agent"` is the same discriminator `updateSkill` and
 * `createBase` use for their own human-only settings — the CREDENTIAL a call
 * arrived on, never a claim in the body.
 */
function assertTeamScopeIsHuman(
  ctx: AgentIdentityContext,
  landing: IdentityVisibility
): void {
  if (landing === "team" && ctx.source === "agent") {
    throw new IdentityTeamScopeAgentForbiddenError();
  }
}

async function assertGrantableTeams(
  ctx: AgentIdentityContext,
  requested: string[],
  alreadyLinked: string[]
): Promise<string[]> {
  const ids = [...new Set(requested)];
  if (ids.length === 0) return [];
  const inWorkspace = new Set(
    await repo.filterTeamIdsInWorkspace(ctx.workspaceId, ids)
  );
  const foreign = ids.filter((id) => !inWorkspace.has(id));
  if (foreign.length > 0) {
    throw new IdentityTeamNotGrantableError(
      `Not a team in this workspace: ${foreign.join(", ")}`
    );
  }
  if (isWorkspaceAdmin(ctx)) return ids;
  const myTeams = await repo.listTeamIdsForUser(ctx.workspaceId, ctx.userId);
  const allowed = new Set([...myTeams, ...alreadyLinked]);
  if (ids.some((id) => !allowed.has(id))) {
    throw new IdentityTeamNotGrantableError(
      "You can only share with teams you belong to"
    );
  }
  return ids;
}

