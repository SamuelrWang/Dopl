"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import {
  FREE_CHATS_WINDOW_DAYS,
  FREE_MULTI_MEMBER_OBJECT_CAP,
  PERSONAL_PLANS,
  WORKSPACE_PLANS,
  planNumber,
  type PlanDef,
} from "@/features/billing/plans";
import {
  PERSONAL_MONTHLY_CREDITS,
  SEAT_MONTHLY_CREDITS,
} from "@/features/billing/credits";
import {
  formatMoney,
  PRO_PRICE,
  TEAM_SEAT_PRICE,
} from "@/features/billing/prices";
import { billingPath } from "@/features/billing/url";
import { WEB_POST_AUTH_LANDING } from "@/shared/lib/url/post-auth-landing";
import { isStandardWorkspace } from "@/features/workspaces/types";
import type { WorkspaceKind } from "@/features/workspaces/types";
import type { User } from "@supabase/supabase-js";

/** Only what this page reads off `GET /api/workspaces`. */
type WorkspaceWireRow = { id: string; kind?: WorkspaceKind };

/**
 * Body of /pricing (its only render site — no page chrome of its own).
 * ⚠ Subscribing hands off to the in-app Plans & Billing pane so checkout always
 * carries an explicit workspace id.
 *
 * 🔒 **TWO GROUPS SINCE 2026-09-08 (spec §11), BECAUSE THERE ARE TWO PRODUCTS.**
 * Personal (Free / Pro — one person's home space, flat) and Workspaces
 * (Starter / Team — seats). They are separate sections with separate compare
 * tables and they are NEVER concatenated: `pro` is refused checkout on a
 * standard workspace and `team` on a home space (400
 * `PLAN_NOT_FOR_CONTAINER`), so one four-column list would offer two purchases
 * that answer 400.
 *
 * ⚠ **TWO TABLES RATHER THAN ONE FOUR-PLAN TABLE, AND THE REASON IS MOBILE.**
 * `.lp-compare-table` carries `min-width: 560px` inside its own
 * `overflow-x: auto` scroller, so a 3-cell row (label + two plans) scrolls
 * inside the card and the PAGE never scrolls sideways. A five-cell row needs
 * roughly 900px and would put the reader on a horizontal drag to reach the last
 * price — on a page whose entire job is comparing prices. Two tables also match
 * the grouping the cards above them already state.
 */

/* ------------------------------ the groups ------------------------------ */

type CompareCell = { main: string; sub?: string };
type CompareRow = { label: string; left: CompareCell; right: CompareCell };

/**
 * ⚠ EVERY FIGURE INTERPOLATED, NEVER TYPED (2026-08-30, G4). These rows restated
 * the credit allowance and the free caps in prose, in a THIRD place beside
 * `plans.ts › WORKSPACE_PLANS`/`PERSONAL_PLANS` features and the in-app pane, and drift here is PUBLIC
 * PRICING MISREPRESENTATION that no test could see — a string is a string.
 * Interpolating deletes the duplicate rather than gating it.
 */
const HOME_SPACE_ROWS: CompareRow[] = [
  {
    label: "Ontology objects",
    // ⚠ Uncapped on BOTH: the object cap is a MULTI-member free rule
    // (`plans.ts › FREE_MULTI_MEMBER_OBJECT_CAP`) and a home space has
    // one member by construction, so Pro sells no uncapping here.
    left: { main: "Unlimited" },
    right: { main: "Unlimited" },
  },
  {
    label: "Chat history",
    left: { main: `${FREE_CHATS_WINDOW_DAYS} days` },
    right: { main: "Full" },
  },
  {
    // ⚠ SUB-LINE IS "per month", NOT "per member / month". A home space
    // has exactly one member, so "per member" would invite the reader to
    // multiply by a roster that cannot exist.
    label: "Credits",
    left: { main: planNumber(PERSONAL_MONTHLY_CREDITS.free), sub: "per month" },
    right: { main: planNumber(PERSONAL_MONTHLY_CREDITS.pro), sub: "per month" },
  },
  {
    label: "Price",
    left: { main: "Free" },
    right: { main: formatMoney(PRO_PRICE), sub: "/ month" },
  },
];

