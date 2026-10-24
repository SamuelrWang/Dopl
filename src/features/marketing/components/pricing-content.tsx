"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import {
  FREE_CHATS_WINDOW_DAYS,
  FREE_MULTI_MEMBER_OBJECT_CAP,
  isPersonalPaidPlan,
  PERSONAL_PLAN_NAMES,
  PERSONAL_PLANS,
  WORKSPACE_PLANS,
  planNumber,
} from "@/features/billing/plans";
import {
  PERSONAL_MONTHLY_CREDITS,
  SEAT_MONTHLY_CREDITS,
} from "@/features/billing/credits";
import {
  formatMoney,
  MAX_PRICE,
  PRO_PRICE,
  TEAM_SEAT_PRICE,
} from "@/features/billing/prices";
import { billingPath } from "@/features/billing/url";
import { WEB_POST_AUTH_LANDING } from "@/shared/lib/url/post-auth-landing";
import { isStandardWorkspace } from "@/features/workspaces/types";
import type { WorkspaceKind } from "@/features/workspaces/types";
import type { User } from "@supabase/supabase-js";
import { PlanGroup, type CompareRow } from "./pricing-plan-group";
import { PERSONAL_SUMMARY, WORKSPACE_SUMMARY } from "./pricing-summaries";

/** Only what this page reads off `GET /api/workspaces`. */
type WorkspaceWireRow = { id: string; kind?: WorkspaceKind };

/**
 * Body of /pricing (its only render site — no page chrome of its own).
 * ⚠ Subscribing hands off to the in-app Plans & Billing pane so checkout always
 * carries an explicit workspace id.
 *
 * 🔒 **TWO GROUPS SINCE 2026-09-08 (spec §11), BECAUSE THERE ARE TWO PRODUCTS.**
 * Personal (Free / Pro / Max — one person's home space, flat; Max 2026-10-22)
 * and Workspaces
 * (Starter / Team — seats). They are separate sections with separate compare
 * tables and they are NEVER concatenated: `pro` is refused checkout on a
 * standard workspace and `team` on a home space (400
 * `PLAN_NOT_FOR_CONTAINER`), so one four-column list would offer two purchases
 * that answer 400.
 *
 * ⚠ **TWO TABLES RATHER THAN ONE FIVE-PLAN TABLE, AND THE REASON IS MOBILE.**
 * `.lp-compare-table` carries `min-width: 560px` inside its own
 * `overflow-x: auto` scroller, so a 4-cell row (label + three plans) still
 * fits it and the PAGE never scrolls sideways. A six-cell row would put the
 * reader on a horizontal drag to reach the last price — on a page whose entire
 * job is comparing prices. Two tables also match the grouping the cards above
 * them already state.
 */

/* ------------------------------ the groups ------------------------------ */

/**
 * ⚠ EVERY FIGURE INTERPOLATED, NEVER TYPED (2026-08-30, G4). These rows restated
 * the credit allowance and the free caps in prose, in a THIRD place beside
 * `plans.ts › WORKSPACE_PLANS`/`PERSONAL_PLANS` features and the in-app pane, and drift here is PUBLIC
 * PRICING MISREPRESENTATION that no test could see — a string is a string.
 * Interpolating deletes the duplicate rather than gating it.
 */
