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
 *
 * The `workflowId`/`workflowName` payload fields keep their names (the
 * invariant really is the workflow->KB one and the client reads those
 * keys), but the MESSAGES stay generic: workflows are retired from the UI
 * and this 409 renders in front of users who have no such page.
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
        ? "Some teams with access to this resource can't read its knowledge bases"
        : "This change would leave the resource's readers without access to attached knowledge bases",
      args
    );
  }
}
