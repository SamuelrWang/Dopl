import type { PlanDef } from "@/features/billing/plans";
import { formatMoney, TEAM_SEAT_PRICE } from "@/features/billing/prices";

/**
 * One /pricing product group: its plan cards and its own comparison table.
 * Split out of pricing-content.tsx (500-line cap); that file owns the data,
 * the auth/billing reads and the CTA handlers, this one only renders.
 */

export type CompareCell = { main: string; sub?: string };
export type CompareRow = { label: string; left: CompareCell; right: CompareCell };

export interface GroupProps {
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
export function PlanGroup(props: GroupProps) {
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
