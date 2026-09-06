import "server-only";
import { isSharedCredential } from "@/shared/auth/credential-audience";
import type {
  AgentTemplate,
  AgentTemplateContext,
  TemplateField,
  TemplateVisibility,
} from "../types";
import type {
  AgentTemplateCreateInput,
  AgentTemplateUpdateInput,
} from "../schema";
// 🔒 G16 — the ONE statement of the publish-into-a-peer's-room precondition,
// shared with `knowledge/server/service-base-writes.ts`. Two copies of a
// tenancy predicate is how the shelf fence ended up divergent (findings §6 #3).
import { assertSharedPublishAcknowledged } from "@/features/workspaces/server/shared-publish";
import {
  TemplateTeamScopeAgentForbiddenError,
  TemplateKnowledgeBaseNotFoundError,
  TemplateTeamNotGrantableError,
  TemplateWriteForbiddenError,
  WorkspaceKeyPrivateTemplateError,
} from "./errors";
import * as repo from "./repository";
import { getTemplateById, readTemplateById } from "./service-reads";
// 🔒 THE ASKING SEAM, SPLIT OUT LIKE ITS KNOWLEDGE TWIN (`knowledge/server/
// service-base-gates.ts`). Read that module's header for why it is NOT the same
// function, and for what was open before it existed.
import { resolveTemplateCreateDestination } from "./service-write-gates";
import {
  isWorkspaceAdmin,
  resolveVisibleKnowledgeBases,
  stripNullBytes,
} from "./service-shared";

/**
 * Agent-template writes — create / update (metadata, sharing, attachments) /
 * hard delete.
 *
 * ⚠ THE WRITE GATE IS CREATOR-OR-WORKSPACE-ADMIN, FOR EVERY FIELD. There is no
 * per-template "editable by the team it is shared with" level, deliberately: a
 * template is an IDENTITY someone authored, and team `visibility` shares the
 * ability to USE it, not to rewrite what it says. This is why the team linkage
 * here carries no `level` column (see the migration header).
 */

// ─── Create ─────────────────────────────────────────────────────────────

/**
 * ⚠ **THE HOME-SHELF FENCE STOOD HERE UNTIL 2026-09-02 (slice B15).**
 * `resolveTemplateHomeScope` was a hand-mirror of
 * `knowledge/server/service-base-gates.ts › resolveHomeScope`, and both are
 * DELETED with the `home_scoped` column they answered for. `shared/tenancy/
 * personal-container.ts › personalWriteWorkspaceId` is the one fence now, and
 * its docblock retires each of the three conditions by name — including the one
 * this copy's docblock argued was substantively different (a template's
 * `private` is TERMINAL where a KB's is a floor), which stopped mattering when
 * the shelf became a container with one member.
 */

