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
 * THE entitlements contract every gate (enforcement, chats window, UI) builds
 * against. A plan belongs to a CONTAINER, and which plans a container may be
 * sold depends on its kind — Starter/Team on a standard workspace, Free/Pro on
 * a `kind='personal'` one (`../plans.ts › plansForKind`). ⚠ **`solo` IS LEGACY,
 * NOT A TIER ON EITHER LIST**: it is retired from sale (no card, no checkout)
 * and every rule below still applies to the rows that are on it.
 *
 * ⚠ **NOTHING IN THIS FILE CHANGED IN THAT WAVE, DELIBERATELY.** The credit
 * model moved to per-seat and personal wallets (`../credits.ts`), and this
 * module's verdict — `entitledPlanFor` / `paidEntitlement` — is what the seat
 * allowance is keyed by. Changing the verdict to match new prices would have
 * silently re-tiered every live workspace.
 *
 * 🔒 **AND IT GAINED EXACTLY ONE PLAN ON 2026-09-08 — `pro`, THE PERSONAL
 * TIER** (Samuel's $8.99 ruling; spec §11.1). ⚠ A CONTAINER IS NOT A SECOND
 * BILLING SYSTEM: a `kind='personal'` container is a real `workspaces` row with
 * its own `workspace_billing` row, so every rule below already applied to it
 * and only the verdict needed the new value. The prices moved (`../prices.ts`)
 * and the verdict for `team` / `solo` / `free` did not — same reason as the
 * line above.
 *   - team: entitled while active/past_due; seats sync to active members.
 *   - pro: entitled while active/past_due, with NO member condition (F-673).
 *     Personal containers only.
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

/** Solo is a single-member plan; adding a member is blocked at this count.
 *  ⚠ LEGACY ROWS ONLY — nothing sells solo since 2026-09-07. */
const SOLO_MAX_MEMBERS = 1;

/** A `kind='personal'` container holds its owner and nobody else
 *  (`20260920120000_workspace_kind_personal.sql`). ⚠ NOT A PLAN LIMIT you can
 *  buy your way past, unlike `SOLO_MAX_MEMBERS`: it is what the container IS. */
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
 * ⚠ DEFINED IN `../plans.ts`, RE-EXPORTED HERE (2026-08-30, G4). This module is
 * `server-only`, so nothing that RENDERS could import these two — and every
 * public surface that quotes them (`plans.ts › WORKSPACE_PLANS`,
 * `marketing/components/pricing-content.tsx › COMPARE_ROWS`) restated the
 * numbers as prose instead. They moved to the one module both sides can read.
 * The re-export is not compatibility shim: this file is the ENFORCEMENT site
 * and the place a reader looks for the rule, and every `vi.mock` of it in
 * `chats/server/` mocks these names.
 */
export {
  FREE_MULTI_MEMBER_OBJECT_CAP,
  FREE_CHATS_WINDOW_DAYS,
} from "../plans";

/**
 * EFFECTIVE paid plan, or null → free rules. Live = active | past_due; canceled
 * reverts to free (row keeps its historical plan but loses entitlements).
 * ⚠ Solo also requires memberCount <= 1 — a solo row that grew a second member
 * degrades, so the multi-member object cap still applies.
 *
 * 🔒 **`pro` CARRIES NO MEMBER CONDITION, AND THAT IS A DECISION, NOT AN
 * OMISSION (2026-09-08, F-673).** The obvious move was to copy the solo arm —
 * both are single-member flat plans — and it would have been wrong in a way
 * that only shows up in production. Solo's `memberCount <= 1` is a BACKSTOP
 * against a state the schema permits: a standard workspace can be given a
 * second member while a solo subscription is live, and the degrade is what
 * stops that buying the object cap. A `kind='personal'` container CANNOT be
 * given one — it has exactly one member by construction
 * (`20260920120000_workspace_kind_personal.sql`) and `assertCanAddMember`
 * refuses below — so the same clause would guard nothing while creating a real
 * failure mode: one stale/duplicated membership row and a PAYING customer
 * silently drops to the free allowance with no refund and no signal.
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

/**
 * The whole contract for one container, read fresh (three round trips).
 *
 * ⚠ **A `kind='personal'` CONTAINER ANSWERS THROUGH THE SAME ARITHMETIC AND
 * THAT IS THE POINT (2026-09-08, spec §11.1).** It needed no personal branch:
 * the container has ONE member, so `objectCap` falls out `null` on the
 * 1-member-free rule; `seatCount` is `null` because that key is Team-only;
 * `chatsWindowDays` is `null` on a live `pro` verdict and `FREE_CHATS_WINDOW_DAYS`
 * otherwise, exactly as §11.1 specifies. A `kind === "personal"` branch here
 * would be a SECOND copy of those three rules that agrees today and drifts on
 * the next edit — the reason this function takes an id and not a kind.
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
 * ⚠ The URL every 402/403 plan-gate envelope points at: `/billing`
 * (`src/app/billing/[segment]/page.tsx`, via its segment-less forwarder). NOT
 * `/canvas?billing=upgrade` (RETIRES with the `[workspaceSlug]` tree) and NOT
 * `/pricing` (marketing, sells nothing) — decision D1/D6,
 * docs/migration-research/website-retirement-plan.md. API-first clients (MCP
 * agents) follow this link literally. Built by `../url` so the six billing
 * entry points cannot drift apart.
 *
 * Workspace-agnostic on purpose: these builders are reached with only an id,
 * no SEGMENT, and `/billing` resolves or asks for one on arrival.
 *
 * ⚠ **`plan` NAMES WHAT THE CALLER IS BEING SOLD, AND ONLY `"pro"` IS SAYABLE
 * (2026-09-08).** With it the link carries `?plan=pro` and the segment-less
 * `/billing` forwards to the caller's PERSONAL container rather than resolving
 * a standard workspace — which is the only way a home-space upsell can land
 * anywhere useful, since the seller never holds that segment. Team needs no
 * argument: it is what the plain upgrade link already means, and adding
 * `?plan=team` to it would change six live envelopes for no behaviour.
 *
 * ⚠ TYPED AS THE LITERAL `"pro"`, NOT AS `CheckoutPlan`. `url.ts` owns that
 * union and widened it in the same wave; depending on the widening here would
 * make this file's correctness a question about MERGE ORDER. The literal is
 * assignable to `CheckoutPlan` either way, and narrower is the safe direction.
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
 * Single-member denial. Subclasses `HttpError` so route catch blocks route it
 * as a 402, but ⚠ overrides `toResponseBody` to emit the FLAT plan-gate
 * envelope `{ error: <code>, message, upgrade_url }` instead of the nested
 * default — the web consumers and `apiRequest` parse the flat shape.
 *
 * ⚠ **THE CODE IS A PARAMETER SINCE 2026-09-08 BECAUSE THE TWO REFUSALS ARE
 * NOT THE SAME REFUSAL.** `SOLO_MEMBER_LIMIT` means "this workspace's plan is
 * too small — buy Team", and the invite/join surfaces key on that string to
 * offer the in-place upgrade (`members/components/invite-dialog.tsx`,
 * `members-v2-view.tsx`, `hooks/use-join-requests.ts`). A personal container's
 * refusal is not a price problem and has no upgrade that fixes it, so reusing
 * the code would have shown a Team checkout to somebody whose answer is "make
 * a workspace". Same STATUS and same SHAPE, different code and different
 * sentence.
 */
class MemberLimitError extends HttpError {
  readonly upgradeUrl: string;

  constructor(code: string, message: string, upgradeUrl: string) {
    super(402, code, message, { upgrade_url: upgradeUrl });
    this.name = "MemberLimitError";
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
 * Create-time gate for adding a member (invitation accept, join-link). Two
 * containers are single-member and both answer 402 in the flat plan-gate
 * envelope (`MemberLimitError`); free and Team workspaces are no-ops.
 *
 *   * a live legacy SOLO workspace → `SOLO_MEMBER_LIMIT`, with the Team
 *     checkout attached: buying Team is the fix.
 *   * a live PRO personal container → `PERSONAL_SINGLE_MEMBER`, with NO
 *     upgrade url. ⚠ **THERE IS NOTHING TO BUY AND THE EMPTY STRING SAYS SO**
 *     — the same posture `credits-service.ts › upgradeUrlFor` takes. A personal
 *     container holds one person by construction; no plan changes that, so a
 *     checkout link here would be an upsell that does not solve the problem the
 *     caller just hit.
 *
 * ⚠ **THE `pro` ARM IS A BELT ON TOP OF BRACES AND IT STAYS.** The membership
 * writes that reach this gate are already fenced from containers upstream
 * (`workspaces/server/link-container-guard.test.ts`), so it should be
 * unreachable — which is exactly why it must not be the only thing standing
 * between a paying single-member tier and a second seat it never sold.
 * ⚠ It keys on the RAW plan + live status, not on `entitledPlanFor`, because
 * the verdict is what we are protecting: asking the verdict whether to enforce
 * the rule that keeps the verdict true is the circle F-673 warns about.
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
