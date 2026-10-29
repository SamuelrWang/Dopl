import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Environment, WebhookDelivery, WebhookEndpoint } from "../types";
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
