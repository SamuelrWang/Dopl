/**
 * DEVELOPER PORTAL SCOPE (W1.3, Plans/Dopl SDK Split › §9). Pure: no DB, no React.
 *
 * Everything the `/developers` pages select lives in the URL, so a view is linkable and every
 * read happens on the server: `?project=<id|all>&env=<test|live>` plus the log filters below.
 * `parsePortalParams` turns raw search params into a closed, validated shape (an unknown value
 * reads as "no filter" ONLY where no filter is the narrower answer; ids are matched against the
 * caller's own projects, never trusted); `portalHref` writes it back.
 */
import {
  DEVICE_KINDS,
  ENVIRONMENTS,
  EVENT_OUTCOMES,
  type DeviceKind,
  type Environment,
  type EventOutcome,
} from "../types";

/** A dev org role (`dev_org_members.role`; the org's `owner_user_id` reads as `owner`). */
export type PortalRole = "owner" | "admin" | "developer";

/** One project the signed-in developer can see, with the org it hangs off. */
export interface PortalProject {
  id: string;
  name: string;
  apiVersion: string;
  org: { id: string; name: string; internal: boolean };
  role: PortalRole;
}

/** Who may rotate keys. A `developer` member reads only. */
export function canManageKeys(role: PortalRole): boolean {
  return role === "owner" || role === "admin";
}

export const LOG_WINDOWS = ["1h", "24h", "7d", "30d"] as const;
export type LogWindow = (typeof LOG_WINDOWS)[number];
export const LOG_WINDOW_MS: Record<LogWindow, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/** The log's filters. `null` = not filtered on. */
export interface LogFilters {
  outcome: EventOutcome | null;
  deviceKind: DeviceKind | null;
  /** `route_decision.target`: what the caller asked to route to (`auto`, a kind, a device id). */
  route: string | null;
  capability: string | null;
  intent: string | null;
  window: LogWindow;
  /** Include traffic from internal orgs (`dev_orgs.internal`, e.g. "Dopl App"). */
  internal: boolean;
  /** Keyset cursor: only rows strictly older than this ISO timestamp. */
  before: string | null;
  /** The event open in the detail pane. */
  event: string | null;
}

export interface PortalParams {
  /** A project id the caller can see, or `"all"` (every project they can see). */
  project: string | "all";
  env: Environment;
  filters: LogFilters;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A free-text filter value: short, printable, no PostgREST syntax characters. */
const TOKEN = /^[A-Za-z0-9_.:@-]{1,128}$/;

function first(raw: RawSearchParams, key: string): string | null {
  const v = raw[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.length > 0 ? s : null;
}

function oneOf<T extends string>(value: string | null, set: readonly T[]): T | null {
  return value !== null && (set as readonly string[]).includes(value) ? (value as T) : null;
}

function token(value: string | null): string | null {
  return value !== null && TOKEN.test(value) ? value : null;
}

function isoOrNull(value: string | null): string | null {
  if (value === null) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Raw search params → the portal's state. `project` falls back to the caller's first project
 * when absent or not theirs (a foreign id never reaches a query). `env` defaults to `test`.
 */
export function parsePortalParams(raw: RawSearchParams, projects: readonly PortalProject[]): PortalParams {
  const wanted = first(raw, "project");
  const project =
    wanted === "all"
      ? "all"
      : wanted !== null && UUID.test(wanted) && projects.some((p) => p.id === wanted)
        ? wanted
        : (projects[0]?.id ?? "all");
  const eventId = first(raw, "event");
  return {
    project,
    env: oneOf(first(raw, "env"), ENVIRONMENTS) ?? "test",
    filters: {
      outcome: oneOf(first(raw, "outcome"), EVENT_OUTCOMES),
      deviceKind: oneOf(first(raw, "kind"), DEVICE_KINDS),
      route: token(first(raw, "route")),
      capability: token(first(raw, "capability")),
      intent: token(first(raw, "intent")),
      window: oneOf(first(raw, "window"), LOG_WINDOWS) ?? "24h",
      internal: first(raw, "internal") !== "0",
      before: isoOrNull(first(raw, "before")),
      event: eventId !== null && UUID.test(eventId) ? eventId : null,
    },
  };
}

/**
 * The project ids a log read covers. `"all"` = every visible project; with `internal` off,
 * projects of internal orgs drop out (their calls are real, but they are Dopl's own traffic).
 */
export function logProjectIds(params: PortalParams, projects: readonly PortalProject[]): string[] {
  const inScope = params.project === "all" ? projects : projects.filter((p) => p.id === params.project);
  return inScope.filter((p) => params.filters.internal || !p.org.internal).map((p) => p.id);
}

/** State → `?query` (defaults omitted so URLs stay short). */
export function portalQuery(params: PortalParams): string {
  const q = new URLSearchParams();
  q.set("project", params.project);
  q.set("env", params.env);
  const f = params.filters;
  if (f.outcome) q.set("outcome", f.outcome);
  if (f.deviceKind) q.set("kind", f.deviceKind);
  if (f.route) q.set("route", f.route);
  if (f.capability) q.set("capability", f.capability);
  if (f.intent) q.set("intent", f.intent);
  if (f.window !== "24h") q.set("window", f.window);
  if (!f.internal) q.set("internal", "0");
  if (f.before) q.set("before", f.before);
  if (f.event) q.set("event", f.event);
  return q.toString();
}

/** A copy of `params` with some filters changed; a filter change resets paging and the open row. */
export function withFilters(params: PortalParams, patch: Partial<LogFilters>): PortalParams {
  const resets = Object.keys(patch).some((k) => k !== "before" && k !== "event");
  return {
    ...params,
    filters: { ...params.filters, ...(resets ? { before: null, event: null } : {}), ...patch },
  };
}

export const EMPTY_FILTERS: LogFilters = {
  outcome: null,
  deviceKind: null,
  route: null,
  capability: null,
  intent: null,
  window: "24h",
  internal: true,
  before: null,
  event: null,
};
