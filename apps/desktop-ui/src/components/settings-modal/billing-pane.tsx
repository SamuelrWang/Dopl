import { ExternalLink, RefreshCw } from "lucide-react";
import {
  formatMoney,
  SOLO_PRICE,
  TEAM_SEAT_PRICE,
  useWorkspaceEntitlements,
} from "@/features/billing/components/use-workspace-entitlements";
import { cn } from "@/shared/lib/utils";
import { billingPath, openInBrowser } from "./open-in-browser";

interface Props {
  workspaceSegment: string;
  workspaceId: string;
}

/**
 * Plans & Billing, degraded for the desktop renderer.
 *
 * The web pane mounts Stripe Embedded Checkout — a CDN script plus its own
 * network origins, both refused by the packaged page's CSP
 * (`script-src 'self'`, `connect-src 'none'`). So there is no checkout, no
 * portal redirect and no plan CTA in here: this reads `GET /api/billing/status`
 * through the bridge (the same `useWorkspaceEntitlements` cache entry every
 * other surface uses) to show WHAT the workspace is on, and hands every
 * change-my-plan action to the browser, where the full pane already works.
 */
export function BillingPane({ workspaceSegment, workspaceId }: Props) {
  const ent = useWorkspaceEntitlements(workspaceId);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-title font-semibold tracking-tight text-text-primary">
          Plans and Billing
        </h2>
        <button
          type="button"
          className="cursor-pointer p-1 text-text-muted transition-colors hover:text-text-secondary"
          onClick={() => ent.refresh()}
          aria-label="Refresh billing status"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {ent.isPastDue && (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-caption text-warning">
          <div className="font-semibold">Payment past due</div>
          <div className="mt-0.5 text-text-secondary">
            Your {ent.isSolo ? "Pro" : "Team"} workspace stays active for now.
            Update your payment method in the browser to avoid losing paid
            features.
          </div>
        </div>
      )}

      {ent.loading ? (
        <div className="bento mb-5 h-24 animate-pulse opacity-50" />
      ) : (
        <div className="bento mb-5 p-4">
          <div className="flex items-center justify-between">
            <span
              className={cn(
                "rounded-full border border-border-strong px-2.5 py-0.5 text-caption font-semibold",
                ent.isPaid
                  ? "bg-surface-cta text-text-on-cta"
                  : "bg-bg-inset text-text-secondary"
              )}
            >
              {ent.isSolo ? "Pro plan" : ent.isTeam ? "Team plan" : "Starter plan"}
            </span>
            <span className="text-caption text-text-secondary">
              {ent.memberCount} {ent.memberCount === 1 ? "member" : "members"}
            </span>
          </div>

          {ent.isSolo ? (
            <div className="mt-3 text-body text-text-primary">
              <span className="font-semibold">{formatMoney(SOLO_PRICE)}</span>{" "}
              <span className="text-caption text-text-muted">
                / month — flat, single-member workspace
              </span>
            </div>
          ) : ent.isTeam ? (
            <div className="mt-3 text-body text-text-primary">
              <span className="font-semibold">{ent.billableSeats}</span>{" "}
              {ent.billableSeats === 1 ? "seat" : "seats"} ×{" "}
              {formatMoney(TEAM_SEAT_PRICE)} ={" "}
              <span className="font-semibold">{formatMoney(ent.monthlyTotal)}</span>{" "}
              <span className="text-caption text-text-muted">/ month</span>
            </div>
          ) : (
            ent.isCapped &&
            ent.objectCap !== null && (
              <UsageMeter
                used={ent.objectsUsed}
                cap={ent.objectCap}
                over={ent.overCap}
              />
            )
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => openInBrowser(billingPath(workspaceSegment))}
        className="btn-light flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-4 text-small font-medium text-text-primary"
      >
        Manage billing in browser
        <ExternalLink size={13} />
      </button>
      <p className="mt-2 text-caption text-text-secondary">
        Plans, payment methods and receipts open in your browser — the desktop
        app never handles payment details.
      </p>
    </div>
  );
}

function UsageMeter({ used, cap, over }: { used: number; cap: number; over: boolean }) {
  const pct = Math.min(100, Math.round((used / cap) * 100));
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-baseline justify-between text-caption">
        <span className="text-text-secondary">Ontology objects</span>
        <span className={cn("font-medium", over ? "text-warning" : "text-text-primary")}>
          {used.toLocaleString()} / {cap.toLocaleString()}
        </span>
      </div>
      <div className="concave-track">
        <div
          className={cn(
            "h-1.5 rounded-full transition-[width]",
            over ? "bg-warning" : "bg-surface-cta"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {over && (
        <p className="mt-1.5 text-micro text-text-secondary">
          New objects are paused. Nothing was deleted — reads and edits still work.
        </p>
      )}
    </div>
  );
}
