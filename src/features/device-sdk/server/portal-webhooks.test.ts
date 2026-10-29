/**
 * Developer portal webhook reads against a recording fake of `supabaseAdmin()` (the pattern of
 * `portal.test.ts`): each query's table and filter chain is captured, canned rows come back per table.
 *
 * The properties that fail quietly:
 *  - 🔒 endpoint reads never select `secret_id` / `previous_secret_id`.
 *  - 🔒 every read is fenced on the caller's `(project_id, env)`, deliveries on the endpoint too.
 *  - attempts are read only for the deliveries returned, and attach to the right delivery.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; ops: Array<[string, ...unknown[]]> };
const calls: Call[] = [];
const canned = new Map<string, { data?: unknown }>();

function query(table: string) {
  const call: Call = { table, ops: [] };
  calls.push(call);
  const result = () => ({ data: canned.get(table)?.data ?? [], error: null });
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "eq", "in", "order", "limit"]) {
    chain[op] = (...args: unknown[]) => {
      call.ops.push([op, ...args]);
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown) => resolve(result());
  return chain;
}

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: () => ({ from: (t: string) => query(t) }) }));

import { PORTAL_DELIVERY_LIMIT, listPortalWebhookDeliveries, listPortalWebhookEndpoints } from "./portal-webhooks";

const tables = () => calls.map((c) => c.table);
const opsOn = (table: string) => calls.filter((c) => c.table === table).flatMap((c) => c.ops);

const EP = "11111111-1111-4111-8111-111111111111";
const D1 = "22222222-2222-4222-8222-222222222222";
const D2 = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  calls.length = 0;
  canned.clear();
});

describe("listPortalWebhookEndpoints", () => {
  it("is fenced to project and env, never selects secrets, and maps to the contract", async () => {
    canned.set("dev_webhook_endpoints", {
      data: [
        {
          id: EP,
          project_id: "p1",
          env: "live",
          url: "https://example.com/hook",
          description: null,
          enabled_events: null,
          previous_secret_expires_at: null,
          disabled_at: "2026-10-27T00:00:00.000Z",
          created_at: "2026-10-26T00:00:00.000Z",
          updated_at: "2026-10-27T00:00:00.000Z",
          secret_id: "should-not-leak",
        },
      ],
    });
    const out = await listPortalWebhookEndpoints("p1", "live");
    const ops = opsOn("dev_webhook_endpoints");
    expect(ops).toContainEqual(["eq", "project_id", "p1"]);
    expect(ops).toContainEqual(["eq", "env", "live"]);
    const select = String(ops.find((o) => o[0] === "select")?.[1]);
    expect(select).not.toContain("secret_id");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: EP, status: "disabled", livemode: true, enabled_events: null });
    expect(JSON.stringify(out)).not.toContain("should-not-leak");
  });
});

describe("listPortalWebhookDeliveries", () => {
  const delivery = (id: string, status: string) => ({
    id,
    outbox_id: "44444444-4444-4444-8444-444444444444",
    endpoint_id: EP,
    project_id: "p1",
    env: "test",
    event_type: "connection.created",
    status,
    attempts: 2,
    next_attempt_at: "2026-10-28T12:00:00.000Z",
    last_status_code: 500,
    last_error: null,
    delivered_at: null,
    created_at: "2026-10-28T11:00:00.000Z",
    updated_at: "2026-10-28T11:00:00.000Z",
  });
  const attempt = (deliveryId: string, n: number) => ({
    id: `a-${deliveryId}-${n}`,
    delivery_id: deliveryId,
    attempt: n,
    attempted_at: "2026-10-28T11:00:01.000Z",
    status_code: 500,
    error: null,
    duration_ms: 120,
    response_body: "oops",
  });

  it("fences on endpoint, project and env, and attaches attempts per delivery", async () => {
    canned.set("dev_webhook_deliveries", { data: [delivery(D1, "pending"), delivery(D2, "failed")] });
    canned.set("dev_webhook_attempts", { data: [attempt(D1, 2), attempt(D1, 1), attempt(D2, 1)] });
    const out = await listPortalWebhookDeliveries(EP, "p1", "test");

    const ops = opsOn("dev_webhook_deliveries");
    expect(ops).toContainEqual(["eq", "endpoint_id", EP]);
    expect(ops).toContainEqual(["eq", "project_id", "p1"]);
    expect(ops).toContainEqual(["eq", "env", "test"]);
    expect(ops).toContainEqual(["limit", PORTAL_DELIVERY_LIMIT]);
    expect(opsOn("dev_webhook_attempts")).toContainEqual(["in", "delivery_id", [D1, D2]]);

    expect(out.map((d) => [d.id, d.status, d.attempts?.map((a) => a.attempt)])).toEqual([
      [D1, "pending", [2, 1]],
      [D2, "failed", [1]],
    ]);
    // Only a pending delivery has a next attempt time.
    expect(out[0].next_attempt_at).toBe("2026-10-28T12:00:00.000Z");
    expect(out[1].next_attempt_at).toBeNull();
  });

  it("honours a custom limit and skips the attempts read when there are no deliveries", async () => {
    const out = await listPortalWebhookDeliveries(EP, "p1", "live", 10);
    expect(out).toEqual([]);
    expect(opsOn("dev_webhook_deliveries")).toContainEqual(["limit", 10]);
    expect(tables()).toEqual(["dev_webhook_deliveries"]);
  });
});
