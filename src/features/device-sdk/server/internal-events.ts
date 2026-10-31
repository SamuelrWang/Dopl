import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { CapabilityId, DeviceKind, ErrorCode } from "../types";
import { connectStore } from "./connect/store";
import { enqueueWebhookEvent } from "./connect/webhooks";
import { afterResponse, flushDevEvents, flushDevEventsLater, logDevEvent, type DevEventInput } from "./events";

/**
 * `dev_events` rows for traffic that never crosses `withDeveloperKey`, so the portal log tells the
 * whole story: a notice that fell back to the prosumer queue, the hosted Connect steps, a person's
 * message from a device, an agent reply mirrored to a lens, and a local bridge's Cast outcome.
 * Fire-and-forget like every event: nothing here throws, and nothing fails the call it describes.
 */

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
    const row = await doplAppEndUser(userId);
    if (!row) return;
    logDevEvent({
      org_id: row.orgId,
      project_id: row.projectId,
      env: "live",
      outcome: "ok",
      external_user_id: userId,
      capability: a.capability,
      operation: a.operation,
      route_decision: { target: "glasses", reason: `prosumer queue: ${a.reason}`, candidates: [] },
    });
    flushDevEventsLater();
  } catch (err) {
    console.warn("[device-sdk] prosumer fallback row failed:", err);
  }
}

/** The Dopl user's end user under the internal project, or null for a user who has none. */
async function doplAppEndUser(userId: string): Promise<{ orgId: string; projectId: string } | null> {
  const { data, error } = await supabaseAdmin()
    .from("dev_end_users")
    .select("project_id, env, dev_projects!inner(org_id, dev_orgs!inner(internal))")
    .eq("external_user_id", userId)
    .eq("env", "live")
    .eq("dev_projects.dev_orgs.internal", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as unknown as { project_id: string; dev_projects: { org_id: string } } | null;
  return row ? { orgId: row.dev_projects.org_id, projectId: row.project_id } : null;
}

/** Longest message text a row keeps. Bounded so one post cannot bloat a batch that shares its fate. */
export const MESSAGE_TEXT_MAX_CHARS = 2000;

/** Pure: what a row stores for a message body. Empty is null, not "". */
export function messageTextForRow(body: string): string | null {
  const text = body.trim();
  return text ? text.slice(0, MESSAGE_TEXT_MAX_CHARS) : null;
}

/** One row for a Dopl user's message, written after the response. A user with no Dopl App end user writes nothing. */
function logMessageRow(
  userId: string,
  label: string,
  row: Omit<DevEventInput, "org_id" | "project_id" | "env" | "outcome" | "external_user_id">,
  afterWrite?: (owner: { projectId: string }) => Promise<void>
): void {
  afterResponse(async () => {
    try {
      const owner = await doplAppEndUser(userId);
      if (!owner) return;
      logDevEvent({ org_id: owner.orgId, project_id: owner.projectId, env: "live", outcome: "ok", external_user_id: userId, ...row });
      await flushDevEvents();
      await afterWrite?.(owner);
    } catch (err) {
      console.warn(`[device-sdk] ${label} row failed:`, err);
    }
  });
}

/** Only a Mac and glasses are logged sources (PLAN step 11); a web post is not a device. */
const INBOUND_DEVICE_KIND: Record<string, "desktop" | "glasses"> = { computer: "desktop", glasses: "glasses" };

/** A person's message from a device, as one row with its text. Glasses speech also fires `input.utterance`. */
export function logInboundMessage(a: {
  userId: string;
  source: { kind: string; device_id?: string };
  body: string;
  channelId: string;
  messageId: string;
}): void {
  const deviceKind = INBOUND_DEVICE_KIND[a.source.kind];
  if (!deviceKind) return;
  const glasses = deviceKind === "glasses";
  const deviceId = a.source.device_id ?? null;
  const text = messageTextForRow(a.body);
  logMessageRow(
    a.userId,
    "inbound message",
    {
      device_id: deviceId,
      device_kind: deviceKind,
      capability: glasses ? "input.utterance" : null,
      operation: glasses ? "message.from_glasses" : "message.from_desktop",
      message_text: text,
      channel_id: a.channelId,
      message_id: a.messageId,
    },
    glasses
      ? (owner) =>
          enqueueWebhookEvent(connectStore, { projectId: owner.projectId, env: "live" }, "input.utterance", {
            type: "input.utterance",
            device_id: deviceId,
            external_user_id: a.userId,
            ts: new Date().toISOString(),
            data: { text, channel_id: a.channelId, message_id: a.messageId },
          })
      : undefined
  );
}

/** An agent's reply the mirror put on a lens. It uses the prosumer queue, so no `/v1` call logs it, and no router chose the device. */
export function logMirroredReply(a: { userId: string; deviceId: string; channelId: string; messageId: string; body: string }): void {
  const reason = "agent reply mirrored to the device reading this channel";
  logMessageRow(a.userId, "mirrored reply", {
    device_id: a.deviceId,
    device_kind: "glasses",
    capability: "present.display",
    intent: "message",
    operation: "message.reply_mirror",
    route_decision: {
      target: a.deviceId,
      reason,
      candidates: [a.deviceId],
      considered: [{ device_id: a.deviceId, kind: "glasses", verdict: "chosen", reason }],
    },
    message_text: messageTextForRow(a.body),
    channel_id: a.channelId,
    message_id: a.messageId,
  });
}

/** One Cast outcome from a local bridge. Its text is kept only under an internal project. */
export async function logBridgeCast(a: {
  device: { id: string; projectId: string; env: "test" | "live"; endUserId: string; kind: DeviceKind };
  ok: boolean;
  actionId: string | null;
  latencyMs: number;
  body: string;
}): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("dev_end_users")
      .select("external_user_id, dev_projects!inner(org_id, dev_orgs!inner(internal))")
      .eq("id", a.device.endUserId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const owner = data as unknown as { external_user_id: string; dev_projects: { org_id: string; dev_orgs: { internal: boolean } } } | null;
    if (!owner) return;
    logDevEvent({
      org_id: owner.dev_projects.org_id,
      project_id: a.device.projectId,
      env: a.device.env,
      outcome: a.ok ? "ok" : "error",
      error_code: a.ok ? null : "vendor_error",
      external_user_id: owner.external_user_id,
      device_id: a.device.id,
      device_kind: a.device.kind,
      capability: "present.speak",
      action_id: a.actionId,
      operation: "bridge.cast",
      route: "/api/device-bridge/ack",
      http_method: "POST",
      http_status: 200,
      latency_ms: { device_delivery: Math.max(0, a.latencyMs) },
      message_text: owner.dev_projects.dev_orgs.internal ? messageTextForRow(a.body) : null,
    });
    flushDevEventsLater();
  } catch (err) {
    console.warn("[device-sdk] bridge cast row failed:", err);
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
    logDevEvent({
      org_id: orgId,
      project_id: a.session.project_id,
      env: a.session.env,
      outcome: a.status < 400 ? "ok" : "error",
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
    flushDevEventsLater();
  } catch (err) {
    console.warn("[device-sdk] connect step row failed:", err);
  }
}
