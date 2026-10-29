import {
  ListQuerySchema,
  WebhookEndpointCreateRequestSchema,
  WebhookEndpointUpdateRequestSchema,
  WebhookSecretRotateRequestSchema,
  type ErrorCode,
  type ListResponse,
  type WebhookAttempt,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEndpointWithSecret,
} from "../../types";
import { webhookEventId } from "./envelope";
import { generateWebhookSecret, webhookMessageId } from "./signing";
import type { AttemptRow, DeliveryRow, EndpointRow, ListPosition, Tenant, WebhookStore } from "./store-types";
import { checkEndpointUrl, type Resolver } from "./url-guard";

/**
 * The webhook endpoint API (`/v1/webhook_endpoints*`, `/v1/webhook_deliveries/*`): validation,
 * the SSRF register-time check, tenancy, row → contract mapping and list cursors. Routes are thin
 * wrappers; every refusal is a {@link WebhookApiError} the route turns into the C10 error.
 * ⚠ The secret leaves the server only in the create and rotate answers.
 */

export class WebhookApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string
  ) {
    super(message);
    this.name = "WebhookApiError";
  }
}

export interface WebhookApiDeps {
  store: WebhookStore;
  resolve?: Resolver;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): WebhookApiError {
  const i = error.issues[0];
  const where = i?.path.length ? `${i.path.map(String).join(".")}: ` : "";
  return new WebhookApiError("invalid_request", `${where}${i?.message ?? "invalid body"}`);
}

const notFound = (what: string) => new WebhookApiError("not_found", `No such ${what}.`);

function requireId(id: string, what: string): string {
  if (!UUID.test(id)) throw notFound(what);
  return id.toLowerCase();
}

async function checkedUrl(deps: WebhookApiDeps, raw: string): Promise<string> {
  const r = await checkEndpointUrl(raw, deps.resolve);
  if (!r.ok) throw new WebhookApiError("invalid_request", `url: ${r.reason}`);
  return r.url;
}

const isoOrNull = (v: string | null) => (v ? new Date(v).toISOString() : null);

