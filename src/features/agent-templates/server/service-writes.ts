import "server-only";
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
import {
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

export async function createTemplate(
  ctx: AgentTemplateContext,
  input: AgentTemplateCreateInput
): Promise<AgentTemplate> {
  // Visibility default depends on the caller, the same rules as `createSkill` /
  // `createBase`: a workspace-scoped key defaults to `workspace` and may never
  // own a private row (it can be shared between humans, so "private to the key"
  // means nothing); everyone else defaults to `private`.
  const fromWorkspaceKey = ctx.apiKeyWorkspaceId != null;
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

  const template = await repo.insertTemplate({
    workspaceId: ctx.workspaceId,
    name: stripNullBytes(input.name),
    description: normalizeProse(input.description),
    instructions: normalizeProse(input.instructions),
    model: normalizeLabel(input.model),
    fields: normalizeFieldsInput(input.fields),
    visibility,
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
  if (nextVisibility === "private" && ctx.apiKeyWorkspaceId != null) {
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

  await repo.updateTemplateRow(ctx.workspaceId, id, {
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
  });

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
