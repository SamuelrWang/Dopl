import "server-only";
import { HttpError } from "@/shared/lib/http-error";
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
 *   - Plans are WORKSPACE-level: "free" | "solo" | "team".
 *   - Team is per-seat ($7.99/seat); entitled while status is
 *     active/past_due. Seats sync to the active member count.
 *   - Solo is flat ($5.99, single-member only); entitled ONLY while
 *     status is active/past_due AND memberCount === 1. If a second member
 *     ever appears (race/bug), solo loses its entitlement and the
 *     workspace degrades to free multi-member rules until fixed — this
 *     backstop lives here so no abuse path bypasses the object cap.
 *   - Free workspaces get full features. Two capacity rules apply, and
 *     ONLY to multi-member free workspaces (1-member free = uncapped,
 *     Notion-style):
 *       * ontology object cap of FREE_MULTI_MEMBER_OBJECT_CAP,
 *       * chats visible window of FREE_CHATS_WINDOW_DAYS.
 *   - Freeze-don't-delete: over the cap, creates are blocked but reads /
 *     edits / exports always work. `canCreateObjects` encodes only the
 *     create gate.
 *   - past_due is treated as paid-with-warning: an entitled workspace
 *     keeps its entitlements (uncapped, canCreateObjects stays true) while
 *     `status` surfaces "past_due" for the UI. canceled reverts to free.
 */

export type WorkspacePlan = "free" | "solo" | "team";

/** Solo is a single-member plan; adding a member is blocked at this count. */
const SOLO_MAX_MEMBERS = 1;

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
 * Resolve the EFFECTIVE paid plan for entitlement purposes, or null when
 * the workspace falls back to free rules. A plan grants entitlements only
 * while the subscription is live (active) or in the grace window
 * (past_due); a canceled sub reverts to free (the row may keep its
 * historical plan but loses entitlements). Solo additionally requires a
 * single-member workspace — a solo row with a second member (race/bug)
 * degrades to free so the multi-member object cap still applies.
 */
function paidEntitlement(
  plan: WorkspacePlan,
  status: WorkspaceEntitlements["status"],
  memberCount: number
): "solo" | "team" | null {
  const live = status === "active" || status === "past_due";
  if (!live) return null;
  if (plan === "team") return "team";
  if (plan === "solo" && memberCount <= SOLO_MAX_MEMBERS) return "solo";
  return null;
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
  const paid = paidEntitlement(rawPlan, status, memberCount);
  const entitled = paid !== null;
  const plan: WorkspacePlan = paid ?? "free";

  // Free multi-member workspaces are capped; 1-member free + any entitled
  // paid plan are uncapped. A degraded solo (2+ members) counts as free
  // here, so the multi-member cap applies to it too.
  const objectCap =
    entitled || memberCount < 2 ? null : FREE_MULTI_MEMBER_OBJECT_CAP;
  const canCreateObjects = objectCap === null || objectsUsed < objectCap;
  const chatsWindowDays = entitled ? null : FREE_CHATS_WINDOW_DAYS;

  return {
    plan,
    status,
    memberCount,
    // Seats are a per-seat (team) concept; solo is flat, so it has none.
    seatCount: paid === "team" ? billing?.seatCount ?? null : null,
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
 * Create-time gate for adding a member (invitation accept, join-link).
 * A live Solo workspace is single-member by contract, so adding a member
 * is refused with a 402 pointing at the upgrade path. Free and Team
 * workspaces are unaffected (no-op). Resolves billing + the active member
 * count; the throw is gated on a live Solo subscription that is already at
 * (or above) the single-member limit.
 */
export async function assertCanAddMember(workspaceId: string): Promise<void> {
  const [billing, memberCount] = await Promise.all([
    getWorkspaceBilling(workspaceId),
    countActiveMembers(workspaceId),
  ]);
  const soloLive =
    billing?.plan === "solo" &&
    (billing.status === "active" || billing.status === "past_due");
  if (soloLive && memberCount >= SOLO_MAX_MEMBERS) {
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://www.usedopl.com";
    throw new HttpError(
      402,
      "SOLO_MEMBER_LIMIT",
      "This workspace is on the Solo plan, which is limited to one member. Upgrade to Team to add members.",
      { upgrade_url: `${appUrl}/pricing` }
    );
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
      `deleted — everything stays readable and editable. Upgrade to Team to add more.`,
    upgrade_url: `${appUrl}/pricing`,
  };
}