export function toEndpoint(r: EndpointRow, now: Date = new Date()): WebhookEndpoint {
  const prev = r.previous_secret_expires_at && Date.parse(r.previous_secret_expires_at) > now.getTime() ? r.previous_secret_expires_at : null;
  return {
    id: r.id,
    url: r.url,
    description: r.description,
    enabled_events: r.enabled_events,
    status: r.disabled_at ? "disabled" : "enabled",
    livemode: r.env === "live",
    previous_secret_expires_at: isoOrNull(prev),
    created_at: new Date(r.created_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
  };
}

export function toAttempt(a: AttemptRow): WebhookAttempt {
  return {
    attempt: a.attempt,
    attempted_at: new Date(a.attempted_at).toISOString(),
    status_code: a.status_code,
    error: a.error,
    duration_ms: a.duration_ms,
    response_body: a.response_body,
  };
}

export function toDelivery(d: DeliveryRow, attempts?: AttemptRow[]): WebhookDelivery {
  return {
    id: d.id,
    endpoint_id: d.endpoint_id,
    message_id: webhookMessageId(d.id),
    event_id: webhookEventId(d.outbox_id),
    event_type: d.event_type,
    status: d.status,
    attempt_count: d.attempts,
    next_attempt_at: d.status === "pending" ? new Date(d.next_attempt_at).toISOString() : null,
    last_status_code: d.last_status_code,
    last_error: d.last_error,
    delivered_at: isoOrNull(d.delivered_at),
    created_at: new Date(d.created_at).toISOString(),
    ...(attempts ? { attempts: attempts.map(toAttempt) } : {}),
  };
}

// ── list cursors: opaque base64url of `<created_at ISO>|<uuid>` ──
export function encodeCursor(p: ListPosition): string {
  return Buffer.from(`${new Date(p.createdAt).toISOString()}|${p.id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string): ListPosition {
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const [createdAt, id, extra] = text.split("|");
  if (extra !== undefined || !createdAt || !id || !UUID.test(id) || Number.isNaN(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) {
    throw new WebhookApiError("invalid_request", "cursor: not a cursor this list returned");
  }
  return { createdAt, id };
}

function parseList(search: URLSearchParams): { after: ListPosition | null; limit: number } {
  const parsed = ListQuerySchema.safeParse({
    cursor: search.get("cursor") ?? undefined,
    limit: search.get("limit") ?? undefined,
  });
  if (!parsed.success) throw invalid(parsed.error);
  return { after: parsed.data.cursor ? decodeCursor(parsed.data.cursor) : null, limit: parsed.data.limit };
}

async function page<R extends { created_at: string; id: string }, T>(
  fetch: (after: ListPosition | null, limit: number) => Promise<R[]>,
  search: URLSearchParams,
  map: (r: R) => T
): Promise<ListResponse<T>> {
  const { after, limit } = parseList(search);
  const rows = await fetch(after, limit + 1);
  const has_more = rows.length > limit;
  const kept = rows.slice(0, limit);
  const last = kept[kept.length - 1];
  return {
    data: kept.map(map),
    next_cursor: has_more && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
    has_more,
  };
}

// ── operations ──

export async function createEndpoint(deps: WebhookApiDeps, t: Tenant, body: unknown): Promise<WebhookEndpointWithSecret> {
  const parsed = WebhookEndpointCreateRequestSchema.safeParse(body);
  if (!parsed.success) throw invalid(parsed.error);
  const url = await checkedUrl(deps, parsed.data.url);
  const secret = generateWebhookSecret();
  const row = await deps.store.createEndpoint(t, {
    url,
    description: parsed.data.description ?? null,
    enabledEvents: parsed.data.enabled_events ? [...new Set(parsed.data.enabled_events)] : null,
    secret,
  });
  return { ...toEndpoint(row), secret };
}

export async function listEndpoints(deps: WebhookApiDeps, t: Tenant, search: URLSearchParams): Promise<ListResponse<WebhookEndpoint>> {
  return page((after, limit) => deps.store.listEndpoints(t, after, limit), search, (r) => toEndpoint(r));
}

export async function getEndpoint(deps: WebhookApiDeps, t: Tenant, id: string): Promise<WebhookEndpoint> {
  const row = await deps.store.getEndpoint(t, requireId(id, "webhook endpoint"));
  if (!row) throw notFound("webhook endpoint");
  return toEndpoint(row);
}

export async function updateEndpoint(deps: WebhookApiDeps, t: Tenant, id: string, body: unknown): Promise<WebhookEndpoint> {
  const parsed = WebhookEndpointUpdateRequestSchema.safeParse(body);
  if (!parsed.success) throw invalid(parsed.error);
  const b = parsed.data;
  const patch: Parameters<WebhookStore["updateEndpoint"]>[2] = {};
  if (b.url !== undefined) patch.url = await checkedUrl(deps, b.url);
  if (b.description !== undefined) patch.description = b.description;
  if (b.enabled_events !== undefined) patch.enabled_events = b.enabled_events ? [...new Set(b.enabled_events)] : null;
  if (b.disabled !== undefined) patch.disabled_at = b.disabled ? new Date().toISOString() : null;
  const row = await deps.store.updateEndpoint(t, requireId(id, "webhook endpoint"), patch);
  if (!row) throw notFound("webhook endpoint");
  return toEndpoint(row);
}

export async function deleteEndpoint(deps: WebhookApiDeps, t: Tenant, id: string): Promise<{ id: string; deleted: true }> {
  const key = requireId(id, "webhook endpoint");
  if (!(await deps.store.deleteEndpoint(t, key))) throw notFound("webhook endpoint");
  return { id: key, deleted: true };
}

export async function rotateSecret(deps: WebhookApiDeps, t: Tenant, id: string, body: unknown): Promise<WebhookEndpointWithSecret> {
  const parsed = WebhookSecretRotateRequestSchema.safeParse(body === undefined ? {} : body);
  if (!parsed.success) throw invalid(parsed.error);
  const secret = generateWebhookSecret();
  const row = await deps.store.rotateSecret(t, requireId(id, "webhook endpoint"), secret, parsed.data.overlap_seconds);
  if (!row) throw notFound("webhook endpoint");
  return { ...toEndpoint(row), secret };
}

export async function listDeliveries(
  deps: WebhookApiDeps,
  t: Tenant,
  endpointId: string,
  search: URLSearchParams
): Promise<ListResponse<WebhookDelivery>> {
  const key = requireId(endpointId, "webhook endpoint");
  if (!(await deps.store.getEndpoint(t, key))) throw notFound("webhook endpoint");
  return page((after, limit) => deps.store.listDeliveries(t, key, after, limit), search, (d) => toDelivery(d));
}

export async function getDelivery(deps: WebhookApiDeps, t: Tenant, id: string): Promise<WebhookDelivery> {
  const row = await deps.store.getDelivery(t, requireId(id, "webhook delivery"));
  if (!row) throw notFound("webhook delivery");
  return toDelivery(row, await deps.store.attemptsFor([row.id]));
}

export async function replayDelivery(deps: WebhookApiDeps, t: Tenant, id: string): Promise<WebhookDelivery> {
  const key = requireId(id, "webhook delivery");
  const cur = await deps.store.getDelivery(t, key);
  if (!cur) throw notFound("webhook delivery");
  const endpoint = await deps.store.getEndpoint(t, cur.endpoint_id);
  if (!endpoint || endpoint.disabled_at) {
    throw new WebhookApiError("invalid_request", "The delivery's endpoint is disabled. Enable it before replaying.");
  }
  const row = await deps.store.replay(t, key);
  if (!row) throw notFound("webhook delivery");
  return toDelivery(row);
}
