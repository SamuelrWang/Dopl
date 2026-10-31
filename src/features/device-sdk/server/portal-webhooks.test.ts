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

import { listPortalWebhookEndpoints } from "./portal-webhooks";

const opsOn = (table: string) => calls.filter((c) => c.table === table).flatMap((c) => c.ops);

const EP = "11111111-1111-4111-8111-111111111111";

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
