import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import {
  FREE_CHATS_WINDOW_DAYS,
  FREE_MULTI_MEMBER_OBJECT_CAP,
  type PlanId,
  type BillingStatus,
} from "../plans";
import { billingUrl } from "../url";
import {
  countActiveMembers,
  countOntologyObjects,
  getWorkspaceBilling,
  type WorkspaceBillingRow,
} from "./workspace-billing";

/**
 * The entitlements contract every gate (enforcement, chats window, UI) builds
 * against. A plan belongs to a CONTAINER, and which plans a container may be
 * sold depends on its kind — Starter/Team on a standard workspace, Free/Pro on
 * a `kind='home'` one (`../plans.ts › plansForKind`). `solo` is legacy:
 * retired from sale, and every rule below still applies to rows on it.
 *   - team: entitled while active/past_due; seats sync to active members.
 *   - pro: entitled while active/past_due, with NO member condition (F-673).
 *     Home spaces only.
 *   - solo: entitled only while active/past_due AND memberCount === 1; a second
 *     member degrades it to free multi-member rules, which is the backstop that
 *     keeps the object cap unbypassable.
 *   - free: full features; capacity rules apply only to MULTI-member free
 *     (1-member free = uncapped) — FREE_MULTI_MEMBER_OBJECT_CAP,
 *     FREE_CHATS_WINDOW_DAYS.
 *   - freeze-don't-delete: over cap blocks CREATES only (`canCreateObjects`);
 *     reads/edits/exports always work.
 *   - past_due keeps entitlements and surfaces in `status`; canceled → free.
 *
 * The credit model's move to per-seat and personal wallets (`../credits.ts`)
 * deliberately changed nothing here: this verdict is what the seat allowance is
 * keyed by, so re-tuning it to new prices would re-tier every live workspace.
 */

/** Alias of canonical `PlanId` — contract's public name for the union. */
export type WorkspacePlan = PlanId;

/** Solo is a single-member plan; adding a member is blocked at this count.
 *  Legacy rows only — nothing sells solo since 2026-09-07. */
const SOLO_MAX_MEMBERS = 1;

/** A `kind='home'` container holds its owner and nobody else
 *  (`20260920120000_workspace_kind_personal.sql`). Not a plan limit you can buy
 *  past, unlike `SOLO_MAX_MEMBERS`: it is what the container is. */
const PERSONAL_MAX_MEMBERS = 1;

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

/**
 * Defined in `../plans.ts`, re-exported here (2026-08-30, G4). This module is
 * `server-only`, so the rendering surfaces that quote them
 * (`plans.ts › WORKSPACE_PLANS`,
 * `marketing/components/pricing-content.tsx › COMPARE_ROWS`) read them from the
 * one module both sides can import. Not a shim: this file is the enforcement
 * site, and every `vi.mock` of it in `chats/server/` mocks these names.
 */
export {
  FREE_MULTI_MEMBER_OBJECT_CAP,
  FREE_CHATS_WINDOW_DAYS,
} from "../plans";

/**
 * EFFECTIVE paid plan, or null → free rules. Live = active | past_due; canceled
 * reverts to free (row keeps its historical plan but loses entitlements).
 * Solo also requires memberCount <= 1 — a solo row that grew a second member
 * degrades, so the multi-member object cap still applies.
 *
 * `pro` carries no member condition, and that is a decision (2026-09-08,
 * F-673). Solo's `memberCount <= 1` is a backstop against a second member the
 * schema permits; a `kind='home'` container has exactly one member by
 * construction (`20260920120000_workspace_kind_personal.sql`), so the same
 * clause would guard nothing and would silently drop a paying customer to the
 * free allowance on one stale membership row.
 */
function paidEntitlement(
  plan: WorkspacePlan,
  status: WorkspaceEntitlements["status"],
  memberCount: number
): "solo" | "team" | "pro" | null {
  const live = status === "active" || status === "past_due";
  if (!live) return null;
  if (plan === "team") return "team";
  if (plan === "pro") return "pro";
  if (plan === "solo" && memberCount <= SOLO_MAX_MEMBERS) return "solo";
  return null;
}

