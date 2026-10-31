import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { DeviceEventRow, Environment } from "../types";
import { modelOfAdapter } from "../portal/catalog";
import type { Call, CallStep, CallStatus, Considered } from "../portal/view";
import { readWebhookCalls } from "./portal-webhooks";

/**
 * THE ACTIVITY FEED: `dev_events` rows, each with its action, merged with webhook deliveries, newest first.
 * Service role; the caller passes a project it already checked.
 *
 * 🔒 TEXT: a message row's `message_text`, or for a delivery the queued message's own text. The queued text
 * is read only under an internal project (Samuel, "show the text"; docs/legal/PRIVACY.md section 2.13).
 * "Delivered" means the device took it. Nothing reports a render, so no step here says "seen".
 */

export const FEED_LIMIT = 300;

interface ActionRow {
  id: string;
  status: string;
  capability: string | null;
  intent: string | null;
  result: Record<string, unknown> | null;
  error: { code?: string; message?: string } | null;
  response: unknown;
  created_at: string;
  delivered_at: string | null;
  settled_at: string | null;
}

interface LensRow {
  id: string;
  status: string;
  payload: { title?: string; body?: string; question?: string } | null;
}

const lensIdOf = (a: ActionRow | undefined) => (typeof a?.result?.lens_message_id === "string" ? a.result.lens_message_id : null);

function lensText(row: LensRow | undefined): string | null {
  const p = row?.payload;
  if (!p) return null;
  return p.question ?? ([p.title, p.body].filter(Boolean).join(": ") || null);
}

export function callStatus(e: Pick<DeviceEventRow, "outcome" | "operation">, kind: Call["kind"], action: ActionRow | undefined, lens: LensRow | undefined): CallStatus {
  if (e.outcome === "denied") return "refused";
  if (e.outcome === "error") return "failed";
  if (kind === "message") return "received";
  if (kind === "request") return "ok";
  if (!action) return "delivered";
  if (action.status === "failed") return "failed";
  if (action.status === "queued" || action.status === "needs_confirmation") return "queued";
  if (action.status === "done") {
    if (action.result?.dismissed === true) return "dismissed";
    return typeof action.result?.label === "string" ? "answered" : "delivered";
  }
  return lens?.status === "expired" ? "expired" : "delivered";
}

const offsetFrom = (start: number, iso: string | null | undefined) => (iso ? Math.max(0, Date.parse(iso) - start) : undefined);

export function stepsOf(e: DeviceEventRow, action: ActionRow | undefined, status: CallStatus): CallStep[] {
  const end = Date.parse(e.ts);
  const start = end - (e.latency_ms?.api ?? 0);
  const steps: CallStep[] = [{ key: "accepted", label: "Accepted", at: 0, state: "done" }];
  const reason = e.route_decision?.reason;
  if (reason) steps.push({ key: "chosen", label: e.device_id ? "Device chosen" : "Routing", detail: reason, state: e.device_id ? "done" : "failed" });
  if (e.profile_id) steps.push({ key: "rules", label: "Rules applied", detail: `${e.profile_id} v${e.profile_version ?? 1}`, state: "done" });
  if (action) {
    steps.push({ key: "queued", label: "Queued", at: offsetFrom(start, action.created_at), state: "done" });
    const picked = action.delivered_at !== null || ["delivered", "done"].includes(action.status);
    steps.push({ key: "picked", label: "Picked up by device", at: offsetFrom(start, action.delivered_at), state: picked ? "done" : status === "failed" ? "failed" : "pending" });
    if (typeof action.result?.label === "string") steps.push({ key: "answered", label: "Answered", detail: action.result.label, at: offsetFrom(start, action.result.answered_at as string | undefined), state: "done" });
    if (status === "expired") steps.push({ key: "expired", label: "No answer", state: "failed" });
    if (action.error?.message) steps.push({ key: "failed", label: "Failed", detail: action.error.message, at: offsetFrom(start, action.settled_at), state: "failed" });
  } else if (e.error_code) {
    steps.push({ key: "failed", label: "Refused", detail: e.error_code, state: "failed" });
  }
  return steps;
}

function kindOf(e: DeviceEventRow): Call["kind"] {
  const op = e.operation ?? "";
  if (op === "message.from_desktop" || op === "message.from_glasses") return "message";
  if (e.capability && !e.capability.startsWith("input.") && op !== "action.read" && op !== "device.read" && !(e.route_decision?.reason ?? "").startsWith("poll:")) return "delivery";
  return "request";
}

