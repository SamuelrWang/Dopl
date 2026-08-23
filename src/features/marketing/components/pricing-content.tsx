"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { PLANS, type PlanDef } from "@/features/billing/plans";
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
 */

const PLAN_SUMMARY: Record<string, string> = {
  free: "Everything, free forever — caps only start when a second member joins.",
  solo: "You, uncapped: unlimited objects and full history in your own workspace.",
  team: "Your whole team, uncapped — pay only per seat, synced automatically.",
};

const SUBSCRIBE_LABEL: Record<string, string> = {
  solo: "Go Pro",
  team: "Bring your team",
};

type CompareCell = { main: string; sub?: string };

const COMPARE_ROWS: {
  label: string;
  free: CompareCell;
  solo: CompareCell;
  team: CompareCell;
}[] = [
  {
    label: "Ontology objects",
    free: { main: "Unlimited", sub: "100 with 2+ members" },
    solo: { main: "Unlimited" },
    team: { main: "Unlimited" },
  },
  {
    label: "Chat history",
    free: { main: "90 days" },
    solo: { main: "Full" },
    team: { main: "Full" },
  },
  {
    label: "Members",
    free: { main: "Unlimited" },
    solo: { main: "1" },
    team: { main: "Unlimited", sub: "per seat" },
  },
  {
    // ⚠ Copy, not config. Source of truth =
    // `features/billing/credits.ts › MONTHLY_MCP_CREDITS`. Retune there, then
    // sync this row AND `plans.ts › PLANS.features`.
    label: "MCP credits",
    free: { main: "500", sub: "/ month" },
    solo: { main: "10,000", sub: "/ month" },
    team: { main: "25,000", sub: "/ month" },
  },
  {
    label: "Price",
    free: { main: "Free" },
    solo: { main: "$5.99", sub: "/ month" },
    team: { main: "$7.99", sub: "/ seat / month" },
  },
];

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

  // `plan` = "free" | "solo" | "team" — which card is the live subscription.
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

  function handleSubscribe() {
    if (!user) {
      router.push(`/login?redirectTo=${encodeURIComponent("/pricing")}`);
      return;
    }
    // ⚠ Never check out in place: this public page can't pick a workspace, so
    // a multi-workspace user would be billed on the wrong one silently. Hand
    // off to /billing, where the target workspace is explicit. `/billing` (no
    // segment) resolves the caller's default (`features/billing/url.ts`).
    router.push(billingPath({ intent: multiWorkspace ? "return" : "upgrade" }));
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
          Start free. Go Pro for $5.99, or bring your team at $7.99 a seat.
        </p>
      </div>

      <div className="lp-plans">
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            currentPlan={currentPlan}
            isPaid={isPaid}
            isPastDue={isPastDue}
            authChecked={authChecked}
            onSubscribe={handleSubscribe}
            onManageBilling={handleManageBilling}
            onGetStarted={handleGetStarted}
          />
        ))}
      </div>

      <ComparisonTable />
    </section>
  );
}

function PlanCard({
  plan,
  currentPlan,
  isPaid,
  isPastDue,
  authChecked,
  onSubscribe,
  onManageBilling,
  onGetStarted,
}: {
  plan: PlanDef;
  currentPlan: string | undefined;
  isPaid: boolean;
  isPastDue: boolean;
  authChecked: boolean;
  onSubscribe: () => void;
  onManageBilling: () => void;
  onGetStarted: () => void;
}) {
  const isFree = plan.id === "free";
  const popular = plan.id === "team";
  const solo = !isFree && !popular;

  return (
    <div className={`lp-plan${popular ? " lp-plan--popular" : ""}`}>
      <div className="lp-plan-top">
        {popular && <span className="lp-plan-badge">Popular</span>}
        {solo && (
          <span className="lp-plan-badge lp-plan-badge--soft">Just you</span>
        )}
      </div>

      <h2 className="lp-plan-name">{plan.name}</h2>
      <div className="lp-plan-price">
        <span className="lp-plan-price-figure">{plan.priceMonthly}</span>
        {plan.priceNote && (
          <span className="lp-plan-price-note">{plan.priceNote}</span>
        )}
      </div>
      <p className="lp-plan-summary">{PLAN_SUMMARY[plan.id]}</p>

      <PlanCardCta
        plan={plan}
        currentPlan={currentPlan}
        isPaid={isPaid}
        isPastDue={isPastDue}
        authChecked={authChecked}
        onSubscribe={onSubscribe}
        onManageBilling={onManageBilling}
        onGetStarted={onGetStarted}
      />

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

      {popular && (
        <p className="lp-plan-guarantee">
          <strong>Only pay for your team</strong>
          $7.99 per member each month. Seats sync automatically as people join or
          leave — cancel anytime.
        </p>
      )}
    </div>
  );
}

function PlanCardCta({
  plan,
  currentPlan,
  isPaid,
  isPastDue,
  authChecked,
  onSubscribe,
  onManageBilling,
  onGetStarted,
}: {
  plan: PlanDef;
  currentPlan: string | undefined;
  isPaid: boolean;
  isPastDue: boolean;
  authChecked: boolean;
  onSubscribe: () => void;
  onManageBilling: () => void;
  onGetStarted: () => void;
}) {
  if (plan.id === "free") {
    return (
      <button
        type="button"
        className="lp-btn lp-btn--3d-light lp-plan-cta"
        onClick={onGetStarted}
      >
        Try today
      </button>
    );
  }

  // Card matching the live plan reflects it instead of offering a duplicate
  // checkout; past_due routes to manage billing.
  const isCurrentPlan = isPaid && currentPlan === plan.id;

  if (isCurrentPlan && isPastDue) {
    return (
      <button
        type="button"
        className="lp-btn lp-btn--3d lp-plan-cta"
        onClick={onManageBilling}
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
  // Team = highlighted growth path → dark primary; Pro → light.
  const primary = plan.id === "team";
  return (
    <button
      type="button"
      className={`lp-btn ${primary ? "lp-btn--3d" : "lp-btn--3d-light"} lp-plan-cta`}
      onClick={onSubscribe}
      disabled={!authChecked}
    >
      {SUBSCRIBE_LABEL[plan.id] ?? "Upgrade"}
    </button>
  );
}

function ComparisonTable() {
  return (
    <div className="lp-compare">
      <div className="lp-compare-scroll">
        <table className="lp-compare-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="lp-compare-caption">Compare plans</span>
              </th>
              <th scope="col">Starter</th>
              <th scope="col">Pro</th>
              <th scope="col" className="lp-compare-col--popular">
                Team
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARE_ROWS.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <CompareValue cell={row.free} />
                <CompareValue cell={row.solo} />
                <CompareValue cell={row.team} popular />
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
