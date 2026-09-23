import "server-only";
import { personalShelfRefusal } from "@/shared/tenancy/personal-container";
import { resolvePersonalReach } from "@/shared/tenancy/personal-reach";
// ⚠ **IMPORTED, NEVER MIRRORED.** `isStandardWorkspace` is the ONE positive-form
// kind predicate and `scripts/check-role-drift.ts › checkWorkspaceKind` counts
// its copies; a fourth would fail that gate, which is exactly what the gate is
// for. `findWorkspaceById` is the same read `workspaces/server/shared-publish.ts`
// makes for G16 — this feature already reaches that module, on the same lane.
import { findWorkspaceById } from "@/features/workspaces/server/repository";
import { isStandardWorkspace } from "@/features/workspaces/types";
import type { AgentTemplateContext, TemplateVisibility } from "../types";
import { TemplateTeamNotGrantableError } from "./errors";

/**
 * 🔒 **WHERE A TEMPLATE CREATE LANDS — THE TWIN OF `knowledge/server/
 * service-base-gates.ts › resolveCreateDestination`, AND DELIBERATELY NOT A COPY
 * OF IT.** Gap 2 of #1077, task 11's last owed seam.
 *
 * ── ⚠ WHY THE KNOWLEDGE FUNCTION IS NOT REUSED, WHICH IS THE FIRST QUESTION ──
 *
 * It cannot be, and the reason is worth stating so nobody "fixes" it into an
 * import:
 *
 *   1. **IT TAKES A `KnowledgeContext` AND ASKS `resolveAgentAudience`**, which
 *      is the KNOWLEDGE ceiling — it reads `resource_grants` rows for
 *      KNOWLEDGE BASES on this container's channels and answers which BASE IDS
 *      an agent may reach. Asking it where a TEMPLATE should land would decide a
 *      template's container from the grant state of somebody's knowledge bases.
 *   2. **§1 FORBIDS THE CROSS-FEATURE IMPORT.** `canSeeBase` is mirrored into
 *      this feature rather than imported for exactly this reason, and
 *      `TemplateShelf` is mirrored from `KbShelf` beside it.
 *
 * ⚠ **AND THE THIRD ARM HAS NO TWIN AT ALL, WHICH IS A FACT ABOUT TEMPLATES
 * RATHER THAN AN OMISSION.** `resolveCreateDestination` re-routes a create whose
 * audience is RESTRICTED, because F-323's authoring half is real for knowledge:
 * an agent in a shared container could write a base its own next call could not
 * read. **A template has no such ceiling.** `canSeeTemplate`'s arm 3 answers for
 * the CREATOR — and since F-333 a container session IS the operator, so it
 * answers for the operator's agent too — which means a template created in a
 * shared room is readable back by its creator on the very next call. There is
 * nothing to rescue, so there is nothing to re-route, and inventing a re-route
 * here would move rows on a path that works today. The one thing the knowledge
 * seam has that this file was MISSING is the arm below.
 *
 * ── 🔒 WHAT WAS ACTUALLY OPEN ────────────────────────────────────────────────
 *
 * `createTemplate` passed `input.homeScoped` STRAIGHT to `insertTemplate`, and
 * `personal-container.ts › personalWriteWorkspaceId` routes on it by author. So
 * an AGENT standing in a shared room could put a row on its operator's personal
 * shelf by naming the flag — while `personal-reach.ts` says that same agent may
 * not so much as ENUMERATE that shelf until the owner arms the room. A fence
 * that closes the read and leaves the write open is the half-open authz this
 * slice exists to close, and A4 (artifacts) would have inherited the shape.
 *
 * ⚠ **REFUSE, NEVER DOWNGRADE** — `personal-container.ts`'s rule, and the
 * refusal sentences are ITS ({@link personalShelfRefusal}), shared with the
 * router and the knowledge gate so three doors cannot disagree about the remedy.
 */
export interface TemplateCreateDestination {
  /** ⚠ THE ROUTING FLAG, PASSED STRAIGHT TO THE REPOSITORY — `insertTemplate`
   *  resolves the container from it through `personalWriteWorkspaceId`, by the
   *  same owner this gate asked the fence about, so the two cannot disagree. */
  homeScoped: boolean;
  /** WHERE the row lands: the container the JUNCTIONS and the response re-read
   *  must also name. Equal to `ctx.workspaceId` unless the row is personal. */
  workspaceId: string;
}

