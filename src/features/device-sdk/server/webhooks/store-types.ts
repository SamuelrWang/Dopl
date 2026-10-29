import type { Environment, WebhookEventName } from "../../types";

/**
 * Every DB operation the webhook sender and the endpoint API need. `store-supabase.ts` is the
 * service-role implementation (all state moves through the SQL RPCs of
 * `20261123100000_device_sdk_webhook_sender.sql`); `fake-store.ts` the in-memory one tests drive.
 * Secrets cross this boundary only on create / rotate (returned once) and `secretsFor` (signing).
 */

export type DeliveryStatus = "pending" | "delivered" | "failed";

export interface EndpointRow {
  id: string;
  project_id: string;
  env: Environment;
  url: string;
  description: string | null;
  enabled_events: WebhookEventName[] | null;
  previous_secret_expires_at: string | null;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeliveryRow {
  id: string;
  outbox_id: string;
  endpoint_id: string;
  project_id: string;
  env: Environment;
  event_type: WebhookEventName;
  status: DeliveryStatus;
  attempts: number;
  next_attempt_at: string;
  last_status_code: number | null;
  last_error: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A delivery leased to one sender run; `claim_token` must be passed back to record its attempt. */
export type ClaimedDelivery = DeliveryRow & { claim_token: string };

export interface AttemptRow {
  id: string;
  delivery_id: string;
  attempt: number;
  attempted_at: string;
  status_code: number | null;
  error: string | null;
  duration_ms: number;
  response_body: string | null;
}

export interface EndpointSecrets {
  endpoint_id: string;
  secret: string;
  /** Set only while the rotation overlap lasts. */
  previous_secret: string | null;
}

export interface AttemptOutcome {
  statusCode: number | null;
  error: string | null;
  durationMs: number;
  responseBody: string | null;
  success: boolean;
  /** Next try, or null = dead-letter. Ignored when `success`. */
  nextAttemptAt: Date | null;
}

export interface Tenant {
  projectId: string;
  env: Environment;
}

/** A keyset position inside one list: `(created_at, id)` of the last row returned. */
export interface ListPosition {
  createdAt: string;
  id: string;
}

export interface WebhookStore {
  // ── sender ──
  /** Fan pending outbox events out to matching endpoints; returns events fanned out. */
  fanOut(limit: number): Promise<number>;
  /** Drop rotated-out secrets whose overlap ended; returns how many. */
  pruneExpiredSecrets(): Promise<number>;
  /** Lease due deliveries to this run. */
  claim(limit: number, leaseSeconds: number): Promise<ClaimedDelivery[]>;
  /** The webhook bodies of these outbox rows, keyed by outbox id. */
  payloads(outboxIds: readonly string[]): Promise<Map<string, Record<string, unknown>>>;
  endpointsById(ids: readonly string[]): Promise<Map<string, EndpointRow>>;
  secretsFor(endpointIds: readonly string[]): Promise<Map<string, EndpointSecrets>>;
  /**
   * Record one attempt. Lands only if the delivery is still `pending` under this claim token;
   * otherwise writes nothing and answers null (stale sender, or replayed meanwhile).
   */
  recordAttempt(deliveryId: string, claimToken: string, outcome: AttemptOutcome): Promise<DeliveryRow | null>;

  // ── endpoint API ──
  createEndpoint(
    t: Tenant,
    input: { url: string; description: string | null; enabledEvents: WebhookEventName[] | null; secret: string }
  ): Promise<EndpointRow>;
  getEndpoint(t: Tenant, id: string): Promise<EndpointRow | null>;
  listEndpoints(t: Tenant, after: ListPosition | null, limit: number): Promise<EndpointRow[]>;
  updateEndpoint(
    t: Tenant,
    id: string,
    patch: Partial<{ url: string; description: string | null; enabled_events: WebhookEventName[] | null; disabled_at: string | null }>
  ): Promise<EndpointRow | null>;
  deleteEndpoint(t: Tenant, id: string): Promise<boolean>;
  rotateSecret(t: Tenant, id: string, secret: string, overlapSeconds: number): Promise<EndpointRow | null>;
  listDeliveries(t: Tenant, endpointId: string, after: ListPosition | null, limit: number): Promise<DeliveryRow[]>;
  getDelivery(t: Tenant, id: string): Promise<DeliveryRow | null>;
  attemptsFor(deliveryIds: readonly string[]): Promise<AttemptRow[]>;
  /** Null when no such delivery OR it is being sent right now (live lease). */
  replay(t: Tenant, id: string): Promise<DeliveryRow | null>;
}
