import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { logCursor, parseLogCursor } from "../portal/scope";
import { DEFAULT_EVENT_RETENTION_DAYS } from "./events";
import {
  CAPABILITY_IDS,
  DELIVER_INTENTS,
  DEVICE_KINDS,
  EVENT_OUTCOMES,
  ListQuerySchema,
  PublicDeviceEventSchema,
  toPublicDeviceEvent,
  type CapabilityId,
  type DeliverIntent,
  type DeviceEventRow,
  type DeviceKind,
  type Environment,
  type EventListResponse,
  type EventOutcome,
  type ListQuery,
} from "../types";

/**
 * `GET /v1/events` READS (P3, spec `listEvents`): one key's project + env, newest first, as the
 * PUBLIC event shape (`@dopl/device-contracts › PublicDeviceEventSchema`).
 *
 * 🔒 REACH: the project and env come ONLY from the verified key (`withDeveloperKey`). No query
 * param names a project, so one key can never read another project's or the other env's log.
 *
 * 🔒 THE CURSOR IS OPAQUE: base64url of the W1.3 keyset `<ts as stored, µs>~<event_id>`. Clients
 * get it back and pass it on; the server decodes it and re-validates both halves with the same
 * strict parser the portal uses (`scope.ts › parseLogCursor`), so nothing a client writes reaches
 * the PostgREST `or` filter unvalidated. A cursor that does not decode to that shape is
 * `invalid_request`, never "first page".
 */

/** `GET /v1/events` reads per key per minute. The limiter fails closed (an RPC error reads as over). */
export const EVENTS_READS_PER_MINUTE = 60;

/** Default window when `since` is absent. */
export const EVENTS_DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** The oldest a read reaches back. Older `since` reads as this. */
export const EVENTS_MAX_WINDOW_MS = DEFAULT_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Same token rule as the portal's free-text filters: no PostgREST syntax characters. */
const ROUTE_TOKEN = /^[A-Za-z0-9_.:@-]{1,128}$/;

export interface EventListQuery extends ListQuery {
  sinceIso: string;
  outcome: EventOutcome | null;
  deviceKind: DeviceKind | null;
  capability: CapabilityId | null;
  intent: DeliverIntent | null;
  route: string | null;
  /** The decoded cursor, validated. */
  after: { ts: string; eventId: string } | null;
}

type ParsedEventQuery = { ok: true; query: EventListQuery } | { ok: false; message: string };

export function encodeEventCursor(row: { ts: string; event_id: string }): string {
  return Buffer.from(logCursor(row), "utf8").toString("base64url");
}

/** The cursor's keyset, or null when it is not one this server wrote. */
export function decodeEventCursor(cursor: string): { ts: string; eventId: string } | null {
  let raw: string;
  try {
    raw = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return null;
  }
  // Re-encoding must give the same string back, so no lenient decode (stray chars, padding) slips by.
  if (Buffer.from(raw, "utf8").toString("base64url") !== cursor) return null;
  return parseLogCursor(raw);
}

function enumParam<T extends string>(sp: URLSearchParams, name: string, set: readonly T[]): T | null | Error {
  const v = sp.get(name);
  if (v === null) return null;
  return (set as readonly string[]).includes(v) ? (v as T) : new Error(`${name} must be one of ${set.join(", ")}.`);
}

/**
 * The query string → a validated query. Every refusal is a sentence for `invalid_request`.
 * Unknown params are ignored; a known param with a bad value is refused (a filter silently
 * dropped would widen the read).
 */
