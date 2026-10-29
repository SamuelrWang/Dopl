import { describe, expect, it } from "vitest";
import { unwrap } from "./__fixtures__/dopl-sdk-webhooks";
import { fakeWebhookStore } from "./fake-store";
import { RETRY_DELAYS_S, WEBHOOK_MAX_ATTEMPTS } from "./retry";
import { runWebhookSender } from "./sender";
import { generateWebhookSecret } from "./signing";
import { httpsTransport, type Transport, type TransportRequest, type TransportResult } from "./transport";

const T = { projectId: "11111111-1111-4111-8111-111111111111", env: "test" as const };
const OTHER = { projectId: "22222222-2222-4222-8222-222222222222", env: "test" as const };

function scripted(...statuses: Array<number | null>) {
  const calls: TransportRequest[] = [];
  let i = 0;
  const transport: Transport = async (req) => {
    calls.push(req);
    const s = statuses[Math.min(i++, statuses.length - 1)];
    const r: TransportResult = { statusCode: s, error: s === null ? "connect ECONNREFUSED" : null, responseBody: s ? `r${s}` : null, durationMs: 12 };
    return r;
  };
  return { transport, calls };
}

async function setup(statuses: Array<number | null> = [200]) {
  const f = fakeWebhookStore({ apiVersion: "2026-10-28" });
  const secret = generateWebhookSecret();
  const ep = await f.store.createEndpoint(T, { url: "https://hooks.example.com/dopl", description: null, enabledEvents: null, secret });
  const t = scripted(...statuses);
  const run = () => runWebhookSender({ store: f.store, transport: t.transport, now: () => f.clock.now, random: () => 0.5 }, { budgetMs: 5_000 });
  return { f, secret, ep, ...t, run };
}

const advance = (f: ReturnType<typeof fakeWebhookStore>, s: number) => {
  f.clock.now = new Date(f.clock.now.getTime() + s * 1000);
};

