import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import type { KbTeamConflict } from "../types";

export class TeamNotFoundError extends HttpError {
  constructor() {
    super(404, "TEAM_NOT_FOUND", "Team not found");
  }
}

/**
 * Thrown when a change would break the workflow↔KB invariant: every team
 * (or everyone, for workspace-mode workflows) that can read a workflow
 * must be able to read every KB attached to it.
 *
 * 409 body: { error: { code: "TEAM_KB_ACCESS_CONFLICT", message,
 *   details: { workflowId, workflowName, conflicts, autoGrantResolvable } } }
 *
 * `autoGrantResolvable` is true when retrying the same request with
 * `autoGrant: true` (admin only) would create the missing read grants.
 */
export class TeamKbAccessConflictError extends HttpError {
  constructor(args: {
    workflowId: string;
    workflowName: string;
    conflicts: KbTeamConflict[];
    autoGrantResolvable: boolean;
  }) {
    super(
      409,
      "TEAM_KB_ACCESS_CONFLICT",
      args.autoGrantResolvable
        ? "Some teams with access to this workflow can't read its knowledge bases"
        : "This change would leave workflow readers without access to attached knowledge bases",
      args
    );
  }
}
