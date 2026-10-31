import "server-only";
import { after } from "next/server";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { CapabilityId, ErrorCode, EventOutcome } from "../types";
import { flushDevEvents, logDevEvent } from "./events";

/**
 * `dev_events` rows for traffic that never crosses `withDeveloperKey`, so the portal log tells the
 * whole story: a notice that fell back to the prosumer queue, and the hosted Connect steps.
 * Fire-and-forget like every event: nothing here throws, and nothing fails the call it describes.
 */

/** Flush once the response is sent; outside a request scope (tests) the batch's own timer flushes it. */
function flushLater(): void {
  try {
    after(() => flushDevEvents());
  } catch {
    // No request scope.
  }
}

/**
 * A lens copy that went through the prosumer queue because the SDK could not take it. Logged under the
 * user's Dopl App end user; a user with none has no project to log under, so nothing is written.
 * ⚠ Without this row a refused SDK call reads as a failure beside a message that did arrive.
 */
export async function logProsumerFallback(
  userId: string,
  a: { operation: string; capability: CapabilityId; reason: string }
): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("dev_end_users")
      .select("project_id, env, dev_projects!inner(org_id, dev_orgs!inner(internal))")
      .eq("external_user_id", userId)
      .eq("env", "live")
      .eq("dev_projects.dev_orgs.internal", true)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as unknown as { project_id: string; env: "live"; dev_projects: { org_id: string } } | null;
    if (!row) return;
    logDevEvent({
      org_id: row.dev_projects.org_id,
      project_id: row.project_id,
      env: row.env,
      outcome: "ok",
      external_user_id: userId,
      capability: a.capability,
      operation: a.operation,
      route_decision: { target: "glasses", reason: `prosumer queue: ${a.reason}`, candidates: [] },
    });
    flushLater();
  } catch (err) {
    console.warn("[device-sdk] prosumer fallback row failed:", err);
  }
}

/** One hosted Connect step. The token is the credential, so `route` carries `:token`, never its value. */
export async function logConnectStep(a: {
  session: { project_id: string; env: "test" | "live"; external_user_id: string; device_id: string | null; connection_id: string | null };
  step: string;
  status: number;
  code: ErrorCode | null;
  latencyMs: number;
}): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin().from("dev_projects").select("org_id").eq("id", a.session.project_id).maybeSingle();
    if (error) throw new Error(error.message);
    const orgId = (data as { org_id: string } | null)?.org_id;
    if (!orgId) return;
    const outcome: EventOutcome = a.status < 400 ? "ok" : "error";
    logDevEvent({
      org_id: orgId,
      project_id: a.session.project_id,
      env: a.session.env,
      outcome,
      error_code: a.code,
      external_user_id: a.session.external_user_id,
      connection_id: a.session.connection_id,
      device_id: a.session.device_id,
      operation: `connect.${a.step}`,
      http_method: "POST",
      route: `/api/connect/:token/${a.step}`,
      http_status: a.status,
      latency_ms: { api: Math.max(0, Math.round(a.latencyMs)) },
    });
    flushLater();
  } catch (err) {
    console.warn("[device-sdk] connect step row failed:", err);
  }
}
