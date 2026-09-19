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
 * switcher and in every listing that renders a kind, with no error
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
 * and the MCP `dopl_workspaces` tool, so an agent can switch without a second
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

/**
 * Series the overview histogram can plot. Unrecognised values are a 400.
 *
 * ⚠ **`credits` LANDED IN WAVE 8 (R-29(b)) AND IT IS A DIFFERENT SHAPE OF
 * READ.** The other three are COUNTED per bin, exactly, with no cliff;
 * `credits` is SUMMED from `credit_usage_events`, which PostgREST cannot
 * aggregate — so that arm hauls the window once, bins in the service, and is the
 * only arm that can answer {@link WorkspaceOverviewSeries.truncated} true.
 * ⚠ **IT IS THIS WORKSPACE'S SEAT WALLETS AND NOTHING ELSE** — see
 * `server/service-usage.ts › isWorkspaceSeatBurn`. A personal-wallet figure is
 * on no workspace surface, and summing across wallets was the 2026-09-12 bug.
 */
export type OverviewSeriesMetric = "messages" | "mcp" | "threads" | "credits";

/** One daily bin. `date` is a UTC calendar day, `YYYY-MM-DD`. */
export interface OverviewSeriesPoint {
  date: string;
  count: number;
}

/**
 * The windows a workspace series may be asked for.
 *
 * 🔒 **DAY BUCKETS ONLY, AND `24h` IS ABSENT ON PURPOSE (wave 8).** This
 * payload's bin is {@link OverviewSeriesPoint}, whose `date` is a UTC CALENDAR
 * DAY — the field `channels/components/thread-activity.tsx › ActivityBin` reads
 * as `YYYY-MM-DD`. An hour bucket has no field to travel in here, and inventing
 * one would be a second bin shape for one series (P33). /home keeps its `24h`
 * arm because its bin is an INSTANT (`HomeSeriesPoint.at`).
 *
 * ⚠ **`31d` IS THE BACK-COMPAT WINDOW, NOT A SWITCHER OPTION** — today plus
 * the 30 UTC days before it, what this route answered with no `range` at all
 * before wave 8. It stays the default so the Info tab's activity strip did not
 * silently lose a day. {@link WORKSPACE_SERIES_SWITCHER_RANGES} is what the
 * Overview offers.
 */
export type WorkspaceSeriesRange = "7d" | "30d" | "31d" | "month";

export const WORKSPACE_SERIES_RANGES: readonly WorkspaceSeriesRange[] = [
  "7d",
  "30d",
  "31d",
  "month",
];

/** What a caller that sends no `range` gets. ⚠ Moving it moves the activity
 *  strip's window — it is the one caller that never sends one. */
export const WORKSPACE_SERIES_DEFAULT_RANGE: WorkspaceSeriesRange = "31d";

/** The three the Overview's range switcher offers. */
export const WORKSPACE_SERIES_SWITCHER_RANGES: readonly WorkspaceSeriesRange[] =
  ["7d", "30d", "month"];

/**
 * Daily-binned series behind the overview histogram. Read by
 * `GET /api/workspaces/[workspaceSlug]/overview-series?metric=[&range=]`.
 * Oldest first, ending on the current UTC day (except `month`, which draws the
 * whole calendar month) — zero-filled so the chart never has to gap-fill.
 */
export interface WorkspaceOverviewSeries {
  metric: OverviewSeriesMetric;
  /** ⚠ **OPTIONAL ON THE READ SIDE (INVARIANTS §8): this payload is
   *  IndexedDB-persisted and an entry written before wave 8 carries neither
   *  `range` nor `truncated`.** */
  range?: WorkspaceSeriesRange;
  days: OverviewSeriesPoint[];
  /** TRUE when the `credits` haul came back AT its ceiling; always false for the
   *  counted metrics, which have no cliff (§9). */
  truncated?: boolean;
}

/**
 * One channel's share of this workspace's seat spend.
 *
 * 🔒 **FENCED TO THE CALLER'S VISIBLE CHANNELS, because this row prints a
 * NAME.** `server/service-overview.ts` states the workspace's two fencing
 * postures — aggregate INTEGERS are workspace-wide, anything carrying CONTENT is
 * viewer-filtered server-side — and a channel name is content. The by-person and
 * by-tool rails carry no channel identity and stay workspace-wide, which is also
 * why this rail does not sum to the series.
 */
export interface WorkspaceChannelUsage {
  channelId: string;
  name: string;
  credits: number;
  messages: number;
}

/**
 * One member's share of this workspace's seat spend.
 *
 * 🔒 **ONLY PEOPLE THE MEMBERS CONSOLE WOULD SHOW THE CALLER GET A ROW** — this
 * one prints a NAME, and the roster is the fence
 * (`server/service-usage.ts › tallyWorkspacePeople`). Departure is a row
 * DELETE, so a departed colleague has no role and no row here; their spend
 * still counts on the series, which is integers.
 */
export interface WorkspacePersonUsage {
  userId: string;
  name: string;
  /** The container role from `workspace_members` — the guest marker's source. */
  role: Role;
  credits: number;
}

/** One `(tool, op)` pair's call count. ⚠ There is no MCP SERVER column in the
 *  schema; this is the finest grain that exists. */
export interface WorkspaceToolUsage {
  tool: string;
  op: string;
  calls: number;
}

/**
 * The three comparison rails on the workspace Overview — the breakdown R-29(b)
 * moved across from /home, over the CURRENT CALENDAR MONTH.
 *
 * ⚠ **THE WINDOW IS THE CREDIT PERIOD AND THE RANGE SWITCHER DOES NOT MOVE
 * IT** — the same split /home makes: the capacity figure and the rails answer
 * for the billing period, the plot is the thing with controls on it.
 */