const TITLE_OF_MESSAGE: Record<string, string> = { "message.from_desktop": "Message from Mac", "message.from_glasses": "Message from glasses" };

function titleOf(e: DeviceEventRow, text: string | null): string {
  if (text) return text;
  if (e.operation && TITLE_OF_MESSAGE[e.operation]) return TITLE_OF_MESSAGE[e.operation];
  if (e.capability) return e.capability;
  if (e.route) return `${e.http_method ?? "GET"} ${e.route.replace(/^\/api/, "")}`;
  return e.operation ?? "Call";
}

function consideredOf(e: DeviceEventRow): Considered[] {
  const list = e.route_decision?.considered;
  if (list) return list.map((c) => ({ deviceId: c.device_id, verdict: c.verdict, reason: c.reason }));
  return [];
}

/** The newest calls of one project and env. Polls stay out: they repeat a delivery, they are not one. */
export async function readCalls(input: { projectId: string; env: Environment; internal: boolean; limit?: number }): Promise<Call[]> {
  const db = supabaseAdmin();
  const limit = input.limit ?? FEED_LIMIT;
  const { data, error } = await db.from("dev_events").select("*").eq("project_id", input.projectId).eq("env", input.env).order("ts", { ascending: false }).limit(limit);
  if (error) throw new Error(`readCalls failed: ${error.message}`);
  const events = ((data ?? []) as DeviceEventRow[]).filter((e) => e.operation !== "action.read");

  const actionIds = [...new Set(events.map((e) => e.action_id).filter((v): v is string => Boolean(v)))];
  const actions = new Map<string, ActionRow>();
  if (actionIds.length > 0) {
    const res = await db.from("dev_actions").select("id, status, capability, intent, result, error, response, created_at, delivered_at, settled_at").eq("project_id", input.projectId).in("id", actionIds);
    if (res.error) throw new Error(`readCalls actions failed: ${res.error.message}`);
    for (const a of (res.data ?? []) as ActionRow[]) actions.set(a.id, a);
  }
  const lensIds = [...actions.values()].map(lensIdOf).filter((v): v is string => v !== null);
  const lens = new Map<string, LensRow>();
  if (input.internal && lensIds.length > 0) {
    const res = await db.from("dev_device_messages").select("id, status, payload").in("id", lensIds);
    if (res.error) throw new Error(`readCalls messages failed: ${res.error.message}`);
    for (const m of (res.data ?? []) as LensRow[]) lens.set(m.id, m);
  }
  const deviceIds = [...new Set(events.map((e) => e.device_id).filter((v): v is string => Boolean(v)))];
  const adapterOf = new Map<string, string>();
  if (deviceIds.length > 0) {
    const res = await db.from("devices").select("id, adapter_id").eq("project_id", input.projectId).in("id", deviceIds);
    if (res.error) throw new Error(`readCalls devices failed: ${res.error.message}`);
    for (const d of (res.data ?? []) as Array<{ id: string; adapter_id: string }>) adapterOf.set(d.id, d.adapter_id);
  }

  const calls: Call[] = events.map((e) => {
    const action = e.action_id ? actions.get(e.action_id) : undefined;
    const lensRow = lens.get(lensIdOf(action) ?? "");
    const kind = kindOf(e);
    const text = e.message_text ?? lensText(lensRow);
    const status = callStatus(e, kind, action, lensRow);
    const adapter = e.device_id ? adapterOf.get(e.device_id) : undefined;
    return {
      id: e.event_id,
      kind,
      at: e.ts,
      userId: e.external_user_id,
      deviceId: e.device_id,
      modelId: adapter ? modelOfAdapter(adapter) : null,
      capability: e.capability,
      status,
      errorCode: e.error_code,
      title: titleOf(e, text),
      text,
      latencyMs: e.latency_ms?.api ?? null,
      steps: kind === "delivery" ? stepsOf(e, action, status) : [],
      considered: consideredOf(e),
      route: e.route ? `${e.http_method ?? "GET"} ${e.route.replace(/^\/api/, "")}` : null,
      response: action?.response ?? (e.error_code ? { error: { code: e.error_code, request_id: e.event_id } } : null),
      webhook: null,
    };
  });

  const hooks = await readWebhookCalls(input.projectId, input.env, limit);
  return [...calls, ...hooks].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}
