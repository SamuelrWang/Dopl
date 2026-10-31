import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { canManageKeys } from "../portal/scope";
import type { Environment } from "../types";
import { refuseInternalUnlessOwner, requireProject } from "./portal-admin";
import { parseEnv } from "./portal-http";
import { WebhookApiError, createEndpoint, replayDelivery, updateEndpoint } from "./webhooks/api";
import { kickWebhookSender, webhookApiDeps } from "./webhooks/runtime";

/**
 * Webhook endpoint writes from a signed-in owner or admin. The `/v1` API authorises by key; the same
 * `webhooks/api.ts` runs here, so URL checks, tenancy and the once-only secret are the same code.
 * A delivery or endpoint in another project reads 404 through the store's tenant filter.
 */

async function tenantOf(userId: string, projectId: string, env: unknown): Promise<{ projectId: string; env: Environment }> {
  const parsedEnv = parseEnv(env);
  const project = await requireProject(userId, projectId);
  if (!canManageKeys(project.role)) throw new HttpError(403, "FORBIDDEN", "Only an org owner or admin can manage webhooks");
  // An internal org's events carry every Dopl user's device traffic, so who receives them is the owner's call.
  refuseInternalUnlessOwner(project);
  return { projectId: project.id, env: parsedEnv };
}

async function clean<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof WebhookApiError) throw new HttpError(err.code === "not_found" ? 404 : 400, err.code === "not_found" ? "NOT_FOUND" : "BAD_REQUEST", err.message);
    throw err;
  }
}

export async function addWebhookEndpoint(userId: string, projectId: string, body: Record<string, unknown>) {
  const t = await tenantOf(userId, projectId, body.env);
  return clean(() => createEndpoint(webhookApiDeps, t, { url: body.url, description: body.description, enabled_events: body.enabled_events }));
}

export async function setWebhookPaused(userId: string, endpointId: string, body: Record<string, unknown>) {
  const t = await tenantOf(userId, String(body.project ?? ""), body.env);
  if (typeof body.paused !== "boolean") throw new HttpError(400, "BAD_REQUEST", "paused must be true or false");
  return clean(() => updateEndpoint(webhookApiDeps, t, endpointId, { disabled: body.paused }));
}

export async function sendWebhookAgain(userId: string, deliveryId: string, body: Record<string, unknown>) {
  const t = await tenantOf(userId, String(body.project ?? ""), body.env);
  const delivery = await clean(() => replayDelivery(webhookApiDeps, t, deliveryId));
  kickWebhookSender();
  return delivery;
}