export function parseEventListQuery(sp: URLSearchParams, now: Date): ParsedEventQuery {
  const list = ListQuerySchema.safeParse({
    cursor: sp.get("cursor") ?? undefined,
    limit: sp.get("limit") ?? undefined,
  });
  if (!list.success) {
    const field = list.error.issues[0]?.path[0];
    return {
      ok: false,
      message: field === "limit" ? "limit must be an integer from 1 to 100." : "cursor is not a cursor this API returned.",
    };
  }
  let after: EventListQuery["after"] = null;
  if (list.data.cursor !== undefined) {
    after = decodeEventCursor(list.data.cursor);
    if (!after) return { ok: false, message: "cursor is not a cursor this API returned." };
  }

  const floor = now.getTime() - EVENTS_MAX_WINDOW_MS;
  let since = now.getTime() - EVENTS_DEFAULT_WINDOW_MS;
  const sinceRaw = sp.get("since");
  if (sinceRaw !== null) {
    const t = Date.parse(sinceRaw);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(sinceRaw) || Number.isNaN(t)) {
      return { ok: false, message: "since must be an ISO 8601 date and time." };
    }
    since = Math.max(t, floor);
  }

  const outcome = enumParam(sp, "outcome", EVENT_OUTCOMES);
  const deviceKind = enumParam(sp, "device_kind", DEVICE_KINDS);
  const capability = enumParam(sp, "capability", CAPABILITY_IDS);
  const intent = enumParam(sp, "intent", DELIVER_INTENTS);
  for (const v of [outcome, deviceKind, capability, intent]) if (v instanceof Error) return { ok: false, message: v.message };
  const route = sp.get("route");
  if (route !== null && !ROUTE_TOKEN.test(route)) {
    return { ok: false, message: "route must be 1 to 128 letters, digits or _ . : @ -." };
  }

  return {
    ok: true,
    query: {
      limit: list.data.limit,
      cursor: list.data.cursor,
      after,
      sinceIso: new Date(since).toISOString(),
      outcome: outcome as EventOutcome | null,
      deviceKind: deviceKind as DeviceKind | null,
      capability: capability as CapabilityId | null,
      intent: intent as DeliverIntent | null,
      route,
    },
  };
}

/**
 * PostgREST returns `ts` as `…+00:00`; the contract's `ts` is ISO with `Z`. Swap the zero offset for
 * `Z` and keep every fraction digit (a `Date` round-trip would cut µs to ms). The CURSOR is built
 * from the stored string, not this one.
 */
export function utcZ(ts: string): string {
  if (/[+-]00:00$/.test(ts)) return `${ts.slice(0, -6)}Z`;
  if (ts.endsWith("Z")) return ts;
  const t = Date.parse(ts);
  return Number.isNaN(t) ? ts : new Date(t).toISOString();
}

/** 🔒 Only what the public shape shows, so `org_id`, costs and message text never leave the database for this read. */
const PUBLIC_COLUMNS = Object.keys(PublicDeviceEventSchema.shape).join(", ");

/** One page of the key's own log. */
export async function listPublicEvents(input: {
  projectId: string;
  env: Environment;
  query: EventListQuery;
}): Promise<EventListResponse> {
  const { projectId, env, query: f } = input;
  let q = supabaseAdmin()
    .from("dev_events")
    .select(PUBLIC_COLUMNS)
    .eq("project_id", projectId)
    .eq("env", env)
    .gte("ts", f.sinceIso);
  if (f.outcome) q = q.eq("outcome", f.outcome);
  if (f.deviceKind) q = q.eq("device_kind", f.deviceKind);
  if (f.capability) q = q.eq("capability", f.capability);
  if (f.intent) q = q.eq("intent", f.intent);
  if (f.route) q = q.eq("route_decision->>target", f.route);
  if (f.after) {
    // Both halves were validated by `parseLogCursor` (PG timestamp + UUID); quoted so `+00:00` and
    // the fraction dot read as data.
    q = q.or(`ts.lt."${f.after.ts}",and(ts.eq."${f.after.ts}",event_id.lt.${f.after.eventId})`);
  }
  const { data, error } = await q
    .order("ts", { ascending: false })
    .order("event_id", { ascending: false })
    .limit(f.limit + 1);
  if (error) throw new Error(`listPublicEvents failed: ${error.message}`);
  const all = (data ?? []) as unknown as DeviceEventRow[];
  const rows = all.slice(0, f.limit);
  const more = all.length > f.limit;
  return {
    data: rows.map((r) => ({ ...toPublicDeviceEvent(r), ts: utcZ(r.ts) })),
    next_cursor: more ? encodeEventCursor(rows[rows.length - 1]) : null,
    has_more: more,
  };
}
