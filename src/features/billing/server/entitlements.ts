import "server-only";
import {
  countActiveMembers,
  countOntologyObjects,
  getWorkspaceBilling,
} from "./workspace-billing";

/**
 * THE entitlements contract other agents (enforcement, chats window, UI)
 * build against. Given a workspace, resolve everything a gate needs:
 * plan, billing status, seat/member counts, the ontology object cap +
 * usage, and the chats visibility window.
 *
 * Model (decided):
 *   - Plans are WORKSPACE-level: "free" | "pro". Pro is per-seat.
 *   - Free workspaces get full features. Two capacity rules apply, and
 *     ONLY to multi-member free workspaces (solo free = uncapped,
 *     Notion-style):
 *       * ontology object cap of FREE_MULTI_MEMBER_OBJECT_CAP,
 *       * chats visible window of FREE_CHATS_WINDOW_DAYS.
 *   - Freeze-don't-delete: over the cap, creates are blocked but reads /
 *     edits / exports always work. `canCreateObjects` encodes only the
 *     create gate.
 *   - past_due is treated as pro-with-warning: the workspace keeps pro
 *     entitlements (uncapped, canCreateObjects stays true) while `status`
 *     surfaces "past_due" for the UI. canceled reverts to free rules.
 */

export type WorkspacePlan = "free" | "pro";

export interface WorkspaceEntitlements {
  plan: WorkspacePlan;
  status: "free" | "active" | "past_due" | "canceled";
  memberCount: number;
  seatCount: number | null;
  /** null = uncapped. */
  objectCap: number | null;
  objectsUsed: number;
  canCreateObjects: boolean;
  /** null = full history. */
  chatsWindowDays: number | null;
}

export const FREE_MULTI_MEMBER_OBJECT_CAP = 1000;
export const FREE_CHATS_WINDOW_DAYS = 90;

/**
 * A plan is "pro" for entitlement purposes only while the subscription is
 * live (active) or in the grace window (past_due). A canceled pro sub
 * falls back to free rules — the row keeps plan='pro' historically but
 * loses pro entitlements.
 */
function isProEntitled(
  plan: WorkspacePlan,
  status: WorkspaceEntitlements["status"]
): boolean {
  return plan === "pro" && (status === "active" || status === "past_due");
}

export async function getWorkspaceEntitlements(
  workspaceId: string
): Promise<WorkspaceEntitlements> {
  const [billing, memberCount, objectsUsed] = await Promise.all([
    getWorkspaceBilling(workspaceId),
    countActiveMembers(workspaceId),
    countOntologyObjects(workspaceId),
  ]);

  const rawPlan: WorkspacePlan = billing?.plan ?? "free";
  const status: WorkspaceEntitlements["status"] = billing?.status ?? "free";
  const pro = isProEntitled(rawPlan, status);
  const plan: WorkspacePlan = pro ? "pro" : "free";

  // Free multi-member workspaces are capped; solo free + pro are uncapped.
  const objectCap =
    pro || memberCount < 2 ? null : FREE_MULTI_MEMBER_OBJECT_CAP;
  const canCreateObjects = objectCap === null || objectsUsed < objectCap;
  const chatsWindowDays = pro ? null : FREE_CHATS_WINDOW_DAYS;

  return {
    plan,
    status,
    memberCount,
    seatCount: pro ? billing?.seatCount ?? null : null,
    objectCap,
    objectsUsed,
    canCreateObjects,
    chatsWindowDays,
  };
}

/**
 * Thrown by `assertCanCreateObject` when a workspace is over its free
 * object cap. Mirror of the old billing `AccessDecision` denial, reshaped
 * for the workspace model. Carries the workspace id so the route handler
 * can build the friendly denial body.
 */
export class EntitlementError extends Error {
  readonly code = "over_free_cap" as const;
  readonly workspaceId: string;

  constructor(workspaceId: string, message?: string) {
    super(message ?? "Workspace is over its free object cap");
    this.name = "EntitlementError";
    this.workspaceId = workspaceId;
  }
}

/**
 * Create-time gate for ontology objects (the freeze-don't-delete rule).
 * Throws `EntitlementError` when the workspace is over its free cap;
 * returns silently otherwise. Reads / edits / exports never call this.
 */
export async function assertCanCreateObject(
  workspaceId: string
): Promise<void> {
  const entitlements = await getWorkspaceEntitlements(workspaceId);
  if (!entitlements.canCreateObjects) {
    throw new EntitlementError(workspaceId);
  }
}

/**
 * Structured JSON body returned by a route when `assertCanCreateObject`
 * denies a create. Mirrors the old `accessDeniedBody` shape/pattern so
 * clients get a single, predictable "upgrade to continue" envelope.
 * Emphasizes that nothing is deleted — the workspace is frozen, not wiped.
 *
 * `upgrade_url` always points at `/pricing` — the real pricing page. The
 * per-workspace `/{slug}/settings/billing` route does not exist (404).
 */
export function entitlementDeniedBody() {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || "https://www.usedopl.com";
  return {
    error: "over_free_cap" as const,
    message:
      `This workspace has reached the free plan limit of ` +
      `${FREE_MULTI_MEMBER_OBJECT_CAP.toLocaleString()} objects. Nothing has been ` +
      `deleted — everything stays readable and editable. Upgrade to Pro to add more.`,
    upgrade_url: `${appUrl}/pricing`,
  };
}
