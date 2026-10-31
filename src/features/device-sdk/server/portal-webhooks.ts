import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Environment, WebhookDelivery, WebhookEndpoint } from "../types";
import { dayOf, endpointFailing, type Call, type CallStatus, type EndpointView } from "../portal/view";
import { toDelivery, toEndpoint } from "./webhooks/api";
import type { AttemptRow } from "./webhooks/store-types";
import { ATTEMPT_COLS, DELIVERY_COLS, ENDPOINT_COLS, pickDelivery, pickEndpoint } from "./webhooks/store-supabase";

/**
 * DEVELOPER PORTAL WEBHOOK READS. Service role, server only, read only. Same rule as `portal.ts`:
 * the caller's reach is decided by `listPortalProjects`; every read here takes a project id the
 * page already checked against it and filters on `(project_id, env)`.
 * ⚠ Endpoint reads use `ENDPOINT_COLS`, which never names `secret_id` / `previous_secret_id`.
 */

/** Delivery page size for one endpoint. */
export const PORTAL_DELIVERY_LIMIT = 50;

/** Endpoints of one project and env, newest first. */
export async function listPortalWebhookEndpoints(projectId: string, env: Environment): Promise<WebhookEndpoint[]> {
  const { data, error } = await supabaseAdmin()
    .from("dev_webhook_endpoints")
    .select(ENDPOINT_COLS)
    .eq("project_id", projectId)
    .eq("env", env)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw new Error(`listPortalWebhookEndpoints failed: ${error.message}`);
  const now = new Date();
  return ((data ?? []) as Record<string, unknown>[]).map((r) => toEndpoint(pickEndpoint(r), now));
}

/**
 * The newest deliveries of one endpoint, each with its HTTP attempts (newest attempt first). Fenced
 * on `project_id` and `env` too, so an endpoint id from another project reads nothing.
 */
