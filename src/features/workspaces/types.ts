export type Role = "owner" | "admin" | "member" | "viewer";

export type InvitedRole = "admin" | "member" | "viewer";

export type MembershipStatus = "pending" | "active" | "revoked";

export interface Invitation {
  id: string;
  workspaceId: string;
  email: string;
  invitedRole: InvitedRole;
  invitedBy: string;
  token: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
  revokedAt: string | null;
  createdAt: string;
  /** Teams the invitee auto-joins on accept (hydrated where the UI needs it). */
  teamIds?: string[];
}

export interface InvitationStatus {
  invitation: Invitation;
  workspace: {
    id: string;
    slug: string;
    publicId: string;
    name: string;
  };
  inviter: {
    id: string;
    email: string | null;
  };
  expired: boolean;
  revoked: boolean;
  alreadyAccepted: boolean;
}

/**
 * "standard" = a real user-facing workspace. "link" = a hidden home-channel
 * container holding ONE or TWO members and exactly one channel — never shown in
 * the rail/switcher, never a default-resolution candidate, bills to each side's
 * own plan.
 */
export type WorkspaceKind = "standard" | "link";

/**
 * THE shared kind predicate — every UI list, navigation menu, membership count
 * and implicit default-resolution site filters through this and nothing else.
 *
 * ⚠ POSITIVE FORM, and that is the point: `=== "standard"`, never `!== "link"`.
 * The negative spelling admits every kind that has not been invented yet — the
 * NEXT kind added to the union would be silently standard in the rail, in the
 * switcher, in `list_workspaces` and in default resolution, with no error
 * anywhere. A listing predicate must let a value IN, not merely fail to keep
 * one out.
 *
 * ⚠ Absent `kind` still reads as "standard". The column applied on 2026-08-24
 * (`20260823150000`) and is `NOT NULL DEFAULT 'standard'`, so live rows carry
 * it — but the default is what an older server, a narrowed projection or a test
 * fixture omits, and that must keep behaving exactly as it does now.
 *
 * ⚠ NOT an authz check. Explicit addressing of a link workspace (by id, slug,
 * segment or `workspace=`) stays allowed — that is how a home channel is
 * reached.
 */
export function isStandardWorkspace(workspace: { kind?: WorkspaceKind }): boolean {
  return (workspace.kind ?? "standard") === "standard";
}

export interface Workspace {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  publicId: string;
  description: string | null;
  iconUrl: string | null;
  /** Absent on rows read before the kind migration is applied = "standard". */
  kind?: WorkspaceKind;
  createdAt: string;
  updatedAt: string;
}

/**
 * Workspace row + the caller's effective role. Read by `GET /api/workspaces`
 * and the MCP `list_workspaces` tool, so an agent can switch without a second
 * query.
 */
export interface WorkspaceWithRole extends Workspace {
  role: Role;
}

/** Series the overview histogram can plot. Unrecognised values are a 400. */
export type OverviewSeriesMetric = "messages" | "mcp" | "threads";

/** One daily bin. `date` is a UTC calendar day, `YYYY-MM-DD`. */
export interface OverviewSeriesPoint {
  date: string;
  count: number;
}

/**
 * Daily-binned series behind the overview histogram. Read by
 * `GET /api/workspaces/[workspaceSlug]/overview-series?metric=`.
 * Always 31 points, oldest first, ending on the current UTC day —
 * zero-filled so the chart never has to gap-fill.
 */
export interface WorkspaceOverviewSeries {
  metric: OverviewSeriesMetric;
  days: OverviewSeriesPoint[];
}

/** One row of the overview "Recent activity" feed. Viewer-filtered server-side. */
export interface OverviewActivityRow {
  id: string;
  channelId: string;
  channelName: string;
  kind: "message" | "thread_opened" | "thread_closed";
  /** Display name of the acting user/agent; null when unattributable. */
  actorName: string | null;
  /** Message snippet or thread title, pre-truncated server-side. */
  preview: string;
  /** ISO timestamp. */
  at: string;
}

/** One bar of the overview member-load card: share of user messages, last 30 days. */
export interface OverviewMemberLoadRow {
  userId: string;
  name: string;
  /** 0–100, this member's share of the 30-day user-authored message total. */
  percent: number;
}

/**
 * Everything the overview page renders except the histogram (see
 * `WorkspaceOverviewSeries`) and credits (reuses `GET /api/billing/status`).
 * Read by `GET /api/workspaces/[workspaceSlug]/overview`.
 */
export interface WorkspaceOverview {
  counts: {
    /** `channel_messages` with `kind='message'` created since UTC midnight. */
    messagesToday: number;
    /** `channel_sessions` rows with `state <> 'ended'` — live agent sessions. */
    agentsRunning: number;
    members: number;
    /** Non-direct, non-deleted, non-archived channels. */
    channels: number;
  };
  /** Newest first, viewer-filtered, at most 8 rows. */
  activity: OverviewActivityRow[];
  /**
   * Top members by 30-day user-authored message count, at most 6 rows,
   * descending. `totalMessages` is the shared denominator.
   */
  memberLoad: {
    totalMessages: number;
    rows: OverviewMemberLoadRow[];
  };
}

export interface WorkspaceMembership {
  workspaceId: string;
  userId: string;
  role: Role;
  status: MembershipStatus;
  joinedAt: string;
  invitedBy: string | null;
  invitedAt: string | null;
  /** Throttled activity timestamp (bumped at most every ~5 min). */
  lastSeenAt: string | null;
}

/**
 * Ranking `withWorkspaceAuth({ minRole })` gates on.
 * Higher = more privileges: owner > admin > member > viewer.
 */
export const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export function meetsMinRole(actual: Role, min: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[min];
}