export async function createTemplate(
  ctx: AgentTemplateContext,
  input: AgentTemplateCreateInput
): Promise<AgentTemplate> {
  // Visibility default depends on the caller, the same rules as `createSkill` /
  // `createBase`: a SHARED credential defaults to `workspace` and may never own
  // a private row (it can be shared between humans, so "private to the
  // credential" means nothing); everyone else defaults to `private`.
  // ⚠ `isSharedCredential`, moved with `canSeeTemplate` on 2026-08-27 (F-333):
  // a container SESSION owns private rows exactly as its operator does, and
  // defaulting it to `workspace` would publish the operator's agent into the
  // room the peer is standing in.
  const fromWorkspaceKey = isSharedCredential(ctx);
  let visibility: TemplateVisibility;
  if (fromWorkspaceKey) {
    if (input.visibility === "private") throw new WorkspaceKeyPrivateTemplateError();
    visibility = input.visibility ?? "workspace";
  } else {
    visibility = input.visibility ?? "private";
  }

  // 🔒 **WHERE THE ROW LANDS, DECIDED BEFORE ANYTHING IS WRITTEN OR READ** —
  // gap 2 of #1077's template half, and the fence `personal-reach.ts` was
  // missing on this side. Until this call, `input.homeScoped` went straight to
  // the repository, so an agent in an UNARMED shared room could write onto its
  // operator's personal shelf by naming a flag — a shelf the same fence forbids
  // it to even enumerate. See `service-write-gates.ts` for why this is a twin
  // rather than a call into the knowledge gate.
  // ⚠ FIRST, and it takes the RESOLVED visibility: `team` names the calling
  // container and must never be re-routed, and `input.visibility` is not the
  // landing value for a caller that named nothing.
  const destination = await resolveTemplateCreateDestination(ctx, {
    homeScoped: input.homeScoped,
    visibility,
  });

  // ⚠ VALIDATE BEFORE INSERTING. Both checks can reject, and a template that
  // exists with the wrong sharing (or with attachments silently dropped) is
  // worse than one that was never created — there is no transaction across
  // these three statements, so the order IS the atomicity story.
  assertTeamScopeIsHuman(ctx, visibility);
  const teamIds =
    visibility === "team"
      ? await assertGrantableTeams(ctx, input.teamIds ?? [], [])
      : [];
  const knowledgeBaseIds = await assertAttachableKnowledgeBases(
    ctx,
    input.knowledgeBaseIds ?? []
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

  const template = await repo.insertTemplate({
    // 🔒 THE DESTINATION, and the flag beside it cannot disagree with it: both
    // resolve the personal container by OWNER through `findPersonalContainerId`
    // — the gate via the fence, the router via `personalWriteWorkspaceId`.
    workspaceId: destination.workspaceId,
    name: stripNullBytes(input.name),
    description: normalizeProse(input.description),
    instructions: normalizeProse(input.instructions),
    model: normalizeLabel(input.model),
    fields: normalizeFieldsInput(input.fields),
    visibility,
    // 🔒 A ROUTING FLAG, NOT A COLUMN (B15) — see `insertTemplate`.
    homeScoped: destination.homeScoped,
    createdBy: ctx.userId,
  });

  // 🔒 **BOTH JUNCTIONS FOLLOW THE ROW, NOT THE CALL.** `resource_grants` and
  // `agent_template_knowledge_bases` each carry a `workspace_id` and each READ
  // filters on it (`listTeamLinksForTemplates`,
  // `listKnowledgeLinksForTemplates`), so a link filed under the ROOM for a row
  // that lives in the CONTAINER is a link nothing ever reads back — the
  // template would come back with an empty attachment list and no team.
  // ⚠ `teamIds` is empty by construction on a personal create (the gate refuses
  // `team` there), so this line is the workspace path unchanged; it names the
  // destination anyway, because the pair must not be able to drift.
  if (teamIds.length > 0) {
    await repo.replaceTeamLinks(
      destination.workspaceId,
      template.id,
      teamIds,
      ctx.userId
    );
  }
  if (knowledgeBaseIds.length > 0) {
    await repo.replaceKnowledgeLinks(
      destination.workspaceId,
      template.id,
      knowledgeBaseIds,
      ctx.userId
    );
  }
  // Re-read through the gated path so the response is the same shape a GET
  // returns — including the viewer-filtered attachment list.
  //
  // ⚠ **THE ID-RESOLVING READ, AND ONLY WHEN THE ROW LEFT THE CALLING
  // CONTAINER.** `getTemplateById` is keyed to `ctx.workspaceId` and is the
  // WRITE GATE, which is why create/update/delete funnel through it — but this
  // call is not a gate, it is the response shaper for a row THIS CALLER JUST
  // WROTE, and keyed to the room it answered 404 for a create that had just
  // succeeded onto the personal shelf. `readTemplateById` is the sanctioned
  // follow (A12): strictly narrower than `canSeeTemplate`, re-based context and
  // role handled by `shared/tenancy/read-resource.ts`, same 404 and never a 403.
  // ⚠ The workspace path is byte-identical — `destination.workspaceId` equals
  // `ctx.workspaceId` for every non-personal create, and the resolving read
  // costs its two extra reads ONLY on a miss in this tenancy.
  return destination.workspaceId === ctx.workspaceId
    ? getTemplateById(ctx, template.id)
    : readTemplateById(ctx, template.id);
}

// ─── Update ─────────────────────────────────────────────────────────────

export async function updateTemplate(
  ctx: AgentTemplateContext,
  id: string,
  patch: AgentTemplateUpdateInput
): Promise<AgentTemplate> {
  // ⚠ 404 for an invisible template happens HERE, before the write gate, so a
  // 403 can only ever be returned for a row the caller already knew about.
  const existing = await getTemplateById(ctx, id);
  assertMayWrite(ctx, existing, "edit");

  const nextVisibility = patch.visibility ?? existing.visibility;

  // ⚠ **THE SAME FENCE `createTemplate` CARRIES, ON THE UPDATE PATH TOO** (F-289,
  // 2026-08-23). Without it the create guard was defeated in two calls: POST
  // `visibility: "workspace"` (accepted, `created_by` stamped with the key's
  // `ctx.userId`), then PATCH `visibility: "private"` — `getTemplateById` passes
  // because the row is still `workspace` at read time, `assertMayWrite` passes
  // because the key IS the creator, and the row commits `private`. The end state
  // is exactly the one the create fence exists to prevent: a private template
  // minted by a credential that "may be shared between humans", readable by the
  // key owner's human session, invisible to the key itself, and invisible to
  // every workspace admin (the admin arm of `canSeeTemplate` sits BELOW the
  // private arm). The final `getTemplateById` 404s the RESPONSE, which is a tell
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
    throw new WorkspaceKeyPrivateTemplateError();
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
    workspaceId: ctx.workspaceId,
    publishes: patch.visibility === "workspace",
    acknowledged: patch.acknowledgeShared,
    noun: "agent",
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
    teamIds =
      nextVisibility === "team"
        ? await assertGrantableTeams(
            ctx,
            patch.teamIds ?? existing.teamIds,
            existing.teamIds
          )
        : [];
  }

  const knowledgeBaseIds =
    patch.knowledgeBaseIds === undefined
      ? null
      : await assertAttachableKnowledgeBases(ctx, patch.knowledgeBaseIds);

  // ⚠ A JUNCTION-ONLY PATCH TOUCHES NO SCALAR COLUMN, so it must not reach the
  // row write at all (F-404, 2026-09-02). `knowledgeBaseIds`-only and
  // `teamIds`-only patches are both legal — `packages/mcp-server/src/tools/
  // agent-ops-write.ts › opUpdate` refuses only the patch that names NOTHING,
  // and `agent-templates/schema.ts › UpdateTemplateSchema` marks every field
  // optional — and both used to arrive at `updateTemplateRow` as an
  // all-`undefined` patch, i.e. an empty UPDATE body, which PostgREST rejects
  // and `http-mapping.ts` had no arm for: the agent got a bare INTERNAL_ERROR
  // 500 for a request that was entirely valid. The repo is now total on the
  // empty patch too, so this is the round trip we skip rather than the guard we
  // depend on. Mirrors `workspaces/server/service.ts › renameWorkspace`, which
  // has guarded this exact class all along.
  //
  // ⚠ TYPED AS THE REPOSITORY'S OWN PATCH, so the emptiness test and the column
  // set cannot drift: a seventh scalar column added to `UpdateTemplatePatch` and
  // forgotten here is a compile-time absence to notice, not a silent skip.
  const rowPatch: repo.UpdateTemplatePatch = {
    name: patch.name === undefined ? undefined : stripNullBytes(patch.name),
    description:
      patch.description === undefined ? undefined : normalizeProse(patch.description),
    instructions:
      patch.instructions === undefined
        ? undefined
        : normalizeProse(patch.instructions),
    model: patch.model === undefined ? undefined : normalizeLabel(patch.model),
    fields: patch.fields === undefined ? undefined : normalizeFieldsInput(patch.fields),
    visibility: patch.visibility,
  };
  if (Object.values(rowPatch).some((value) => value !== undefined)) {
    await repo.updateTemplateRow(ctx.workspaceId, id, rowPatch);
  }

  // ⚠ REPLACE-SET, and it runs even for the empty set: leaving a template's
  // team links behind when it goes `private` would leave rows that come back to
  // life the moment somebody re-shares it to a different set of teams.
  if (teamIds !== null) {
    await repo.replaceTeamLinks(ctx.workspaceId, id, teamIds, ctx.userId);
  }
  if (knowledgeBaseIds !== null) {
    await repo.replaceKnowledgeLinks(
      ctx.workspaceId,
      id,
      knowledgeBaseIds,
      ctx.userId
    );
  }
  return getTemplateById(ctx, id);
}

