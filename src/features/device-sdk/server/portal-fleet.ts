import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Environment } from "../types";
import { modelOfAdapter } from "../portal/catalog";
import { dayOf, deviceState, type MetricRow, type OwnedDevice, type PortalUser } from "../portal/view";
import { wiredDeviceAdapters } from "./device-adapters";
import { emailOf } from "./portal-admin";

/**
 * USERS, DEVICES AND FIGURES for `/developers`. Service role, server only. The caller passes a project it
 * already checked with `listPortalProjects`; every read filters on that project and env.
 *
 * ⚠ READS `dev_events` THROUGH `dev_portal_metrics`, NOT `dev_billable_events`: this is what happened, for the
 * person looking at it. Billing still reads the view only, so an internal project's activity never bills.
 */

const METRIC_DAYS = 31;
const MAX_FLEET = 1000;
/** Looking up a name is one auth call each, so an internal project's list stops here. */
const MAX_NAME_LOOKUPS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function must<T>(res: { data: T | null; error: { message: string } | null }, op: string): T {
  if (res.error) throw new Error(`${op} failed: ${res.error.message}`);
  return res.data as T;
}

export async function readMetrics(projectId: string, env: Environment, now: Date): Promise<MetricRow[]> {
  const res = await supabaseAdmin().rpc("dev_portal_metrics", {
    p_project: projectId,
    p_env: env,
    p_since: new Date(now.getTime() - METRIC_DAYS * 86_400_000).toISOString(),
  });
  return (must(res, "readMetrics") ?? []) as MetricRow[];
}

interface DeviceRow {
  id: string;
  adapter_id: string;
  kind: string;
  firmware: string | null;
  display_name: string;
  end_user_id: string;
  last_seen: string | null;
  created_at: string;
}

async function isOnline(row: DeviceRow): Promise<boolean> {
  if (!row.last_seen) return false;
  const adapter = wiredDeviceAdapters.get(row.adapter_id);
  if (!adapter) return false;
  const health = await adapter.health({
    id: row.id,
    kind: row.kind as never,
    vendor: "",
    model: "",
    firmware: row.firmware,
    adapter_id: row.adapter_id,
    adapter_version: adapter.version,
    capabilities: [],
    online: false,
    last_seen_at: new Date(row.last_seen).toISOString(),
  });
  return health.online;
}

/** Inside an internal project the id is the Dopl user's own, so their account can name them. */
async function namesFromAccounts(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    ids
      .filter((id) => UUID.test(id))
      .slice(0, MAX_NAME_LOOKUPS)
      .map(async (id) => {
        const { email } = await emailOf(id);
        if (email) out.set(id, email);
      })
  );
  return out;
}

/** Every end user of the project with their live devices. A revoked device or connection is gone from here. */
export async function readFleet(input: { projectId: string; env: Environment; internal: boolean; metrics: readonly MetricRow[]; now: Date }): Promise<PortalUser[]> {
  const db = supabaseAdmin();
  const now = input.now.getTime();
  const [usersRes, devicesRes, connectionsRes] = await Promise.all([
    db.from("dev_end_users").select("id, external_user_id, display_name, created_at").eq("project_id", input.projectId).eq("env", input.env).order("created_at", { ascending: true }).limit(MAX_FLEET),
    db
      .from("devices")
      .select("id, adapter_id, kind, firmware, display_name, end_user_id, last_seen, created_at")
      .eq("project_id", input.projectId)
      .eq("env", input.env)
      .is("revoked_at", null)
      .limit(MAX_FLEET),
    db.from("connections").select("device_id, status, expires_at, granted_scopes, created_at").eq("project_id", input.projectId).eq("env", input.env).neq("status", "revoked").limit(MAX_FLEET),
  ]);
  const users = must(usersRes, "readFleet users") as unknown as Array<{ id: string; external_user_id: string; display_name: string | null; created_at: string }>;
  const devices = must(devicesRes, "readFleet devices") as unknown as DeviceRow[];
  const connections = must(connectionsRes, "readFleet connections") as unknown as Array<{ device_id: string; status: string; expires_at: string | null; granted_scopes: string[]; created_at: string }>;

  const connectionOf = new Map(connections.map((c) => [c.device_id, c]));
  const weekStart = dayOf(now, 6);
  const perDevice = new Map<string, { deliveries: number; delivered: number }>();
  const lastDelivery = new Map<string, string>();
  for (const r of input.metrics) {
    if (r.user && r.last_delivery && (lastDelivery.get(r.user) ?? "") < r.last_delivery) lastDelivery.set(r.user, r.last_delivery);
    if (!r.device || r.day < weekStart) continue;
    const had = perDevice.get(r.device) ?? { deliveries: 0, delivered: 0 };
    perDevice.set(r.device, { deliveries: had.deliveries + r.deliveries, delivered: had.delivered + r.delivered });
  }

  const online = new Map(await Promise.all(devices.map(async (d) => [d.id, await isOnline(d)] as const)));
  const names = input.internal ? await namesFromAccounts(users.filter((u) => !u.display_name).map((u) => u.external_user_id)) : new Map<string, string>();

  return users.map((u) => {
    const owned: OwnedDevice[] = [];
    for (const d of devices) {
      const connection = connectionOf.get(d.id);
      const modelId = modelOfAdapter(d.adapter_id);
      if (d.end_user_id !== u.id || !connection || !modelId) continue;
      const figures = perDevice.get(d.id);
      owned.push({
        id: d.id,
        userId: u.external_user_id,
        name: d.display_name,
        modelId,
        state: deviceState({ connectionStatus: connection.status, expiresAt: connection.expires_at, online: online.get(d.id) ?? false, lastSeenAt: d.last_seen, now }),
        firmware: d.firmware,
        lastSeenAt: d.last_seen,
        pairedAt: connection.created_at,
        grants: connection.granted_scopes,
        deliveries7d: figures?.deliveries ?? 0,
        delivered7d: figures?.delivered ?? 0,
      });
    }
    const active = owned.filter((d) => d.state === "online").sort((a, b) => Date.parse(b.lastSeenAt ?? "0") - Date.parse(a.lastSeenAt ?? "0"))[0];
    const seen = owned.map((d) => d.lastSeenAt).filter((v): v is string => v !== null).map((v) => Date.parse(v));
    const delivery = lastDelivery.get(u.external_user_id) ?? null;
    const latest = Math.max(0, ...seen, delivery ? Date.parse(delivery) : 0);
    const name = u.display_name ?? names.get(u.external_user_id) ?? null;
    return {
      id: u.external_user_id,
      name: name ?? u.external_user_id,
      named: name !== null,
      devices: owned,
      activeDeviceId: active?.id ?? null,
      lastDeliveryAt: delivery,
      lastActiveAt: latest ? new Date(latest).toISOString() : null,
      createdAt: u.created_at,
    };
  });
}
