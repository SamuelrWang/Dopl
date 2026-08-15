import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import type { PlanId, BillingStatus } from "../plans";
import { billingUrl } from "../url";
import {
  countActiveMembers,
  countOntologyObjects,
  getWorkspaceBilling,
  type WorkspaceBillingRow,
} from "./workspace-billing";

/**
 * THE entitlements contract every gate (enforcement, chats window, UI) builds
 * against. Plans are WORKSPACE-level.
 *   - team: entitled while active/past_due; seats sync to active members.
 *   - solo: entitled ONLY while active/past_due AND memberCount === 1. ⚠ A
 *     second member degrades it to free multi-member rules — the backstop lives
 *     HERE so no abuse path bypasses the object cap.
 *   - free: full features; capacity rules apply ONLY to MULTI-member free
 *     (1-member free = uncapped) — FREE_MULTI_MEMBER_OBJECT_CAP,
 *     FREE_CHATS_WINDOW_DAYS.
 *   - ⚠ Freeze-don't-delete: over cap blocks CREATES only (`canCreateObjects`);
 *     reads/edits/exports always work.
 *   - past_due keeps entitlements and surfaces in `status`; canceled → free.
 */

/** Alias of canonical `PlanId` — contract's public name for the union. */
export type WorkspacePlan = PlanId;

/** Solo is a single-member plan; adding a member is blocked at this count. */
const SOLO_MAX_MEMBERS = 1;

export interface WorkspaceEntitlements {
  plan: WorkspacePlan;
  status: BillingStatus;
  memberCount: number;
  seatCount: number | null;
  /** null = uncapped. */
  objectCap: number | null;
  objectsUsed: number;
  canCreateObjects: boolean;
  /** null = full history. */
  chatsWindowDays: number | null;
}

export const FREE_MULTI_MEMBER_OBJECT_CAP = 100;
export const FREE_CHATS_WINDOW_DAYS = 90;

/**
 * EFFECTIVE paid plan, or null → free rules. Live = active | past_due; canceled
 * reverts to free (row keeps its historical plan but loses entitlements).
 * ⚠ Solo also requires memberCount <= 1 — a solo row that grew a second member
 * degrades, so the multi-member object cap still applies.
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

/**
 * Plan verdict alone, from data the caller already holds — same
 * `paidEntitlement` definition as `getWorkspaceEntitlements`, not a copy. For
 * the per-MCP-tool-call credit path, which needs only the plan.
 *
 * ⚠ Pure on purpose: the caller reads `workspace_billing` ONCE and feeds the
 * row to both this and the credit-period rule, so they cannot disagree.
 */
export function entitledPlanFor(
  billing: Pick<WorkspaceBillingRow, "plan" | "status"> | null,
  memberCount: number
): WorkspacePlan {
  return (
    paidEntitlement(
      billing?.plan ?? "free",
      billing?.status ?? "free",
      memberCount
    ) ?? "free"
  );
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

  // Free multi-member capped; 1-member free + entitled paid uncapped. Degraded
  // solo (2+ members) counts as free here, so the cap applies to it too.
  const objectCap =
    entitled || memberCount < 2 ? null : FREE_MULTI_MEMBER_OBJECT_CAP;
  const canCreateObjects = objectCap === null || objectsUsed < objectCap;
  const chatsWindowDays = entitled ? null : FREE_CHATS_WINDOW_DAYS;

  return {
    plan,
    status,
    memberCount,
    seatCount: paid === "team" ? billing?.seatCount ?? null : null,
    objectCap,
    objectsUsed,
    canCreateObjects,
    chatsWindowDays,
  };
}

/**
 * Thrown by `assertCanCreateObject` when a workspace is over its free object
 * cap. Carries the workspace id so the route handler can build the denial body.
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
 * ⚠ The URL every 402/403 plan-gate envelope points at: `/billing`
 * (`src/app/billing/[segment]/page.tsx`, via its segment-less forwarder). NOT
 * `/canvas?billing=upgrade` (RETIRES with the `[workspaceSlug]` tree) and NOT
 * `/pricing` (marketing, sells nothing) — decision D1/D6,
 * docs/migration-research/website-retirement-plan.md. API-first clients (MCP
 * agents) follow this link literally. Built by `../url` so the six billing
 * entry points cannot drift apart.
 *
 * Workspace-agnostic on purpose: these builders are reached with only an id,
 * no SEGMENT, and `/billing` resolves the caller's DEFAULT workspace.
 */
export function upgradeUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.usedopl.com";
  return billingUrl(appUrl, { intent: "upgrade" });
}

export async function assertCanCreateObject(
  workspaceId: string
): Promise<void> {
  const entitlements = await getWorkspaceEntitlements(workspaceId);
  if (!entitlements.canCreateObjects) {
    throw new EntitlementError(workspaceId);
  }
}

/**
 * Solo member-limit denial. Subclasses `HttpError` so route catch blocks route
 * it as a 402, but ⚠ overrides `toResponseBody` to emit the FLAT plan-gate
 * envelope `{ error: <code>, message, upgrade_url }` instead of the nested
 * default — the web consumers and `apiRequest` parse the flat shape.
 */
class SoloMemberLimitError extends HttpError {
  readonly upgradeUrl: string;

  constructor(upgradeUrl: string) {
    super(
      402,
      "SOLO_MEMBER_LIMIT",
      "This workspace is on the Solo plan, which is limited to one member. Upgrade to Team to add members.",
      { upgrade_url: upgradeUrl }
    );
    this.name = "SoloMemberLimitError";
    this.upgradeUrl = upgradeUrl;
  }

  // Base signature types `error` as an object; this gate uses a string code
  // with a sibling `upgrade_url`, hence the cast — callers pass straight to
  // `NextResponse.json` and never read it back through the typed shape.
  toResponseBody() {
    return {
      error: this.code,
      message: this.message,
      upgrade_url: this.upgradeUrl,
    } as unknown as ReturnType<HttpError["toResponseBody"]>;
  }
}

/**
 * Create-time gate for adding a member (invitation accept, join-link). A live
 * Solo workspace is single-member by contract → 402 (flat plan-gate envelope,
 * see `SoloMemberLimitError`). Free and Team are no-ops.
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
    throw new SoloMemberLimitError(upgradeUrl());
  }
}

/**
 * JSON body a route returns when `assertCanCreateObject` denies a create — one
 * predictable "upgrade to continue" envelope. Says nothing is deleted: the
 * workspace is frozen, not wiped.
 */
export function entitlementDeniedBody() {
  return {
    error: "over_free_cap" as const,
    message:
      `This workspace has reached the free plan limit of ` +
      `${FREE_MULTI_MEMBER_OBJECT_CAP.toLocaleString()} objects. Nothing has been ` +
      `deleted — everything stays readable and editable. Upgrade to Team to add more.`,
    upgrade_url: upgradeUrl(),
  };
}