export interface WorkspaceUsageBreakdown {
  /** Window start, ISO-8601 UTC. */
  since: string;
  /** Descending by `credits`. */
  channels: WorkspaceChannelUsage[];
  /** Descending by `credits`. */
  people: WorkspacePersonUsage[];
  /** Descending by `calls`. */
  tools: WorkspaceToolUsage[];
  /** Rows the scans covered — the denominator travels with the shares (§9). */
  scanned: number;
  /** TRUE when a scan came back AT its ceiling; the rails are then a FLOOR and
   *  the surface has to say so. */
  truncated: boolean;
}

/**
 * One live agent session in this workspace.
 *
 * 🔒 **PUBLIC COLUMNS ONLY, AND THE OMISSIONS ARE THE CONTRACT — the same
 * seven this shape's /home twin refuses (`home/overview-types.ts ›
 * HomeAgentRow`).** No `model`, no `toolLabel`, no `tokensSpent`, no context
 * pair: those are the OPERATOR-ONLY telemetry columns
 * (`20260822150000_channel_sessions_telemetry.sql`), and R-29's privacy half
 * says a peer learns THAT an agent is working, never what it costs its operator.
 * ⚠ **Do not widen this interface** — the repository's column list and this
 * shape are the fence on a service-role path.
 */
export interface OverviewAgentRow {
  id: string;
  channelId: string;
  channelName: string;
  name: string;
  /** `working` / `idle` — anything the desktop has not reported as `ended`
   *  (R-25: everyone's LIVE agents, ended ones hidden). */
  state: string;
  /** One of six CLOSED situation keys, or `null`. */
  detail: string | null;
  threadTitle: string | null;
  threadId: string | null;
  /** TRUE when this session runs on the CALLER'S machine. ⚠ The only thing
   *  separating "mine" from "theirs", and it names no peer. */
  mine: boolean;
  updatedAt: string;
}

/** One run's token spend. ⚠ An INSTANT, never a day: the server cannot know
 *  the operator's zone, so the renderer buckets (`20260927120000` §"DAYS ARE
 *  DERIVED"). */
export interface WorkspaceTokenSpendMark {
  at: string;
  tokens: number;
}

/**
 * Payload of `GET /api/workspaces/[workspaceSlug]/token-spend`.
 *
 * 🔒 **THE CALLER'S OWN AGENTS IN THIS CONTAINER, AND THERE IS NO
 * WORKSPACE-WIDE FIGURE** — the wave-8 fence decision, argued once in
 * INVARIANTS §9.
 */
export interface WorkspaceTokenSpend {
  marks: WorkspaceTokenSpendMark[];
  truncated: boolean;
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
    /** Non-direct, non-deleted channels. ⚠ The archived exclusion went with the
     *  archive feature (R-21, 2026-09-17). */
    channels: number;
  };
  // ⚠ `activity: OverviewActivityRow[]` STOOD HERE AND IS DELETED (Samuel,
  // 2026-09-18: remove the Activity panel completely). The row type, the
  // service's `mergeActivity`, and the three repository reads that fed it went
  // with it — the panel was the payload's only reader. ⚠ An OLDER desktop
  // bundle reads `.activity` UNGUARDED, so this is a wire break the version
  // gate is what covers (`dopl-desktop-app/main/version-gate.js`).
  /**
   * Top members by 30-day user-authored message count, at most 6 rows,
   * descending. `totalMessages` is the shared denominator.
   */
  memberLoad: {
    totalMessages: number;
    rows: OverviewMemberLoadRow[];
  };
  /**
   * The credit BREAKDOWN — by channel, person and tool (R-29(b), wave 8).
   *
   * ⚠ **OPTIONAL, AND EVERY READ SPELLS `?? EMPTY_X` INLINE (INVARIANTS §8).**
   * This payload is IndexedDB-persisted, so an entry written before wave 8 has
   * no `usage` key at all and a `.map` over it throws the whole page away.
   */
  usage?: WorkspaceUsageBreakdown;
  /**
   * EVERYONE'S LIVE agents in this container, newest activity first (R-25).
   * ⚠ NOT window-scoped — a session row is live STATE, not an event.
   * ⚠ Optional for the same stale-cache reason as {@link usage}.
   */
  agents?: OverviewAgentRow[];
}

/**
 * Absent-fallbacks for the wave-8 array keys, per INVARIANTS §8.
 *
 * ⚠ FROZEN and shared: they reach render paths directly, so a caller that
 * pushed into one would be editing every other caller's fallback.
 *
 * ⚠ **`EMPTY_WORKSPACE_CHANNEL_USAGE` CARRIES THE CONTAINER PREFIX BECAUSE IT
 * IS NOT INTERCHANGEABLE WITH /home's `EMPTY_CHANNEL_USAGE`** — that row is
 * keyed `workspaceId`, this one `channelId`. The person and tool fallbacks had
 * no such difference and were a second symbol under the SAME name; they are
 * `home/overview-types.ts`'s now, and only there.
 */
export const EMPTY_OVERVIEW_AGENTS: readonly OverviewAgentRow[] =
  Object.freeze([]);
export const EMPTY_WORKSPACE_CHANNEL_USAGE: readonly WorkspaceChannelUsage[] =
  Object.freeze([]);
export const EMPTY_SERIES_DAYS: readonly OverviewSeriesPoint[] =
  Object.freeze([]);

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
