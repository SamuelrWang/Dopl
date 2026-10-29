import { randomUUID } from "node:crypto";
import type { Environment, WebhookEventName } from "../../types";
import type { AttemptRow, DeliveryRow, EndpointRow, ListPosition, Tenant, WebhookStore } from "./store-types";

/**
 * In-memory {@link WebhookStore} for tests. Mirrors the SQL RPCs' semantics
 * (`20261123100000_device_sdk_webhook_sender.sql`): fan-out to enabled matching endpoints once per
 * (event, endpoint), api_version stamped at fan-out, leased claims, atomic attempt record, replay
 * with a fresh budget, rotation overlap. `clock` drives every "now()".
 */

export interface FakeOutbox {
  id: string;
  project_id: string;
  env: Environment;
  event_type: WebhookEventName;
  payload: Record<string, unknown>;
  status: "pending" | "delivered" | "failed";
}

interface FakeEndpoint extends EndpointRow {
  secret: string;
  previous_secret: string | null;
}

export function fakeWebhookStore(opts: { apiVersion?: string } = {}) {
  const clock = { now: new Date("2026-10-28T12:00:00Z") };
  const outbox: FakeOutbox[] = [];
  const endpoints: FakeEndpoint[] = [];
  const deliveries: Array<DeliveryRow & { locked_until: string | null }> = [];
  const attempts: AttemptRow[] = [];
  const iso = () => clock.now.toISOString();
  const tick = () => {
    // Strictly increasing timestamps so keyset order is deterministic.
    clock.now = new Date(clock.now.getTime() + 1);
    return iso();
  };

  const strip = (e: FakeEndpoint): EndpointRow => {
    const row: Partial<FakeEndpoint> = { ...e };
    delete row.secret;
    delete row.previous_secret;
    return row as EndpointRow;
  };
  const strip2 = (d: DeliveryRow & { locked_until: string | null }): DeliveryRow => {
    const row: Partial<typeof d> = { ...d };
    delete row.locked_until;
    return row as DeliveryRow;
  };
  const owns = (t: Tenant, r: { project_id: string; env: Environment }) => r.project_id === t.projectId && r.env === t.env;
  const before = (after: ListPosition | null) => (r: { created_at: string; id: string }) =>
    !after || r.created_at < after.createdAt || (r.created_at === after.createdAt && r.id < after.id);
  const newestFirst = (a: { created_at: string; id: string }, b: { created_at: string; id: string }) =>
    b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);

  const store: WebhookStore = {
    async fanOut(limit) {
      const picked = outbox.filter((o) => o.status === "pending").slice(0, limit);
      for (const o of picked) {
        for (const e of endpoints) {
          if (e.project_id !== o.project_id || e.env !== o.env || e.disabled_at) continue;
          if (e.enabled_events && !e.enabled_events.includes(o.event_type)) continue;
          if (deliveries.some((d) => d.outbox_id === o.id && d.endpoint_id === e.id)) continue;
          const at = tick();
          deliveries.push({
            id: randomUUID(),
            outbox_id: o.id,
            endpoint_id: e.id,
            project_id: o.project_id,
            env: o.env,
            event_type: o.event_type,
            status: "pending",
            attempts: 0,
            next_attempt_at: at,
            last_status_code: null,
            last_error: null,
            delivered_at: null,
            created_at: at,
            updated_at: at,
            locked_until: null,
          });
        }
        if (!("api_version" in o.payload)) o.payload = { ...o.payload, api_version: opts.apiVersion ?? "2026-10-27" };
        o.status = "delivered";
      }
      return picked.length;
    },

    async claim(limit, leaseSeconds) {
      const now = clock.now.getTime();
      const due = deliveries
        .filter((d) => d.status === "pending" && Date.parse(d.next_attempt_at) <= now)
        .filter((d) => !d.locked_until || Date.parse(d.locked_until) < now)
        .sort((a, b) => a.next_attempt_at.localeCompare(b.next_attempt_at))
        .slice(0, limit);
      for (const d of due) d.locked_until = new Date(now + leaseSeconds * 1000).toISOString();
      return due.map(strip2);
    },

    async payloads(ids) {
      return new Map(outbox.filter((o) => ids.includes(o.id)).map((o) => [o.id, structuredClone(o.payload)]));
    },

    async endpointsById(ids) {
      return new Map(endpoints.filter((e) => ids.includes(e.id)).map((e) => [e.id, strip(e)]));
    },

    async secretsFor(ids) {
      const now = clock.now.getTime();
      return new Map(
        endpoints
          .filter((e) => ids.includes(e.id))
          .map((e) => [
            e.id,
            {
              endpoint_id: e.id,
              secret: e.secret,
              previous_secret:
                e.previous_secret && e.previous_secret_expires_at && Date.parse(e.previous_secret_expires_at) > now
                  ? e.previous_secret
                  : null,
            },
          ])
      );
    },

    async recordAttempt(id, o) {
      const d = deliveries.find((x) => x.id === id);
      if (!d) return null;
      const n = Math.max(0, ...attempts.filter((a) => a.delivery_id === id).map((a) => a.attempt)) + 1;
      const at = tick();
      attempts.push({
        id: randomUUID(),
        delivery_id: id,
        attempt: n,
        attempted_at: at,
        status_code: o.statusCode,
        error: o.error?.slice(0, 500) ?? null,
        duration_ms: Math.max(0, Math.round(o.durationMs)),
        response_body: o.responseBody?.slice(0, 1024) ?? null,
      });
      d.attempts += 1;
      d.status = o.success ? "delivered" : o.nextAttemptAt ? "pending" : "failed";
      if (!o.success && o.nextAttemptAt) d.next_attempt_at = o.nextAttemptAt.toISOString();
      if (o.success) d.delivered_at = at;
      d.locked_until = null;
      d.last_status_code = o.statusCode;
      d.last_error = o.error?.slice(0, 500) ?? null;
      d.updated_at = at;
      return strip2(d);
    },

    async createEndpoint(t, input) {
      const at = tick();
      const e: FakeEndpoint = {
        id: randomUUID(),
        project_id: t.projectId,
        env: t.env,
        url: input.url,
        description: input.description,
        enabled_events: input.enabledEvents,
        previous_secret_expires_at: null,
        disabled_at: null,
        created_at: at,
        updated_at: at,
        secret: input.secret,
        previous_secret: null,
      };
      endpoints.push(e);
      return strip(e);
    },

    async getEndpoint(t, id) {
      const e = endpoints.find((x) => x.id === id && owns(t, x));
      return e ? strip(e) : null;
    },

    async listEndpoints(t, after, limit) {
      return endpoints.filter((e) => owns(t, e)).filter(before(after)).sort(newestFirst).slice(0, limit).map(strip);
    },

    async updateEndpoint(t, id, patch) {
      const e = endpoints.find((x) => x.id === id && owns(t, x));
      if (!e) return null;
      Object.assign(e, patch, { updated_at: tick() });
      return strip(e);
    },

    async deleteEndpoint(t, id) {
      const i = endpoints.findIndex((x) => x.id === id && owns(t, x));
      if (i < 0) return false;
      endpoints.splice(i, 1);
      for (let j = deliveries.length - 1; j >= 0; j--) if (deliveries[j].endpoint_id === id) deliveries.splice(j, 1);
      return true;
    },

    async rotateSecret(t, id, secret, overlapSeconds) {
      const e = endpoints.find((x) => x.id === id && owns(t, x));
      if (!e) return null;
      if (overlapSeconds === 0) {
        e.previous_secret = null;
        e.previous_secret_expires_at = null;
      } else {
        e.previous_secret = e.secret;
        e.previous_secret_expires_at = new Date(clock.now.getTime() + overlapSeconds * 1000).toISOString();
      }
      e.secret = secret;
      e.updated_at = tick();
      return strip(e);
    },

    async listDeliveries(t, endpointId, after, limit) {
      return deliveries
        .filter((d) => d.endpoint_id === endpointId && owns(t, d))
        .filter(before(after))
        .sort(newestFirst)
        .slice(0, limit)
        .map(strip2);
    },

    async getDelivery(t, id) {
      const d = deliveries.find((x) => x.id === id && owns(t, x));
      return d ? strip2(d) : null;
    },

    async attemptsFor(ids) {
      return attempts.filter((a) => ids.includes(a.delivery_id)).sort((a, b) => b.attempt - a.attempt);
    },

    async replay(t, id) {
      const d = deliveries.find((x) => x.id === id && owns(t, x));
      if (!d) return null;
      Object.assign(d, { status: "pending", attempts: 0, next_attempt_at: iso(), locked_until: null, updated_at: tick() });
      return strip2(d);
    },
  };

  const enqueue = (t: Tenant, type: WebhookEventName, data: Record<string, unknown> = {}): FakeOutbox => {
    const id = randomUUID();
    const row: FakeOutbox = {
      id,
      project_id: t.projectId,
      env: t.env,
      event_type: type,
      payload: { id: `evt_${id}`, type, timestamp: iso(), livemode: t.env === "live", data },
      status: "pending",
    };
    outbox.push(row);
    return row;
  };

  return { store, clock, outbox, endpoints, deliveries, attempts, enqueue };
}
