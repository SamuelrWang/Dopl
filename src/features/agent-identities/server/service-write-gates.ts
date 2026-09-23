import "server-only";
import { personalShelfRefusal } from "@/shared/tenancy/personal-container";
import { resolvePersonalReach } from "@/shared/tenancy/personal-reach";
// Imported, never mirrored: `scripts/check-role-drift.ts › checkWorkspaceKind` counts the copies.
import { findWorkspaceById } from "@/features/workspaces/server/repository";
import { isStandardWorkspace } from "@/features/workspaces/types";
import type { AgentIdentityContext, IdentityVisibility } from "../types";
import { IdentityTeamNotGrantableError } from "./errors";

/**
 * Where an identity create lands — the twin of `knowledge/server/service-base-gates.ts ›
 * resolveCreateDestination`, not a call into it: that one decides from the KNOWLEDGE audience, and
 * an identity has no read ceiling to re-route around (its creator can always read it back).
 * A `homeScoped` request asks the personal-reach fence and refuses rather than downgrades, with the
 * shared {@link personalShelfRefusal} sentences.
 */
interface IdentityCreateDestination {
  /** Passed to `insertIdentity`, whose router resolves the same personal container by owner. */
  homeScoped: boolean;
  /** Where the row, its junctions and the response re-read land; `ctx.workspaceId` unless personal. */
  workspaceId: string;
}

export async function resolveIdentityCreateDestination(
  ctx: AgentIdentityContext,
  input: { homeScoped?: boolean; visibility: IdentityVisibility }
): Promise<IdentityCreateDestination> {
  if (input.homeScoped !== true) {
    return { homeScoped: false, workspaceId: ctx.workspaceId };
  }

  // A team grant belongs to the calling workspace and cannot follow a row out of it: refuse.
  if (input.visibility === "team") {
    throw new IdentityTeamNotGrantableError(
      "A personal identity cannot be shared with a team. It lives in your own " +
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
 * A team scope needs a standard workspace (Samuel's ruling) — the server fence on create and
 * update; the editor's hidden pill is only the courtesy. A missing workspace row passes: auth already
 * proved membership, so the write below fails on its own.
 */
export async function assertTeamScopeGrantable(workspaceId: string): Promise<void> {
  const workspace = await findWorkspaceById(workspaceId);
  if (workspace === null || isStandardWorkspace(workspace)) return;
  throw new IdentityTeamNotGrantableError(
    "This identity lives outside a workspace, and a team grant belongs to the " +
      "workspace the team is in. Create it in the workspace and share it there, " +
      "or keep it here and lend it with a grant."
  );
}