const WORKSPACE_ROWS: CompareRow[] = [
  {
    label: "Ontology objects",
    left: {
      main: "Unlimited",
      sub: `${planNumber(FREE_MULTI_MEMBER_OBJECT_CAP)} with 2+ members`,
    },
    right: { main: "Unlimited" },
  },
  {
    label: "Chat history",
    left: { main: `${FREE_CHATS_WINDOW_DAYS} days` },
    right: { main: "Full" },
  },
  {
    // ⚠ UNLIMITED ON BOTH, AND THAT IS THE RULING, NOT AN OVERSIGHT (Samuel:
    // "unlimited users in the workspace … each user gets a limited number of
    // credits"). Members are free; the ALLOWANCE is what the tier buys.
    label: "Members",
    left: { main: "Unlimited" },
    right: { main: "Unlimited" },
  },
  {
    // ⚠ THE SUB-LINE IS "per member": the allocation is fixed per person and NOT
    // pooled (`credits.ts › SEAT_MONTHLY_CREDITS`), so a bare figure beside
    // "Unlimited" members would read as a workspace pool.
    label: "Credits",
    left: {
      main: planNumber(SEAT_MONTHLY_CREDITS.free),
      sub: "per member / month",
    },
    right: {
      main: planNumber(SEAT_MONTHLY_CREDITS.team),
      sub: "per member / month",
    },
  },
  {
    label: "Price",
    left: { main: "Free" },
    right: { main: formatMoney(TEAM_SEAT_PRICE), sub: "/ seat / month" },
  },
];

/** Card sub-line, keyed inside its group — both groups own an `id: "free"`
 *  card, so one flat map would make them collide. */
const PERSONAL_SUMMARY: Record<string, string> = {
  free: "Your own space, free forever.",
  pro: "More credits and your whole history, for one flat price.",
};
const WORKSPACE_SUMMARY: Record<string, string> = {
  free: "Everything, free forever — caps only start when a second member joins.",
  team: "Your whole team, uncapped — pay only per seat, synced automatically.",
};

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
      router.push(`/login?redirectTo=${encodeURIComponent("/pricing")}`);
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
   * ⚠ **SEGMENT-LESS, WITH `plan=pro` — THAT PAIR IS THE PERSONAL FORWARD.**
   * `/billing?billing=upgrade&plan=pro` is the one link that resolves the
   * caller's own `kind='home'` container (`src/app/billing/page.tsx`); a
   * public page holds no segment for it, and every user has exactly one, so
   * there is nothing to disambiguate.
   */
  function handleGoPro() {
    requireUser(() =>
      router.push(billingPath({ intent: "upgrade", plan: "pro" }))
    );
  }

  // past_due warning + Stripe portal live on /billing — no duplicate here.
  function handleManageBilling() {
    router.push(
      user
        ? billingPath({ intent: "return" })
        : `/login?redirectTo=${encodeURIComponent("/pricing")}`
    );
  }

  // ⚠ Param is `redirectTo`, never `redirect` — nothing reads the latter and
  // the round-trip fails silently (ENGINEERING §9.2,
  // `shared/lib/url/post-auth-landing.ts`).
  function handleGetStarted() {
    if (user) {
      router.push(WEB_POST_AUTH_LANDING);
    } else {
      router.push(`/login?redirectTo=${encodeURIComponent(WEB_POST_AUTH_LANDING)}`);
    }
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
        subscribeLabel="Go Pro"
        onSubscribe={handleGoPro}
        authChecked={authChecked}
        onGetStarted={handleGetStarted}
      />

      <PlanGroup
        title="Workspaces"
        plans={WORKSPACE_PLANS}
        summary={WORKSPACE_SUMMARY}
        rows={WORKSPACE_ROWS}
        subscribeLabel="Bring your team"
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

interface GroupProps {
  title: string;
  plans: ReadonlyArray<PlanDef>;
  summary: Record<string, string>;
  rows: CompareRow[];
  /** CTA on this group's PAID card. */
  subscribeLabel: string;
  onSubscribe: () => void;
  authChecked: boolean;
  onGetStarted: () => void;
  /** Live-subscription reflection — WORKSPACES ONLY (see the status read). */
  currentPlan?: string;
  isPaid?: boolean;
  isPastDue?: boolean;
  onManageBilling?: () => void;
}

/** One product: its cards and its own comparison table. */
function PlanGroup(props: GroupProps) {
  const [freePlan, paidPlan] = props.plans;
  return (
    <div className="lp-plan-group">
      <h2 className="lp-plan-group-title">{props.title}</h2>
      <div className="lp-plans">
        {props.plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} {...props} />
        ))}
      </div>
      <ComparisonTable
        rows={props.rows}
        left={freePlan?.name ?? ""}
        right={paidPlan?.name ?? ""}
      />
    </div>
  );
}