/** ⚠ Cells are in `PERSONAL_PLANS` order — Free, Pro, Max. */
const HOME_SPACE_ROWS: CompareRow[] = [
  {
    label: "Ontology objects",
    // ⚠ Uncapped on ALL: the object cap is a MULTI-member free rule
    // (`plans.ts › FREE_MULTI_MEMBER_OBJECT_CAP`) and a home space has
    // one member by construction, so no paid tier sells uncapping here.
    cells: [{ main: "Unlimited" }, { main: "Unlimited" }, { main: "Unlimited" }],
  },
  {
    label: "Chat history",
    cells: [{ main: `${FREE_CHATS_WINDOW_DAYS} days` }, { main: "Full" }, { main: "Full" }],
  },
  {
    // ⚠ SUB-LINE IS "per month", NOT "per member / month". A home space
    // has exactly one member, so "per member" would invite the reader to
    // multiply by a roster that cannot exist.
    label: "Credits",
    cells: [
      { main: planNumber(PERSONAL_MONTHLY_CREDITS.free), sub: "per month" },
      { main: planNumber(PERSONAL_MONTHLY_CREDITS.pro), sub: "per month" },
      { main: planNumber(PERSONAL_MONTHLY_CREDITS.max), sub: "per month" },
    ],
  },
  {
    // The REAL prices. The launch strike lives on the cards, where its end
    // date is enforced (`prices.ts › launchOfferFor`); the table states what
    // is charged.
    label: "Price",
    cells: [
      { main: "Free" },
      { main: formatMoney(PRO_PRICE), sub: "/ month" },
      { main: formatMoney(MAX_PRICE), sub: "/ month" },
    ],
  },
];

const WORKSPACE_ROWS: CompareRow[] = [
  {
    label: "Ontology objects",
    cells: [
      {
        main: "Unlimited",
        sub: `${planNumber(FREE_MULTI_MEMBER_OBJECT_CAP)} with 2+ members`,
      },
      { main: "Unlimited" },
    ],
  },
  {
    label: "Chat history",
    cells: [{ main: `${FREE_CHATS_WINDOW_DAYS} days` }, { main: "Full" }],
  },
  {
    // ⚠ UNLIMITED ON BOTH, AND THAT IS THE RULING, NOT AN OVERSIGHT (Samuel:
    // "unlimited users in the workspace … each user gets a limited number of
    // credits"). Members are free; the ALLOWANCE is what the tier buys.
    label: "Members",
    cells: [{ main: "Unlimited" }, { main: "Unlimited" }],
  },
  {
    // ⚠ THE SUB-LINE IS "per member": the allocation is fixed per person and NOT
    // pooled (`credits.ts › SEAT_MONTHLY_CREDITS`), so a bare figure beside
    // "Unlimited" members would read as a workspace pool.
    label: "Credits",
    cells: [
      { main: planNumber(SEAT_MONTHLY_CREDITS.free), sub: "per member / month" },
      { main: planNumber(SEAT_MONTHLY_CREDITS.team), sub: "per member / month" },
    ],
  },
  {
    label: "Price",
    cells: [{ main: "Free" }, { main: formatMoney(TEAM_SEAT_PRICE), sub: "/ seat / month" }],
  },
];

/** Sign-in hop that returns to `to`. ⚠ Param is `redirectTo`, never `redirect` —
 *  nothing reads the latter and the round-trip fails silently (ENGINEERING §9.2,
 *  `shared/lib/url/post-auth-landing.ts`). */
const loginThen = (to: string) => `/login?redirectTo=${encodeURIComponent(to)}`;

/* -------------------------------- the page ------------------------------- */

