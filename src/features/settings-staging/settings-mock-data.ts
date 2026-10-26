/**
 * Fake payloads for the staged Settings modal (`/popups`, `/overview`). Every value is made up.
 * Pure data: no fetch, no Supabase, no Electron bridge. People come from `ui-staging/staging-stubs`.
 */

import type { WorkspaceWithRole } from "@/features/workspaces/types";
import type {
  WorkspaceCreditsStatus,
  WorkspaceEntitlementsStatus,
} from "@/features/billing/components/use-workspace-entitlements";
import type { InvoiceDto } from "@/features/billing/billing-account";
import type { AgentApp, ComputerDeviceDto } from "@/features/devices/types";
import type { GlassesDevice } from "@/features/glasses/settings/glasses-api";
import type { RuntimeCredentialStatus } from "@/shared/lib/spa-bridge";
import type { RuntimeDescriptor } from "@/features/channels/lib/runtime-capability";
import type { LevelSetting, PermissionLevel } from "@/features/channels/lib/launch-selection";
import {
  STAGING_HOME_SEGMENT,
  STAGING_HOME_WORKSPACE_ID,
  STAGING_VIEWER,
  daysAgoIso,
  minsAgoIso,
} from "@/features/ui-staging/staging-stubs";

export { STAGING_HOME_SEGMENT, STAGING_HOME_WORKSPACE_ID };

/** Plans the staged billing panes can show. Same names as overview-staging's toolbar. */
export type StagingPlan = "free" | "pro" | "exhausted";

/* ─────────────────────────── Workspaces ─────────────────────────── */

function ws(
  id: string,
  name: string,
  slug: string,
  role: WorkspaceWithRole["role"],
  iconUrl: string | null
): WorkspaceWithRole {
  return {
    id,
    ownerId: STAGING_VIEWER.userId,
    name,
    slug,
    publicId: id.slice(-6),
    description: null,
    iconUrl,
    kind: "standard",
    createdAt: daysAgoIso(120),
    updatedAt: daysAgoIso(3),
    role,
  };
}

/** `GET /api/workspaces`, already filtered to standard workspaces. */
export const STAGING_WORKSPACES: WorkspaceWithRole[] = [
  ws("staging-ws-northwind", "Northwind", "northwind", "owner", "/img/dev-clouds.jpg"),
  ws("staging-ws-vermillion", "Vermillion", "vermillion", "member", "/img/framework-banner.jpg"),
  ws("staging-ws-atlas", "Atlas Labs", "atlas-labs", "admin", null),
];

/* ─────────────────────────── Account ─────────────────────────── */

/** `GET /api/user/profile`. */
export const STAGING_PROFILE = {
  display_name: STAGING_VIEWER.displayName ?? "Daniel Ortiz",
  avatar_url: STAGING_VIEWER.avatarUrl ?? null,
  email: STAGING_VIEWER.email ?? "daniel@vermillion.io",
};

/* ─────────────────────────── Billing ─────────────────────────── */

function periodBounds(): { periodStart: string; periodEnd: string } {
  return { periodStart: daysAgoIso(21), periodEnd: daysAgoIso(-9) };
}

function credits(plan: StagingPlan): WorkspaceCreditsStatus {
  const base = { wallet: "personal" as const, ...periodBounds(), ledgerDrift: 0, unmeteredSince: null };
  if (plan === "pro") return { ...base, used: 2513, limit: 5000, remaining: 2487 };
  if (plan === "exhausted") return { ...base, used: 500, limit: 500, remaining: 0 };
  return { ...base, used: 312, limit: 500, remaining: 188 };
}

/** `GET /api/billing/status` for the home space on each staging plan. */
export function billingStatus(plan: StagingPlan): WorkspaceEntitlementsStatus {
  const isPaid = plan === "pro";
  return {
    plan: isPaid ? "pro" : "free",
    status: isPaid ? "active" : "free",
    containerKind: "home",
    memberCount: 1,
    seatCount: null,
    objectCap: null,
    objectsUsed: 0,
    canCreateObjects: true,
    chatsWindowDays: null,
    credits: credits(plan),
    cancelAtPeriodEnd: false,
    subscription_period_end: isPaid ? periodBounds().periodEnd : null,
    has_stripe_customer: isPaid,
  };
}