export async function listPortalWebhookDeliveries(
  endpointId: string,
  projectId: string,
  env: Environment,
  limit: number = PORTAL_DELIVERY_LIMIT
): Promise<WebhookDelivery[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("dev_webhook_deliveries")
    .select(DELIVERY_COLS)
    .eq("endpoint_id", endpointId)
    .eq("project_id", projectId)
    .eq("env", env)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listPortalWebhookDeliveries failed: ${error.message}`);
  const rows = ((data ?? []) as Record<string, unknown>[]).map(pickDelivery);
  if (rows.length === 0) return [];

  const attempts = await db
    .from("dev_webhook_attempts")
    .select(ATTEMPT_COLS)
    .in(
      "delivery_id",
      rows.map((d) => d.id)
    )
    .order("attempt", { ascending: false });
  if (attempts.error) throw new Error(`listPortalWebhookDeliveries failed: ${attempts.error.message}`);
  const byDelivery = new Map<string, AttemptRow[]>();
  for (const a of (attempts.data ?? []) as AttemptRow[]) {
    const list = byDelivery.get(a.delivery_id);
    if (list) list.push(a);
    else byDelivery.set(a.delivery_id, [a]);
  }
  return rows.map((d) => toDelivery(d, byDelivery.get(d.id) ?? []));
}

const STATS_LIMIT = 5000;
const FEED_DAYS = 31;

interface DeliveryStatRow {
  endpoint_id: string;
  status: string;
  created_at: string;
}

const noteOf = (a: { status_code: number | null; error: string | null }) =>
  a.error ?? (a.status_code === null ? "No reply" : a.status_code < 300 ? "Accepted" : `Answered ${a.status_code}`);

/** Every endpoint of one project and env, with its last week. A never-seen endpoint reads no figures, not a perfect one. */
export async function readEndpointViews(projectId: string, env: Environment, now: Date): Promise<EndpointView[]> {
  const db = supabaseAdmin();
  const endpoints = await listPortalWebhookEndpoints(projectId, env);
  if (endpoints.length === 0) return [];
  const week = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const { data, error } = await db
    .from("dev_webhook_deliveries")
    .select("endpoint_id, status, created_at")
    .eq("project_id", projectId)
    .eq("env", env)
    .gte("created_at", week)
    .order("created_at", { ascending: false })
    .limit(STATS_LIMIT);
  if (error) throw new Error(`readEndpointViews failed: ${error.message}`);
  const rows = (data ?? []) as DeliveryStatRow[];
  return endpoints.map((e) => {
    const mine = rows.filter((r) => r.endpoint_id === e.id);
    const delivered = mine.filter((r) => r.status === "delivered").length;
    const failed = mine.filter((r) => r.status === "failed").length;
    const settled = mine.filter((r) => r.status !== "pending").map((r) => ({ failed: r.status === "failed", at: r.created_at }));
    const bars = Array.from({ length: 7 }, (_, i) => mine.filter((r) => r.created_at.slice(0, 10) === dayOf(now.getTime(), 6 - i)).length);
    const top = Math.max(...bars, 1);
    return {
      id: e.id,
      name: e.description ?? new URL(e.url).hostname,
      url: e.url,
      events: e.enabled_events,
      state: e.status === "disabled" ? "paused" : endpointFailing(settled, now.getTime()) ? "failing" : "healthy",
      sent7d: mine.length,
      delivered7d: delivered,
      failed7d: failed,
      rate: delivered + failed === 0 ? 0 : Math.round((delivered / (delivered + failed)) * 1000) / 10,
      lastAt: mine[0]?.created_at ?? null,
      bars: bars.map((n) => (n / top) * 100),
    };
  });
}

/** Webhook deliveries as feed rows, with attempts and the event's real payload. */
export async function readWebhookCalls(projectId: string, env: Environment, limit: number): Promise<Call[]> {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - FEED_DAYS * 86_400_000).toISOString();
  const { data, error } = await db
    .from("dev_webhook_deliveries")
    .select("id, outbox_id, endpoint_id, event_type, status, attempts, last_status_code, last_error, created_at")
    .eq("project_id", projectId)
    .eq("env", env)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`readWebhookCalls failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; outbox_id: string; endpoint_id: string; event_type: string; status: string; attempts: number; last_status_code: number | null; last_error: string | null; created_at: string }>;
  if (rows.length === 0) return [];
  const [endpoints, attempts, outbox] = await Promise.all([
    db.from("dev_webhook_endpoints").select("id, url, description").eq("project_id", projectId).eq("env", env),
    db.from("dev_webhook_attempts").select("delivery_id, attempt, attempted_at, status_code, error").in("delivery_id", rows.map((r) => r.id)).order("attempt", { ascending: true }),
    db.from("dev_webhook_outbox").select("id, payload").eq("project_id", projectId).in("id", rows.map((r) => r.outbox_id)),
  ]);
  for (const res of [endpoints, attempts, outbox]) if (res.error) throw new Error(`readWebhookCalls failed: ${res.error.message}`);
  const names = new Map(((endpoints.data ?? []) as Array<{ id: string; url: string; description: string | null }>).map((e) => [e.id, e.description ?? new URL(e.url).hostname]));
  const payloads = new Map(((outbox.data ?? []) as Array<{ id: string; payload: unknown }>).map((o) => [o.id, o.payload]));
  const tries = (attempts.data ?? []) as Array<{ delivery_id: string; attempted_at: string; status_code: number | null; error: string | null }>;
  return rows.map((d) => {
    const status: CallStatus = d.status === "delivered" ? "ok" : d.status === "failed" ? "failed" : "retrying";
    return {
      id: d.id,
      kind: "webhook",
      at: d.created_at,
      userId: null,
      deviceId: null,
      modelId: null,
      capability: null,
      status,
      errorCode: d.last_error ? (d.last_status_code ? `http_${d.last_status_code}` : "no_reply") : null,
      title: d.event_type,
      text: null,
      latencyMs: null,
      steps: [],
      considered: [],
      route: null,
      response: null,
      webhook: {
        endpointId: d.endpoint_id,
        endpointName: names.get(d.endpoint_id) ?? d.endpoint_id,
        event: d.event_type,
        attempts: tries.filter((a) => a.delivery_id === d.id).map((a) => ({ at: a.attempted_at, status: a.status_code, note: noteOf(a) })),
        payload: payloads.get(d.outbox_id) ?? null,
      },
    };
  });
}