// ─── Delete ─────────────────────────────────────────────────────────────

/**
 * ⚠ PERMANENT — no trash, no restore (Samuel's standing ruling). Both
 * junctions go with the row via `ON DELETE CASCADE`; nothing here deletes them
 * by hand, because a hand-written cascade is a cascade that gets a new child
 * table and forgets it.
 */
export async function deleteTemplate(
  ctx: AgentTemplateContext,
  id: string
): Promise<void> {
  const existing = await getTemplateById(ctx, id);
  assertMayWrite(ctx, existing, "delete");
  await repo.hardDeleteTemplate(ctx.workspaceId, id);
}

// ─── Gates ──────────────────────────────────────────────────────────────

function assertMayWrite(
  ctx: AgentTemplateContext,
  template: AgentTemplate,
  action: string
): void {
  const isCreator =
    template.createdBy !== null && template.createdBy === ctx.userId;
  if (isCreator || isWorkspaceAdmin(ctx)) return;
  throw new TemplateWriteForbiddenError(action);
}

/**
 * Teams the caller may actually share to.
 *   * every id must be a team OF THIS WORKSPACE — checked here so the junction's
 *     workspace-guard trigger never has to surface as an opaque 500;
 *   * a workspace ADMIN may name any of them;
 *   * a non-admin owner may name only teams they BELONG TO, plus teams the
 *     template is ALREADY shared with (so editing a set an admin built does not
 *     silently revoke the parts the owner cannot re-add).
 * Both rules are lifted verbatim from `updateSkill`'s sharing branch.
 */
