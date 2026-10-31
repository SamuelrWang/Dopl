import "server-only";
import { after } from "next/server";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { CapabilityId, ErrorCode, EventOutcome } from "../types";
import { connectStore } from "./connect/store";
import { enqueueWebhookEvent } from "./connect/webhooks";
import { flushDevEvents, logDevEvent } from "./events";

/**
 * `dev_events` rows for traffic that never crosses `withDeveloperKey`, so the portal log tells the
 * whole story: a notice that fell back to the prosumer queue, the hosted Connect steps, a person's
 * message from a device, and an agent reply mirrored to a lens.
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
    flushLater();
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

/** Work that must never slow the request. Outside a request scope (a script, a suite) it does not run. */
function afterResponse(work: () => Promise<void>): void {
  try {
    after(work);
  } catch {
    // No request scope.
  }
}

/** Where an inbound message came from. Structural: the channels stamp (`message-source-stamp.ts`) fits it. */
export interface InboundSource {
  kind: string;
  device_id?: string;
}

/** Only a Mac and glasses are logged sources (PLAN step 11); a web post is not a device. */
const INBOUND_DEVICE_KIND: Record<string, "desktop" | "glasses"> = { computer: "desktop", glasses: "glasses" };

/**
 * A person's message from a device, as one row with its text. Written after the response and only for a
 * user who has a Dopl App end user, so nobody else's channels reach this table.
 * Glasses speech also fires `input.utterance`, whose `data` carries the text.
 */
export function logInboundMessage(a: {
  userId: string;
  source: InboundSource;
  body: string;
  channelId: string;
  messageId: string;
}): void {
  const deviceKind = INBOUND_DEVICE_KIND[a.source.kind];
  if (!deviceKind) return;
  afterResponse(async () => {
    try {
      const owner = await doplAppEndUser(a.userId);
      if (!owner) return;
      const text = messageTextForRow(a.body);
      logDevEvent({
        org_id: owner.orgId,
        project_id: owner.projectId,
        env: "live",
        outcome: "ok",
        external_user_id: a.userId,
        device_id: a.source.device_id ?? null,
        device_kind: deviceKind,
        capability: deviceKind === "glasses" ? "input.utterance" : null,
        operation: deviceKind === "glasses" ? "message.from_glasses" : "message.from_desktop",
        message_text: text,
        channel_id: a.channelId,
        message_id: a.messageId,
      });
      await flushDevEvents();
      if (deviceKind === "glasses") {
        await enqueueWebhookEvent(connectStore, { projectId: owner.projectId, env: "live" }, "input.utterance", {
          type: "input.utterance",
          device_id: a.source.device_id ?? null,
          external_user_id: a.userId,
          ts: new Date().toISOString(),
          data: { text, channel_id: a.channelId, message_id: a.messageId },
        });
      }
    } catch (err) {
      console.warn("[device-sdk] inbound message row failed:", err);
    }
  });
}

/**
 * An agent's reply the mirror put on a lens (`glasses/core/messages/reply-mirror.ts`). The mirror uses
 * the prosumer queue, so no `/v1` call ever logs it. There is no router here: the device is the one
 * whose inbox ran the pass, and `considered` says so.
 */
export function logMirroredReply(a: { userId: string; deviceId: string; channelId: string; messageId: string; body: string }): void {
  const reason = "agent reply mirrored to the device reading this channel";
  afterResponse(async () => {
    try {
      const owner = await doplAppEndUser(a.userId);
      if (!owner) return;
      logDevEvent({
        org_id: owner.orgId,
        project_id: owner.projectId,
        env: "live",
        outcome: "ok",
        external_user_id: a.userId,
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
      await flushDevEvents();
    } catch (err) {
      console.warn("[device-sdk] mirrored reply row failed:", err);
    }
  });
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