describe("webhook sender", () => {
  it("✅ delivers a signed event the dopl-sdk unwrap accepts, body = ruled envelope", async () => {
    const { f, secret, run, calls } = await setup([200]);
    const ev = f.enqueue(T, "connection.created", { id: "conn_1" });
    const report = await run();
    expect(report).toMatchObject({ fannedOut: 1, attempted: 1, delivered: 1 });
    expect(calls).toHaveLength(1);
    const [req] = calls;
    expect(req.url).toBe("https://hooks.example.com/dopl");
    const event = await unwrap(req.body, req.headers, { secret, now: Math.floor(f.clock.now.getTime() / 1000) });
    expect(event).toMatchObject({
      id: `evt_${ev.id}`,
      type: "connection.created",
      api_version: "2026-10-28",
      livemode: false,
      data: { id: "conn_1" },
      webhookId: `msg_${f.deliveries[0].id}`,
    });
    expect(typeof (event as { timestamp?: unknown }).timestamp).toBe("string");
    expect(f.deliveries[0]).toMatchObject({ status: "delivered", attempts: 1, last_status_code: 200 });
    expect(f.attempts).toMatchObject([{ attempt: 1, status_code: 200, response_body: "r200", duration_ms: 12 }]);
  });

  it("retries on non-2xx / connection errors per schedule, then dead-letters after 8 attempts", async () => {
    const { f, run, calls } = await setup([500, null, 302, 503]);
    f.enqueue(T, "action.completed");
    await run();
    expect(f.deliveries[0]).toMatchObject({ status: "pending", attempts: 1, last_status_code: 500 });

    // Not due yet: nothing sent.
    advance(f, RETRY_DELAYS_S[0] - 1);
    await run();
    expect(calls).toHaveLength(1);

    for (let n = 1; n < WEBHOOK_MAX_ATTEMPTS; n++) {
      advance(f, RETRY_DELAYS_S[n - 1] + 1);
      await run();
      expect(calls).toHaveLength(n + 1);
    }
    expect(f.deliveries[0]).toMatchObject({ status: "failed", attempts: WEBHOOK_MAX_ATTEMPTS });
    expect(f.attempts).toHaveLength(WEBHOOK_MAX_ATTEMPTS);
    expect(f.attempts.find((a) => a.attempt === 2)).toMatchObject({ status_code: null, error: "connect ECONNREFUSED" });
    expect(f.attempts.find((a) => a.attempt === 3)).toMatchObject({ status_code: 302, error: "HTTP 302" });

    // Dead-lettered: never sent again.
    advance(f, 7 * 24 * 3600);
    await run();
    expect(calls).toHaveLength(WEBHOOK_MAX_ATTEMPTS);
  });

  it("✅ replay re-sends with the SAME webhook-id and a fresh retry budget; attempt numbers keep counting", async () => {
    const { f, run, calls, ep } = await setup([500, 500, 500, 500, 500, 500, 500, 500, 200]);
    f.enqueue(T, "action.failed");
    for (let n = 0; n < WEBHOOK_MAX_ATTEMPTS; n++) {
      await run();
      advance(f, 11 * 3600);
    }
    expect(f.deliveries[0].status).toBe("failed");
    const replayed = await f.store.replay(T, f.deliveries[0].id);
    expect(replayed).toMatchObject({ status: "pending", attempts: 0 });
    await run();
    expect(f.deliveries[0]).toMatchObject({ status: "delivered", attempts: 1 });
    expect(calls[8].headers["webhook-id"]).toBe(calls[0].headers["webhook-id"]);
    expect(Math.max(...f.attempts.map((a) => a.attempt))).toBe(9);
    // Replay is tenant-scoped.
    expect(await f.store.replay(OTHER, f.deliveries[0].id)).toBeNull();
    expect(ep.id).toBeTruthy();
  });

  it("fans out only to enabled, matching endpoints of the same project + env", async () => {
    const { f, run, calls } = await setup([200]);
    await f.store.createEndpoint(T, { url: "https://a.example.com/x", description: null, enabledEvents: ["device.online"], secret: generateWebhookSecret() });
    const off = await f.store.createEndpoint(T, { url: "https://b.example.com/x", description: null, enabledEvents: null, secret: generateWebhookSecret() });
    await f.store.updateEndpoint(T, off.id, { disabled_at: f.clock.now.toISOString() });
    await f.store.createEndpoint({ ...T, env: "live" }, { url: "https://c.example.com/x", description: null, enabledEvents: null, secret: generateWebhookSecret() });
    await f.store.createEndpoint(OTHER, { url: "https://d.example.com/x", description: null, enabledEvents: null, secret: generateWebhookSecret() });
    f.enqueue(T, "connection.created");
    await run();
    expect(calls.map((c) => c.url)).toEqual(["https://hooks.example.com/dopl"]);
    // A second run never fans out the same event twice.
    await run();
    expect(f.deliveries).toHaveLength(1);
  });

  it("an endpoint disabled after fan-out is dead-lettered without a request", async () => {
    const { f, run, calls, ep } = await setup([200]);
    f.enqueue(T, "connection.created");
    await f.store.fanOut(10);
    await f.store.updateEndpoint(T, ep.id, { disabled_at: f.clock.now.toISOString() });
    await run();
    expect(calls).toHaveLength(0);
    expect(f.deliveries[0]).toMatchObject({ status: "failed" });
    expect(f.attempts[0].error).toBe("not sent: endpoint disabled");
  });

  it("✅ rotation overlap signs with both secrets; after it ends only the new one", async () => {
    const { f, run, calls, ep, secret: old } = await setup([200]);
    const fresh = generateWebhookSecret();
    await f.store.rotateSecret(T, ep.id, fresh, 3600);
    f.enqueue(T, "device.online");
    await run();
    const now = Math.floor(f.clock.now.getTime() / 1000);
    await expect(unwrap(calls[0].body, calls[0].headers, { secret: fresh, now })).resolves.toBeTruthy();
    await expect(unwrap(calls[0].body, calls[0].headers, { secret: old, now })).resolves.toBeTruthy();

    advance(f, 3601);
    f.enqueue(T, "device.offline");
    await run();
    const now2 = Math.floor(f.clock.now.getTime() / 1000);
    expect(calls[1].headers["webhook-signature"].split(" ")).toHaveLength(1);
    await expect(unwrap(calls[1].body, calls[1].headers, { secret: fresh, now: now2 })).resolves.toBeTruthy();
    await expect(unwrap(calls[1].body, calls[1].headers, { secret: old, now: now2 })).rejects.toThrow();
  });

  it("a leased delivery is not claimed by a concurrent run", async () => {
    const { f } = await setup();
    f.enqueue(T, "connection.created");
    await f.store.fanOut(10);
    expect(await f.store.claim(10, 60)).toHaveLength(1);
    expect(await f.store.claim(10, 60)).toHaveLength(0);
    advance(f, 61);
    expect(await f.store.claim(10, 60)).toHaveLength(1);
  });
});

describe("https transport (no outbound calls)", () => {
  it("🔒 refuses http and private hosts before connecting", async () => {
    const http = await httpsTransport({ url: "http://example.com/x", headers: {}, body: "{}" });
    expect(http).toMatchObject({ statusCode: null, error: "refused: url must use https" });
    const local = await httpsTransport({ url: "https://127.0.0.1/x", headers: {}, body: "{}" });
    expect(local.statusCode).toBeNull();
    expect(local.error).toContain("private");
  });
});