/**
 * 🔒 **THE TEAM AXIS NEEDS A HUMAN** — A8's server half (2026-09-02).
 *
 * A8 took `team` off `dopl_agent`'s enum, so the MCP surface refuses it in zod.
 * The REST route's schema still accepts it and an agent credential reaches that
 * route directly, so the rule held on one road only — the prompt-only shape this
 * wave exists to remove. See {@link TemplateTeamScopeAgentForbiddenError} for why
 * it refuses the CREDENTIAL rather than the value, and why `team` stays legal for
 * a human until B4 is ruled.
 *
 * ⚠ `ctx.source === "agent"` is the same discriminator `updateSkill` and
 * `createBase` use for their own human-only settings — the CREDENTIAL a call
 * arrived on, never a claim in the body.
 */
function assertTeamScopeIsHuman(
  ctx: AgentTemplateContext,
  landing: TemplateVisibility
): void {
  if (landing === "team" && ctx.source === "agent") {
    throw new TemplateTeamScopeAgentForbiddenError();
  }
}

async function assertGrantableTeams(
  ctx: AgentTemplateContext,
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
    throw new TemplateTeamNotGrantableError(
      `Not a team in this workspace: ${foreign.join(", ")}`
    );
  }
  if (isWorkspaceAdmin(ctx)) return ids;
  const myTeams = await repo.listTeamIdsForUser(ctx.workspaceId, ctx.userId);
  const allowed = new Set([...myTeams, ...alreadyLinked]);
  if (ids.some((id) => !allowed.has(id))) {
    throw new TemplateTeamNotGrantableError(
      "You can only share with teams you belong to"
    );
  }
  return ids;
}

/**
 * ⚠ NO ATTACHING A KNOWLEDGE BASE YOU CANNOT READ. Every requested id is
 * resolved through `resolveVisibleKnowledgeBases` — the same predicate the READ
 * path uses — and anything that does not come back is reported MISSING (a 404,
 * never a distinguishable 403: see `TemplateKnowledgeBaseNotFoundError`).
 *
 * Without this, a template is a laundering channel: attach a teammate's private
 * base by id, share the template to `workspace`, and every member's spawned
 * agent gets a pointer to it.
 */
async function assertAttachableKnowledgeBases(
  ctx: AgentTemplateContext,
  requested: string[]
): Promise<string[]> {
  const ids = [...new Set(requested)];
  if (ids.length === 0) return [];
  const visible = await resolveVisibleKnowledgeBases(ctx, ids);
  const seen = new Set(visible.map((kb) => kb.id));
  const missing = ids.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new TemplateKnowledgeBaseNotFoundError(missing);
  }
  return ids;
}

// ─── Normalizers ────────────────────────────────────────────────────────

/** Empty / whitespace-only prose becomes NULL — one "absent" spelling in the
 *  column, so a cleared textarea and an omitted field read the same. */
function normalizeProse(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = stripNullBytes(value).trim();
  return trimmed === "" ? null : trimmed;
}

/** Same for a short label. Separate function so the two can diverge if a label
 *  ever needs different treatment; today they agree. */
function normalizeLabel(value: string | null | undefined): string | null {
  return normalizeProse(value);
}

function normalizeFieldsInput(
  fields: TemplateField[] | undefined
): TemplateField[] {
  if (!fields) return [];
  return fields.map((f) => ({
    key: stripNullBytes(f.key),
    value: stripNullBytes(f.value),
  }));
}