/** `GET /api/billing/invoices` (paid charges are what the Account pane lists). */
export const STAGING_INVOICES: InvoiceDto[] = [0, 1, 2].map((i) => ({
  id: `in_staging_${i}`,
  number: `DOPL-00${3 - i}`,
  created: daysAgoIso(21 + i * 30),
  amountPaid: 899,
  amountDue: 899,
  currency: "usd",
  status: "paid",
  hostedInvoiceUrl: "https://example.com/receipt",
}));

/* ─────────────────────────── Agents ─────────────────────────── */

/** `GET /api/oauth/apps`. */
export const STAGING_AGENT_APPS: AgentApp[] = [
  {
    key: "claude-code|localhost",
    name: "Claude Code",
    host: "localhost",
    connections: 2,
    last_used_at: minsAgoIso(4),
    created_at: daysAgoIso(40),
  },
  {
    key: "cursor|cursor.com",
    name: "Cursor",
    host: "cursor.com",
    connections: 1,
    last_used_at: daysAgoIso(2),
    created_at: daysAgoIso(30),
  },
  {
    key: "chatgpt|chatgpt.com",
    name: "ChatGPT",
    host: "chatgpt.com",
    connections: 1,
    last_used_at: null,
    created_at: daysAgoIso(6),
  },
];

/** The bridge's `runtimeAuth.status()` — one row per runtime Dopl signs in from the app. */
export const STAGING_RUNTIME_CREDENTIALS: RuntimeCredentialStatus[] = [
  { runtimeId: "claude", label: "Claude", state: "connected", prompt: false, full: "on" },
  { runtimeId: "codex", label: "Codex", state: "connected", prompt: false, full: "off" },
  { runtimeId: "grok", label: "Grok", state: "expired", prompt: false },
  { runtimeId: "muse", label: "Muse", state: "not-connected", prompt: false },
];

/* ─────────────────────────── Devices ─────────────────────────── */

/** `GET /api/devices`. */
export const STAGING_COMPUTERS: ComputerDeviceDto[] = [
  {
    id: "staging-mac-1",
    kind: "computer",
    name: "Daniel’s MacBook Pro",
    platform: "macos",
    online: true,
    status: "active",
    last_seen: minsAgoIso(0),
    created_at: daysAgoIso(60),
    app_version: "1.42.0",
    os_version: "15.4",
    current: true,
    legacy: false,
    detected_name: "Daniel’s MacBook Pro",
  },
  {
    id: "staging-mac-2",
    kind: "computer",
    name: "Studio Mac",
    platform: "macos",
    online: false,
    status: "offline",
    last_seen: daysAgoIso(1),
    created_at: daysAgoIso(90),
    app_version: "1.41.0",
    os_version: "15.3",
    current: false,
    legacy: false,
    detected_name: "Mac Studio",
    renamed: true,
  },
];

/** `GET /api/glasses/devices`. */
export const STAGING_GLASSES: GlassesDevice[] = [
  {
    id: "staging-g2-1",
    name: "Even G2",
    platform: "even_g2",
    created_at: daysAgoIso(12),
    last_seen: minsAgoIso(18),
    online: false,
    has_hey_even_key: true,
  },
];

/* ─────────────────────────── Configuration ─────────────────────────── */

/** The registered runtimes main reports (`runtime/index.js › all`), default first. */
export const STAGING_RUNTIMES: RuntimeDescriptor[] = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "grok", label: "Grok" },
];

/** Each runtime's own reading of each level (`Details` under Permissions). */
export const STAGING_LEVEL_SETTINGS: Record<string, Record<PermissionLevel, LevelSetting>> = {
  claude: {
    ask: { label: "Default", setting: "default" },
    auto: { label: "Accept edits", setting: "acceptEdits" },
    full: { label: "Bypass permissions", setting: "bypassPermissions" },
  },
  codex: {
    ask: { label: "Read only", setting: "on-request/read-only" },
    auto: { label: "Auto", setting: "on-request/workspace-write" },
    full: { label: "Full access", setting: "never/danger-full-access" },
  },
};
