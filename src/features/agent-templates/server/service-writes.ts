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
import { findDefaultWorkspaceForUser } from "@/features/workspaces/server/repository";
import {
  TemplateHomeScopeForbiddenError,
  TemplateKnowledgeBaseNotFoundError,
  TemplateTeamNotGrantableError,
  TemplateWriteForbiddenError,
  WorkspaceKeyPrivateTemplateError,
} from "./errors";
import * as repo from "./repository";
import { getTemplateById } from "./service-reads";
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
 * 🔒 THE HOME-SHELF FENCE FOR TEMPLATES — the sibling of
 * `features/knowledge/server/service-base-writes.ts › resolveHomeScope`
 * (Samuel's ruling 2026-08-27;
 * `20260901120000_agent_template_home_scoped.sql` carries the full argument).
 *
 * Three conditions, ALL required:
 *
 *   1. **A PERSON asked.** `isSharedCredential` false. A credential that may be
 *      shared between humans has no "my home shelf" to write to — and
 *      `canSeeTemplate` arm 2 would not read the row back for it anyway.
 *   2. **PRIVATE.** ⚠ CHECKED AGAINST THE RESOLVED VALUE, NOT `input.visibility`
 *      — the branch above rewrites it, and reading the raw input would let a
 *      `team` or `workspace` template onto a shelf the UI calls "yours alone".
 *      **This is where the fence DIFFERS from Knowledge's in substance, not just
 *      in wording**: a KB can be `private` and still reach a channel through a
 *      `(kb, channel)` grant, so there `private` is a floor. A template has NO
 *      grant table and exactly one consumer per row, so `private` is TERMINAL —
 *      it is the entire audience statement, which is precisely what makes it the
 *      right condition for a personal shelf.
 *   3. **THE CALLER'S OWN DEFAULT STANDARD WORKSPACE.**
 *      `findDefaultWorkspaceForUser` is the same lookup `getBootState` runs to
 *      answer `POST /api/boot`'s `workspace`, which is what the /home pane
 *      hands its editor — so the fence and the surface cannot disagree about
 *      what "home" means. A link CONTAINER fails this, and so does a second
 *      workspace the caller owns.
 *
 * ⚠ THE DEFAULT IS FALSE AND SILENT. Only an explicit `homeScoped: true` is
 * examined, so MCP and every other existing caller keep writing workspace-shelf
 * rows with no new failure mode.
 */
async function resolveTemplateHomeScope(
  ctx: AgentTemplateContext,
  input: AgentTemplateCreateInput,
  resolvedVisibility: TemplateVisibility
): Promise<boolean> {
  if (input.homeScoped !== true) return false;
  if (isSharedCredential(ctx)) {
    throw new TemplateHomeScopeForbiddenError(
      "a shared credential has no personal shelf"
    );
  }
  if (resolvedVisibility !== "private") {
    throw new TemplateHomeScopeForbiddenError(
      "the home shelf holds private agents only"
    );
  }
  const home = await findDefaultWorkspaceForUser(ctx.userId);
  if (home === null || home.id !== ctx.workspaceId) {
    throw new TemplateHomeScopeForbiddenError("it is not your home workspace");
  }
  return true;
}

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

  // ⚠ VALIDATE BEFORE INSERTING. Both checks can reject, and a template that
  // exists with the wrong sharing (or with attachments silently dropped) is
  // worse than one that was never created — there is no transaction across
  // these three statements, so the order IS the atomicity story.
  const teamIds =
    visibility === "team"
      ? await assertGrantableTeams(ctx, input.teamIds ?? [], [])
      : [];
  const knowledgeBaseIds = await assertAttachableKnowledgeBases(
    ctx,
    input.knowledgeBaseIds ?? []
  );

  // 🔒 WHICH SHELF, resolved before the insert so no half-written row depends
  // on it. Throws rather than returning false.
  const homeScoped = await resolveTemplateHomeScope(ctx, input, visibility);

  const template = await repo.insertTemplate({
    workspaceId: ctx.workspaceId,
    name: stripNullBytes(input.name),
    description: normalizeProse(input.description),
    instructions: normalizeProse(input.instructions),
    model: normalizeLabel(input.model),
    fields: normalizeFieldsInput(input.fields),
    visibility,
    homeScoped,
    createdBy: ctx.userId,
  });

  if (teamIds.length > 0) {
    await repo.replaceTeamLinks(ctx.workspaceId, template.id, teamIds, ctx.userId);
  }
  if (knowledgeBaseIds.length > 0) {
    await repo.replaceKnowledgeLinks(
      ctx.workspaceId,
      template.id,
      knowledgeBaseIds,
      ctx.userId
    );
  }
  // Re-read through the gated path so the response is the same shape a GET
  // returns — including the viewer-filtered attachment list.
  return getTemplateById(ctx, template.id);
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

  // VISIBILITY TRANSITIONS ARE FREE FOR THE OWNER, in any direction —
  // `private → workspace → team → private`. Nothing here guards narrowing (the
  // skills service makes the same note), because narrowing removes reach and
  // the person removing it is the person who granted it.
  let teamIds: string[] | null = null;
  if (patch.visibility !== undefined || patch.teamIds !== undefined) {
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
