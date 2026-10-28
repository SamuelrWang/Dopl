/**
 * The Settings modal's network, in memory: every route the PRODUCT modal
 * (`shared/layout/settings-modal/desktop-settings-modal.tsx`) and its panes call, answered from
 * `settings-mock-data.ts` through the playground bridge (`ui-staging/staging-bridge.ts`). Writes
 * change the in-memory rows for the page's life; nothing leaves the page.
 */

import type { NotificationPrefs } from "@/features/notifications/prefs";
import { defaultNotificationPrefs } from "@/features/notifications/prefs";
import { bridgeOk, type BridgeOpts, type BridgeResponse } from "@/features/ui-staging/staging-bridge";
import { STAGING_USER_ID } from "@/features/ui-staging/staging-stubs";
import {
  STAGING_AGENT_APPS,
  STAGING_COMPUTERS,
  STAGING_GLASSES,
  STAGING_INVOICES,
  STAGING_PROFILE,
  STAGING_WORKSPACES,
  billingStatus,
  type StagingPlan,
} from "./settings-mock-data";

const LATENCY_MS = 250;

let plan: StagingPlan = "pro";
let profile = { ...STAGING_PROFILE };
let computers = STAGING_COMPUTERS.map((c) => ({ ...c }));
let apps = [...STAGING_AGENT_APPS];
let glasses = STAGING_GLASSES.map((g) => ({ ...g }));
let prefs: NotificationPrefs = defaultNotificationPrefs();
let accessRequested = false;

/** Which plan `GET /api/billing/status` answers for (the `/overview` toolbar, `/popups`). */
export function setStagingBillingPlan(next: StagingPlan): void {
  plan = next;
}

type Body = Record<string, unknown>;
type Handler = (body: Body, id: string) => unknown;

const byId = <T extends { id: string }>(rows: T[], id: string, patch: Body): T[] =>
  rows.map((row) => (row.id === id ? { ...row, ...patch } : row));

const ROUTES: Record<string, Handler> = {
  "GET /api/workspaces": () => ({ workspaces: STAGING_WORKSPACES }),
  "GET /api/workspaces/me": () => ({ role: "owner", userId: STAGING_USER_ID }),
  "GET /api/user/profile": () => profile,
  "PATCH /api/user/profile": (body) => (profile = { ...profile, ...body }),
  "GET /api/billing/status": () => billingStatus(plan),
  "GET /api/billing/invoices": () => ({ invoices: plan === "pro" ? STAGING_INVOICES : [] }),
  "GET /api/billing/payment-method": () => ({ paymentMethod: null }),
  "POST /api/billing/cancel": (body) => ({
    cancelAtPeriodEnd: body.resume !== true,
    currentPeriodEnd: billingStatus(plan).subscription_period_end,
  }),
  "GET /api/billing/change-plan": () => ({
    plan: plan === "pro" ? "pro" : null,
    scheduledPlan: null,
    effectiveAt: null,
  }),
  "GET /api/billing/change-plan/preview": () => ({ amountDue: 1601, currency: "usd" }),
  "POST /api/billing/change-plan": () => ({
    outcome: "requires_action",
    payment: { clientSecret: null, hostedInvoiceUrl: "https://example.com/invoice" },
  }),
  "POST /api/billing/portal": () => ({ url: "https://example.com/billing-portal" }),
  "POST /api/billing/upgrade-to-team": () => ({ ok: true, seatCount: 1 }),
  "GET /api/devices": () => ({ devices: computers }),
  "PATCH /api/devices/:id": (body, id) => void (computers = byId(computers, id, body)),
  "DELETE /api/devices/:id": (_b, id) => void (computers = computers.filter((c) => c.id !== id)),
  "GET /api/oauth/apps": () => ({ apps }),
  "DELETE /api/oauth/apps/:id": (_b, key) => void (apps = apps.filter((a) => a.key !== key)),
  "GET /api/glasses/devices": () => ({ devices: glasses }),
  "PATCH /api/glasses/devices/:id": (body, id) => void (glasses = byId(glasses, id, body)),
  "DELETE /api/glasses/devices/:id": (_b, id) => void (glasses = glasses.filter((g) => g.id !== id)),
  "POST /api/glasses/devices/:id/hey-even-key": () => ({
    key: "dopl_ak_staging_4f9c2e7a1b",
    url: "https://example.com/mcp/hey-even",
  }),
  "POST /api/glasses/pair/claim": (body) => {
    const device = { ...STAGING_GLASSES[0], id: `staging-g2-${glasses.length + 1}`, name: String(body.name || "Even G2") };
    glasses = [...glasses, device];
    return { device };
  },
  "GET /api/user/notification-preferences": () => ({ prefs }),
  "PUT /api/user/notification-preferences": (body) => ({ prefs: (prefs = body.prefs as NotificationPrefs) }),
  "GET /api/user/workspace-access-request": () => ({ requested: accessRequested }),
  "POST /api/user/workspace-access-request": () => ({ requested: (accessRequested = true) }),
};

/** `/api/devices/abc` → `["/api/devices/:id", "abc"]`; the last decoded segment is the id. */
function routeKey(method: string, pathname: string): [string, string] | null {
  const exact = `${method} ${pathname}`;
  if (ROUTES[exact]) return [exact, ""];
  const parts = pathname.split("/");
  for (let i = parts.length - 1; i > 2; i -= 1) {
    const key = `${method} ${[...parts.slice(0, i), ":id", ...parts.slice(i + 1)].join("/")}`;
    if (ROUTES[key]) return [key, decodeURIComponent(parts[i])];
  }
  return null;
}

export async function settingsApiRequest(path: string, opts: BridgeOpts): Promise<BridgeResponse | null> {
  const method = (opts.method ?? "GET").toUpperCase();
  const match = routeKey(method, new URL(path, "http://staging.invalid").pathname);
  if (!match) return null;
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  const [key, id] = match;
  return bridgeOk(ROUTES[key]((opts.body ?? {}) as Body, id));
}