function PlanCard({ plan, ...group }: GroupProps & { plan: PlanDef }) {
  const popular = plan.id !== "free";

  return (
    <div className={`lp-plan${popular ? " lp-plan--popular" : ""}`}>
      <div className="lp-plan-top">
        {popular && <span className="lp-plan-badge">Popular</span>}
      </div>

      <h3 className="lp-plan-name">{plan.name}</h3>
      <div className="lp-plan-price">
        <span className="lp-plan-price-figure">{plan.priceMonthly}</span>
        {plan.priceNote && (
          <span className="lp-plan-price-note">{plan.priceNote}</span>
        )}
      </div>
      <p className="lp-plan-summary">{group.summary[plan.id]}</p>

      <PlanCardCta plan={plan} {...group} />

      <ul className="lp-plan-features">
        {plan.features.map((f) => (
          <li key={f}>
            <span className="lp-plan-check">
              <CheckIcon />
            </span>
            {f}
          </li>
        ))}
      </ul>

      {/* ⚠ TEAM ONLY, AND IT IS ABOUT SEATS. Pro is flat and quantity-1, so
          "only pay for your team" describes nothing on that card. */}
      {plan.id === "team" && (
        <p className="lp-plan-guarantee">
          <strong>Only pay for your team</strong>
          {formatMoney(TEAM_SEAT_PRICE)} per member each month. Seats sync
          automatically as people join or leave — cancel anytime.
        </p>
      )}
    </div>
  );
}

function PlanCardCta({ plan, ...group }: GroupProps & { plan: PlanDef }) {
  if (plan.id === "free") {
    return (
      <button
        type="button"
        className="lp-btn lp-btn--3d-light lp-plan-cta"
        onClick={group.onGetStarted}
      >
        Try today
      </button>
    );
  }

  // Card matching the live plan reflects it instead of offering a duplicate
  // checkout; past_due routes to manage billing.
  const isCurrentPlan = Boolean(group.isPaid) && group.currentPlan === plan.id;

  if (isCurrentPlan && group.isPastDue) {
    return (
      <button
        type="button"
        className="lp-btn lp-btn--3d lp-plan-cta"
        onClick={group.onManageBilling}
      >
        Payment issue — manage billing
      </button>
    );
  }
  if (isCurrentPlan) {
    return (
      <button type="button" className="lp-btn lp-btn--3d-light lp-plan-cta" disabled>
        Current plan
      </button>
    );
  }
  return (
    <button
      type="button"
      className="lp-btn lp-btn--3d lp-plan-cta"
      onClick={group.onSubscribe}
      disabled={!group.authChecked}
    >
      {group.subscribeLabel}
    </button>
  );
}

function ComparisonTable({
  rows,
  left,
  right,
}: {
  rows: CompareRow[];
  left: string;
  right: string;
}) {
  return (
    <div className="lp-compare">
      {/* ⚠ THE SCROLLER IS THE POINT: the table has its own `overflow-x: auto`
          so a narrow screen scrolls THIS CARD, never the page. */}
      <div className="lp-compare-scroll">
        <table className="lp-compare-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="lp-compare-caption">Compare plans</span>
              </th>
              <th scope="col">{left}</th>
              <th scope="col" className="lp-compare-col--popular">
                {right}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <CompareValue cell={row.left} />
                <CompareValue cell={row.right} popular />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompareValue({ cell, popular }: { cell: CompareCell; popular?: boolean }) {
  return (
    <td className={popular ? "lp-compare-col--popular" : undefined}>
      {cell.main}
      {cell.sub && <span className="lp-compare-sub">{cell.sub}</span>}
    </td>
  );
}

function CheckIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
    </svg>
  );
}
