import "server-only";
import { personalShelfRefusal } from "@/shared/tenancy/personal-container";
import { resolvePersonalReach } from "@/shared/tenancy/personal-reach";
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