export function PricingContent() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    supabase.auth.getUser().then(({ data }: { data: { user: User | null } }) => {
      setUser(data.user);
      setAuthChecked(true);
    });
  }, []);

  // `/api/billing/status` fails closed without workspace context, so resolve
  // membership first (withUserAuth — never 400s). Exactly 1 workspace → read
  // status; 2+ → skip it (public page can't pick one) and hand off in-app.
  const workspacesQuery = useApiQuery<{ workspaces: WorkspaceWireRow[] }>(
    "/api/workspaces",
    { enabled: user !== null }
  );
  // ⚠ The route is unfiltered; hidden home-channel containers must not make a
  // single-workspace user look multi-workspace and skip the status read.
  const workspaces = workspacesQuery.data?.workspaces.filter(isStandardWorkspace);
  const soleWorkspaceId =
    workspaces && workspaces.length === 1 ? workspaces[0].id : undefined;
  const multiWorkspace = (workspaces?.length ?? 0) >= 2;

  // ⚠ **THE STATUS READ IS THE WORKSPACES GROUP'S, AND ONLY ITS** (2026-09-08).
  // It is scoped to a STANDARD workspace the visitor solely owns, so it can say
  // whether Team is live; it says nothing about their HOME space, whose
  // id this public page never holds. So the Personal group never badges a
  // current plan — `/billing?plan=pro` resolves that container and shows the
  // payer their real state, which is where a purchase happens anyway.
  const statusQuery = useApiQuery<{ status?: string; plan?: string }>(
    "/api/billing/status",
    {
      enabled: soleWorkspaceId !== undefined,
      workspaceId: soleWorkspaceId,
    }
  );
  // past_due is still paid — a subscribe CTA there starts a duplicate checkout.
  // So active + past_due both count as subscribed; past_due → manage billing.
  const status = statusQuery.data?.status;
  const currentPlan = statusQuery.data?.plan;
  const isPaid = status === "active" || status === "past_due";
  const isPastDue = status === "past_due";

  function requireUser(then: () => void) {
    if (!user) {
      router.push(loginThen("/pricing"));
      return;
    }
    then();
  }

  function handleSubscribe() {
    // ⚠ Never check out in place: this public page can't pick a workspace, so
    // a multi-workspace user would be billed on the wrong one silently. Hand
    // off to /billing, where the target workspace is explicit. `/billing` (no
    // segment) resolves the caller's default (`features/billing/url.ts`).
    requireUser(() =>
      router.push(billingPath({ intent: multiWorkspace ? "return" : "upgrade" }))
    );
  }

  /**
   * ⚠ **SEGMENT-LESS, WITH `plan=pro|max` — THAT PAIR IS THE PERSONAL FORWARD.**
   * `/billing?billing=upgrade&plan=…` is the one link that resolves the
   * caller's own `kind='home'` container (`src/app/billing/page.tsx`); a
   * public page holds no segment for it, and every user has exactly one, so
   * there is nothing to disambiguate. A caller already paying for the other
   * tier lands on their plan cards, where the switch happens in place.
   */
  function handleGoPersonal(planId: string) {
    if (!isPersonalPaidPlan(planId)) return;
    requireUser(() =>
      router.push(billingPath({ intent: "upgrade", plan: planId }))
    );
  }

  // past_due warning + Stripe portal live on /billing — no duplicate here.
  function handleManageBilling() {
    router.push(
      user
        ? billingPath({ intent: "return" })
        : loginThen("/pricing")
    );
  }

  function handleGetStarted() {
    router.push(user ? WEB_POST_AUTH_LANDING : loginThen(WEB_POST_AUTH_LANDING));
  }

  return (
    <section className="lp-pricing">
      <div className="lp-pricing-head">
        <h1 className="lp-pricing-title">Pricing</h1>
        <p className="lp-pricing-sub">
          Download the app to get started for free.
        </p>
        <p className="lp-pricing-sub">
          No credit card required. No commitments, cancel anytime.
        </p>
      </div>

      <PlanGroup
        title="Personal"
        plans={PERSONAL_PLANS}
        summary={PERSONAL_SUMMARY}
        rows={HOME_SPACE_ROWS}
        subscribeLabel={(planId) =>
          `Go ${isPersonalPaidPlan(planId) ? PERSONAL_PLAN_NAMES[planId] : ""}`.trim()
        }
        onSubscribe={handleGoPersonal}
        authChecked={authChecked}
        onGetStarted={handleGetStarted}
      />

      <PlanGroup
        title="Teams"
        plans={WORKSPACE_PLANS}
        summary={WORKSPACE_SUMMARY}
        rows={WORKSPACE_ROWS}
        subscribeLabel={() => "Bring your team"}
        onSubscribe={handleSubscribe}
        authChecked={authChecked}
        onGetStarted={handleGetStarted}
        currentPlan={currentPlan}
        isPaid={isPaid}
        isPastDue={isPastDue}
        onManageBilling={handleManageBilling}
      />
    </section>
  );
}