export async function resolveTemplateCreateDestination(
  ctx: AgentTemplateContext,
  input: { homeScoped?: boolean; visibility: TemplateVisibility }
): Promise<TemplateCreateDestination> {
  if (input.homeScoped !== true) {
    return { homeScoped: false, workspaceId: ctx.workspaceId };
  }

  // ⚠ **A `team` ROW NAMES THE CALLING CONTAINER, SO IT IS NEVER RE-ROUTED** —
  // the same rule `resolveCreateDestination` applies to `shareToChannelId` and
  // to a teams create, for the same reason: the teams are the ROOM's, their
  // grant rows are filed under the ROOM's `workspace_id`, and a grant cannot
  // follow a row out of the container it was written in.
  //
  // ⚠ IT IS A REFUSAL RATHER THAN A SILENT LANDING BECAUSE THAT COMBINATION WAS
  // ALREADY INCOHERENT: the row went to the container while
  // `replaceTeamLinks(ctx.workspaceId, …)` wrote its grants to the room, so
  // `listTeamLinksForTemplates` — which filters by the row's own container —
  // read none of them back and the template was `team`-visible to nobody.
  // ⚠ `TemplateTeamNotGrantableError` (`RESOURCE_ACCESS_DENIED`) rather than a
  // new class: this IS the "that team is not grantable here" answer, said about
  // the destination instead of about the team id.
  if (input.visibility === "team") {
    throw new TemplateTeamNotGrantableError(
      "A personal agent cannot be shared with a team. It lives in your own " +
        "personal container and a team grant belongs to the workspace the team " +
        "is in. Create it in the workspace and share it there, or keep it " +
        "personal and lend it with a grant."
    );
  }

  const reach = await resolvePersonalReach(ctx);
  if (reach.kind === "closed") throw personalShelfRefusal(reach.refusal);
  return { homeScoped: true, workspaceId: reach.containerId };
}

/**
 * 🔒 **A TEAM SCOPE NEEDS A CONTAINER THAT HAS TEAMS — SAMUEL'S RULING,
 * 2026-09-08.** Verbatim: *"we should remove the team option, if it's in the
 * home space, because the team thing is for workspaces."* That sentence is a UI
 * instruction and **a sentence telling an operator they are barred earns a
 * guardrail in the code** — so this is the fence and the pill is the courtesy.
 *
 * 🔒 **WHAT WAS OPEN, AND IT WAS OPEN IN TWO PLACES.**
 * {@link resolveTemplateCreateDestination} above refuses `team` on a PERSONAL
 * create, and that was the whole of the rule. It left:
 *   1. **A CREATE DIRECTLY INTO A LINK CONTAINER.** `homeScoped` is absent
 *      there, so the arm above never runs; `assertGrantableTeams` returns `[]`
 *      for an EMPTY set without asking anything, so `visibility: 'team'` with no
 *      `teamIds` was written to a room that has no teams — a row visible to
 *      nobody, filed under an audience that cannot exist.
 *   2. **EVERY UPDATE.** A fence with no update twin is a fence defeated in two
 *      calls (F-289's argument, which this file's sibling already makes about
 *      `assertTeamScopeIsHuman`): create it `private` on the personal shelf,
 *      then PATCH it to `team`.
 * A non-empty `teamIds` did fail in both cases — `filterTeamIdsInWorkspace`
 * finds no team — but it failed as *"Not a team in this workspace: &lt;uuid&gt;"*,
 * which names the id when the answer is about the ROOM.
 *
 * ⚠ **POSITIVE FORM, AND IT IS THE SHARED PREDICATE.** `isStandardWorkspace`
 * reads absent `kind` as standard (the column defaults that way, and a narrowed
 * projection must keep behaving as it does today) and refuses to spell itself
 * `!== "link"` — a kind nobody has designed yet must not inherit the ability to
 * hand out team grants.
 *
 * ⚠ **A MISSING WORKSPACE ROW PASSES**, for the reason
 * `shared-publish.ts › assertSharedPublishAcknowledged` states about its own:
 * `withWorkspaceAuth` proved an active membership before this ran, so `null`
 * means the row vanished mid-request and the write underneath is about to fail
 * on its own. This gate must not be the thing that reports that.
 *
 * ⚠ **ONE READ, AND ONLY ON THE TEAM LANE.** Callers ask only when the row is
 * LANDING at `team`, so every private/public write pays nothing.
 */
export async function assertTeamScopeGrantable(workspaceId: string): Promise<void> {
  const workspace = await findWorkspaceById(workspaceId);
  if (workspace === null || isStandardWorkspace(workspace)) return;
  throw new TemplateTeamNotGrantableError(
    "This agent lives outside a workspace, and a team grant belongs to the " +
      "workspace the team is in. Create it in the workspace and share it there, " +
      "or keep it here and lend it with a grant."
  );
}
