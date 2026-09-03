/**
 * WORKSPACE DOMAIN TYPES.
 *
 * ⚠ **THE ROLE SET, THE MEMBERSHIP LIFECYCLE AND THE CONTAINER KIND ARE
 * DECLARED IN `@dopl/contracts › workspaces.ts` AND RE-EXPORTED HERE UNDER THE
 * NAMES THEY HAVE ALWAYS HAD** (2026-09-02, v2 slice A13) — `Role` is the
 * package's `WorkspaceRole`, aliased back on the way through, so no consumer
 * import changes. Each had a twin in `packages/dopl-client/src` and
 * `scripts/check-role-drift.ts` grew to 422 lines holding them apart.
 *
 * ⚠ **`isStandardWorkspace` BELOW IS DELIBERATELY NOT IN THE PACKAGE.** It is a
 * runtime predicate and `@dopl/contracts` is type-only, so the SDK's copy is
 * still a copy — and the POSITIVE-form assertion over both (INVARIANTS §4A,
 * F-295) is still the only thing stopping a coordinated flip to `!== "link"`,
 * which would silently admit every kind added to the union later. That check
 * stays in `check-role-drift.ts › checkWorkspaceKind`.
 *
 * ⚠ **`InvitedRole` STAYS HERE**: it has no SDK twin, so it was never a mirror.
 */
import type {
  WorkspaceRole as Role,
  MembershipStatus,
  WorkspaceKind,
} from "@dopl/contracts";

export type { Role, MembershipStatus, WorkspaceKind };

/**
 * ⚠ `guest` is a LINK-granted role, never an invitation role — a workspace admin
 * cannot invite somebody in as a guest, and the Add-person picker on a home
 * channel mints a link at guest, it does not create a membership directly. So
 * `InvitedRole` deliberately excludes it.
 */
export type InvitedRole = "admin" | "member" | "viewer";

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
 * THE shared kind predicate — every UI list, navigation menu, membership count
 * and every implicit listing site filters through this and nothing else.
 *
 * ⚠ POSITIVE FORM, and that is the point: `=== "standard"`, never `!== "link"`.
 * The negative spelling admits every kind that has not been invented yet — the
 * NEXT kind added to the union would be silently standard in the rail, in the
 * switcher and in `list_workspaces`, with no error
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
  /**
   * ACTIVE members of this workspace, for the MCP directory lock (plan §4.4 B3).
   * `bootServer` needs to know whether a link container is SOLO or SHARED before
   * it decides whether to lock the session's directory to it, and it must know
   * without a second loopback per workspace.
   *
   * 🔒 ⚠ OPTIONAL ON THE WIRE, AND ABSENT MUST FAIL CLOSED — `?? 0`, and ZERO
   * IS "NOT SOLO", so an older server that sends no count gets the NARROWED
   * behaviour rather than the open one (§8 stale-cache, inverted). The usual
   * stale-field instinct is to fall back to the permissive reading; here that
   * would silently unlock every container against a deployment mismatch, which
   * is precisely the release window a fence is most likely to be tested in.
   *
   * ⚠ IT IS ON THE LIST ITEM, NOT ON `Workspace`. Plan §4.4 named
   * `WorkspaceSummary` too; that would widen every single-workspace payload in
   * the product for one consumer that only ever reads the LIST, and every one of
   * those payloads would then owe the same fail-closed reading. One list, one
   * count, one place to get it wrong.
   *
   * ⚠ NOT AN AUTHORIZATION FIELD. It decides how much of the directory an agent
   * is SHOWN. The fence is `knowledge/server/service-audience.ts`, server-side,
   * which re-reads this count from the database itself.
   */
  memberCount?: number;
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
 * Higher = more privileges: owner > admin > member > viewer > guest.
 *
 * ⚠ `guest` is the NEW FLOOR (rank 0) below `viewer`. `meetsMinRole` is pure
 * `>=`, so every existing gate keeps its relative semantics — a `guest` clears
 * only `minRole:"guest"` routes and is rejected by the `withWorkspaceAuth`
 * default (`viewer`), which INVERTS the blast radius: guests reach only the few
 * channel routes explicitly re-admitted (INVARIANTS §4A, §2B). The
 * `Record<Role, number>` typing forces the `guest` key here and is the
 * compile-time net that proves every role map covers it.
 */
export const ROLE_RANK: Record<Role, number> = {
  guest: 0,
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

export function meetsMinRole(actual: Role, min: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[min];
}
