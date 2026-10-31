import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Environment } from "../types";
import type { KeyView, MetricRow } from "../portal/view";
import { dayOf } from "../portal/view";
import { lockedKeyIds } from "./keys";
import { emailOf } from "./portal-admin";

/**
 * API keys as the Keys page shows them. Never selects `key_hash` into a result.
 * 🔒 DOPL'S OWN DELIVERY KEY IS LOCKED: `DOPL_APP_SDK_KEY` is how the app reaches devices, so rotating or
 * revoking it from a button would stop glasses delivery until the environment changes (PLAN section 2).
 */

export async function readKeyViews(projectId: string, env: Environment, internal: boolean, metrics: readonly MetricRow[], now: Date): Promise<KeyView[]> {
  const { data, error } = await supabaseAdmin()
    .from("dev_api_keys")
    .select("id, kind, prefix, name, created_by, scopes, created_at, last_used_at, revoked_at, expires_at")
    .eq("project_id", projectId)
    .eq("env", env)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`readKeyViews failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; kind: "secret" | "publishable"; prefix: string; name: string | null; created_by: string | null; scopes: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null; expires_at: string | null }>;
  const weekStart = dayOf(now.getTime(), 6);
  const calls = new Map<string, number>();
  for (const m of metrics) if (m.key && m.day >= weekStart) calls.set(m.key, (calls.get(m.key) ?? 0) + m.calls);
  const creators = [...new Set(rows.map((r) => r.created_by).filter((v): v is string => v !== null))];
  const emails = new Map(await Promise.all(creators.map(async (id) => [id, (await emailOf(id)).email] as const)));
  const locked = new Set(await lockedKeyIds(projectId, internal));
  const kindName = { secret: "Secret key", publishable: "Publishable key" };
  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? `${env === "live" ? "Live" : "Test"} ${kindName[r.kind].toLowerCase()}`,
    kind: r.kind,
    prefix: r.prefix,
    scopes: r.scopes,
    createdAt: r.created_at,
    createdBy: r.created_by ? (emails.get(r.created_by) ?? null) : null,
    lastUsedAt: r.last_used_at,
    calls7d: calls.get(r.id) ?? 0,
    revokedAt: r.revoked_at,
    expiresAt: r.expires_at,
    locked: locked.has(r.id),
  }));
}