/**
 * Plan verdict alone, from data the caller already holds — same
 * `paidEntitlement` definition as `getWorkspaceEntitlements`, not a copy. For
 * the per-MCP-tool-call credit path, which needs only the plan.
 *
 * Pure on purpose: the caller reads `workspace_billing` once and feeds the row
 * to both this and the credit-period rule, so they cannot disagree.
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

/**
 * The whole contract for one container, read fresh (three round trips).
 *
 * A `kind='home'` container needs no branch here (spec §11.1): it has one
 * member, so `objectCap` falls out `null` on the 1-member-free rule, `seatCount`
 * is `null` because that key is Team-only, and `chatsWindowDays` follows the
 * `pro` verdict. A `kind === "home"` branch would be a second copy of those
 * rules that agrees today and drifts on the next edit — which is why this
 * function takes an id and not a kind.
 */
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
 * The URL every 402/403 plan-gate envelope points at: `/billing`
 * (`src/app/billing/[segment]/page.tsx`, via its segment-less forwarder) — not
 * `/canvas?billing=upgrade` and not `/pricing` (decision D1/D6,
 * docs/migration-research/website-retirement-plan.md). API-first clients (MCP
 * agents) follow this link literally; `../url` builds it so the six billing
 * entry points cannot drift apart. Workspace-agnostic on purpose: callers hold
 * only an id, and `/billing` resolves or asks for a segment on arrival.
 *
 * `plan` names what the caller is being sold and only `"pro"` is sayable
 * (2026-09-08): with it the segment-less `/billing` forwards to the caller's
 * home space, the only place a home-space upsell can land. Typed as the
 * literal rather than `url.ts`'s `CheckoutPlan`, so this file's correctness is
 * not a question about merge order.
 */
export function upgradeUrl(plan?: "pro"): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.usedopl.com";
  return billingUrl(appUrl, { intent: "upgrade", plan });
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
 * Single-member denial. Subclasses `HttpError` so route catch blocks route it as
 * a 402, but overrides `toResponseBody` to emit the FLAT plan-gate envelope
 * `{ error: <code>, message, upgrade_url }` instead of the nested default — web
 * consumers and `apiRequest` parse the flat shape.
 *
 * The code is a parameter (2026-09-08) because the two refusals differ:
 * `SOLO_MEMBER_LIMIT` means "buy Team" and the invite/join surfaces key on that
 * string to offer the in-place upgrade; a home space's refusal has no
 * upgrade that fixes it. Same status and shape, different code and sentence.
 */
class MemberLimitError extends HttpError {
  readonly upgradeUrl: string;

  constructor(code: string, message: string, upgradeUrl: string) {
    super(402, code, message, { upgrade_url: upgradeUrl });
    this.name = "MemberLimitError";
    this.upgradeUrl = upgradeUrl;
  }

  // Base signature types `error` as an object; this gate uses a string code with
  // a sibling `upgrade_url`, hence the cast.
  toResponseBody() {
    return {
      error: this.code,
      message: this.message,
      upgrade_url: this.upgradeUrl,
    } as unknown as ReturnType<HttpError["toResponseBody"]>;
  }
}

/**
 * Create-time gate for adding a member (invitation accept, join-link). Two
 * containers are single-member and both answer 402 in the flat plan-gate
 * envelope (`MemberLimitError`); free and Team workspaces are no-ops.
 *
 *   * a live legacy SOLO workspace → `SOLO_MEMBER_LIMIT`, with the Team
 *     checkout attached: buying Team is the fix.
 *   * a live PRO home space → `PERSONAL_SINGLE_MEMBER`, with NO
 *     upgrade url: there is nothing to buy and the empty string says so, the
 *     same posture `credits-service.ts › upgradeUrlFor` takes.
 *
 * The `pro` arm is a belt on top of braces and it stays: membership writes are
 * already fenced from containers upstream
 * (`workspaces/server/link-container-guard.test.ts`), which is why it must not
 * be the only thing between a paying single-member tier and a seat it never
 * sold. It keys on the RAW plan + live status, not on `entitledPlanFor` — asking
 * the verdict whether to enforce the rule that keeps the verdict true is the
 * circle F-673 warns about.
 */
export async function assertCanAddMember(workspaceId: string): Promise<void> {
  const [billing, memberCount] = await Promise.all([
    getWorkspaceBilling(workspaceId),
    countActiveMembers(workspaceId),
  ]);
  const live =
    billing?.status === "active" || billing?.status === "past_due";
  if (!live) return;
  if (billing?.plan === "solo" && memberCount >= SOLO_MAX_MEMBERS) {
    throw new MemberLimitError(
      "SOLO_MEMBER_LIMIT",
      "This workspace is on the Solo plan, which is limited to one member. Upgrade to Team to add members.",
      upgradeUrl()
    );
  }
  if (billing?.plan === "pro" && memberCount >= PERSONAL_MAX_MEMBERS) {
    throw new MemberLimitError(
      "PERSONAL_SINGLE_MEMBER",
      "This is a personal space. Create a workspace to add members.",
      ""
    );
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
