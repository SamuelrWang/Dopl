/**
 * The SDK lens (W1.2): failure classes, presence over `users.context` / `connections.list`, block
 * shape, latency logs, and the ask outcomes. Over the REAL `@dopl/sdk` client with a scripted fetch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// A string path, not an import: the seam's own lint fence holds for its tests too.
const sdkDeliveryFor = vi.hoisted(() => vi.fn());
vi.mock("@/features/device-sdk/server/sdk-delivery-flag", () => ({ sdkDeliveryFor }));

import { Dopl, DoplError } from "@dopl/sdk";
import { GlassesValidationError } from "@/features/glasses/core/validation";
import { askOutcomeOf, classify, createSdkLens, isPreSendFailure, neverLeft, preSendAwareFetch, SDK_LENS_HEADERS, sdkUserLens, SdkLensError, toSdkBlocks } from "./sdk-lens";
import { sdkPlanOf } from "./sdk-seam";

const KEY = "sk_test_EXAMPLE0000000000000000";
const USER = "11111111-1111-4111-8111-111111111111";
const err = (status: number, code: string, type = "invalid_request_error") =>
  new Response(JSON.stringify({ error: { type, code, message: code, retryable: false, doc_url: "https://x" } }), { status, headers: { "content-type": "application/json" } });
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function client(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: string[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const key = `${init.method} ${new URL(url).pathname.replace("/api/v1", "")}`;
    calls.push(key);
    const r = routes[key];
    if (!r) throw new TypeError("fetch failed");
    return r();
  });
  return { dopl: new Dopl({ apiKey: KEY, baseUrl: "https://app.example/api/v1", fetch }), calls };
}

let logs: Array<Record<string, unknown>>;
beforeEach(() => {
  vi.clearAllMocks();
  logs = [];
  vi.spyOn(console, "info").mockImplementation((m: string) => void logs.push(JSON.parse(m.slice("[display] ".length))));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("classify", () => {
  const de = (status: number | null, code: string, type = "invalid_request_error") =>
    new DoplError({ type: type as never, code: code as never, message: "m", retryable: false, doc_url: "d", status });
  it("🔒 fallback only on PROVEN non-delivery; may-have-landed is unconfirmed; an SDK no is a refusal", () => {
    // Proven: the connection never opened, or the key was refused before any write.
    expect(classify(de(null, "network_error", "api_error"), { preSend: true })).toMatchObject({ code: "network_error", fallback: true, unconfirmed: false });
    expect(classify(de(401, "unauthenticated", "authentication_error"))).toMatchObject({ fallback: true, unconfirmed: false });
    expect(classify(de(403, "insufficient_scope", "permission_error"))).toMatchObject({ fallback: true });
    // May have landed: never the prosumer path.
    expect(classify(de(null, "network_error", "api_error"))).toMatchObject({ code: "network_error", fallback: false, unconfirmed: true });
    expect(classify(de(503, "unexpected_response", "api_error"))).toMatchObject({ fallback: false, unconfirmed: true });
    expect(classify(de(202, "unexpected_response", "api_error"))).toMatchObject({ fallback: false, unconfirmed: true });
    expect(classify(new TypeError("boom"))).toMatchObject({ code: "error", fallback: false, unconfirmed: true });
    expect(classify(de(null, "network_error", "api_error"), { timedOut: true, preSend: true })).toMatchObject({ code: "timeout", fallback: false, unconfirmed: true });
    // Refused before any lens copy existed: proven non-delivery (prod 2026-10-30: device_offline was dropped).
    for (const [status, code, type] of [[409, "device_offline", "device_error"], [422, "capability_unsupported"], [429, "rate_limited", "rate_limit_error"], [404, "not_found"], [400, "invalid_request"]] as const) {
      expect(classify(de(status, code, type))).toMatchObject({ code, fallback: true, unconfirmed: false });
    }
    // Other refusals: no second copy.
    expect(classify(de(409, "idempotency_conflict"))).toMatchObject({ fallback: false, unconfirmed: false });
  });

  it("isPreSendFailure: connection-phase codes through the cause chain; a reset is not one", () => {
    const fetchFailed = (cause: unknown) => Object.assign(new TypeError("fetch failed"), { cause });
    expect(isPreSendFailure(fetchFailed({ code: "ECONNREFUSED" }))).toBe(true);
    expect(isPreSendFailure(fetchFailed({ code: "ENOTFOUND" }))).toBe(true);
    expect(isPreSendFailure(fetchFailed({ code: "UND_ERR_CONNECT_TIMEOUT" }))).toBe(true);
    expect(isPreSendFailure(fetchFailed({ errors: [{ code: "ECONNREFUSED" }, { code: "ENETUNREACH" }] }))).toBe(true);
    expect(isPreSendFailure(fetchFailed({ errors: [{ code: "ECONNREFUSED" }, { code: "ECONNRESET" }] }))).toBe(false);
    expect(isPreSendFailure(fetchFailed({ code: "ECONNRESET" }))).toBe(false);
    expect(isPreSendFailure(fetchFailed({ code: "UND_ERR_SOCKET" }))).toBe(false);
    expect(isPreSendFailure(new TypeError("fetch failed"))).toBe(false);
  });
});

describe("sdkUserLens", () => {
  it("state: online from context; else paired from active glasses connections; no end user = unpaired", async () => {
    const online = client({ [`GET /users/${USER}/context`]: () => ok({ active_device: null, posture: "x", available: [{ kind: "glasses", id: "g", capabilities: [] }], profile: null, source_of_last_message: null }) });
    expect(await sdkUserLens(online.dopl, USER).state()).toEqual({ paired: true, online: true });
    expect(online.calls).toEqual([`GET /users/${USER}/context`]);

    const offline = client({
      [`GET /users/${USER}/context`]: () => ok({ active_device: null, posture: "x", available: [], profile: null, source_of_last_message: null }),
      [`GET /users/${USER}/connections`]: () => ok({ data: [{ status: "active", device: { kind: "glasses" } }] }),
    });
    expect(await sdkUserLens(offline.dopl, USER).state()).toEqual({ paired: true, online: false });

    const none = client({ [`GET /users/${USER}/context`]: () => err(404, "not_found") });
    expect(await sdkUserLens(none.dopl, USER).state()).toEqual({ paired: false, online: false });

    const down = client({});
    await expect(sdkUserLens(down.dopl, USER).state()).rejects.toMatchObject({ code: "network_error", fallback: true });
    expect(logs.map((l) => [l.op, l.outcome])).toEqual([["context", "ok"], ["context", "ok"], ["connections", "ok"], ["context", "not_found"], ["context", "network_error"]]);
    expect(logs.every((l) => typeof l.ms === "number")).toBe(true);
  });

  it("screen: intent display to the glasses, positions stripped, delivery logged", async () => {
    let body: Record<string, unknown> = {};
    const dopl = new Dopl({
      apiKey: KEY,
      baseUrl: "https://app.example/api/v1",
      fetch: async (_u, init) => {
        body = JSON.parse(String(init.body));
        return ok({ delivery_id: "dl1", routed_to: { device_id: "g", kind: "glasses", reason: "r" }, status: "queued" }, 202);
      },
    });
    await sdkUserLens(dopl, USER).screen({ blocks: [{ id: "h", type: "heading", text: "Hi", x: 4, y: 8 } as never], idempotencyKey: "k1" });
    expect(body).toMatchObject({ intent: "display", target: "glasses", content: { blocks: [{ id: "h", type: "heading", text: "Hi" }] }, idempotency_key: "k1" });
    expect((body.content as { blocks: object[] }).blocks[0]).not.toHaveProperty("x");
    expect(logs[0]).toMatchObject({ evt: "sdk_lens", op: "show", outcome: "ok", delivery_id: "dl1" });
  });

  it("startAsk: one deliver, intent ask to the glasses, returns at once with the action id", async () => {
    let body: Record<string, unknown> = {};
    const routes = {
      [`POST /users/${USER}/deliver`]: () => ok({ delivery_id: "dl1", routed_to: { device_id: "g2", kind: "glasses", reason: "r" }, status: "delivered" }, 202),
    };
    const dopl = new Dopl({
      apiKey: KEY,
      baseUrl: "https://app.example/api/v1",
      fetch: async (_u, init) => {
        body = JSON.parse(String(init.body));
        return routes[`POST /users/${USER}/deliver`]();
      },
    });
    expect(await sdkUserLens(dopl, USER).startAsk({ question: "Q?", options: ["A", "B"], idempotencyKey: "k" })).toEqual({ deliveryId: "dl1", deviceId: "g2" });
    expect(body).toMatchObject({ intent: "ask", target: "glasses", content: { text: "Q?", options: [{ label: "A" }, { label: "B" }] }, idempotency_key: "k" });
    expect(logs.map((l) => [l.op, l.outcome])).toEqual([["ask", "ok"]]);
  });

  it("startAsk: a router refusal or a stored `failed` falls back (nothing shown); needs_confirmation is a refusal", async () => {
    const offline = sdkUserLens(client({ [`POST /users/${USER}/deliver`]: () => err(409, "device_offline", "device_error") }).dopl, USER);
    await expect(offline.startAsk({ question: "Q?", options: ["A", "B"], idempotencyKey: "k" })).rejects.toMatchObject({ code: "device_offline", fallback: true, unconfirmed: false });
    for (const [status, fallback] of [["failed", true], ["needs_confirmation", false]] as const) {
      const c = client({ [`POST /users/${USER}/deliver`]: () => ok({ delivery_id: "dl1", routed_to: { device_id: "g2", kind: "glasses", reason: "r" }, status }, 202) });
      await expect(sdkUserLens(c.dopl, USER).startAsk({ question: "Q?", options: ["A", "B"], idempotencyKey: "k" })).rejects.toMatchObject({ code: status, fallback });
    }
  });

  it("askOutcome: answered / dismissed / failed; null while open or when the read fails", async () => {
    const action = (status: string, result: unknown, error: unknown = null) => () => ok({ action_id: "dl1", device_id: "g2", status, result, error });
    const read = (r: () => Response) => sdkUserLens(client({ ["GET /actions/dl1"]: r }).dopl, USER).askOutcome("dl1");
    expect(await read(action("done", { index: 1, label: "B", lens_message_id: "x" }))).toEqual({ status: "answered", index: 1, label: "B", deviceId: "g2" });
    expect(await read(action("done", { dismissed: true, index: null, label: null }))).toEqual({ status: "dismissed", deviceId: "g2" });
    expect(await read(action("failed", null, { code: "device_offline" }))).toEqual({ status: "refused", code: "device_offline" });
    expect(await read(action("delivered", { lens_message_id: "x" }))).toBeNull();
    expect(await sdkUserLens(client({}).dopl, USER).askOutcome("dl1")).toBeNull();
    expect(askOutcomeOf({ status: "done", result: { index: "x" }, error: null, device_id: "g2" })).toEqual({ status: "refused", code: "unexpected_answer" });
  });
});

describe("🔒 preSendAwareFetch under a retrying SDK (W2.2)", () => {
  const refused = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  const reset = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
  const twice = async (first: () => Promise<Response>, second: () => Promise<Response>) => {
    const steps = [first, second];
    const f = preSendAwareFetch(() => steps.shift()!());
    const signal = new AbortController().signal;
    // A retrying SDK fetches twice under ONE call's signal.
    for (let i = 0; i < 2; i++) await f("u", { signal }).catch(() => undefined);
    return neverLeft(signal);
  };

  it("only connect failures, every time: proven never left", async () => {
    expect(await twice(() => Promise.reject(refused()), () => Promise.reject(refused()))).toBe(true);
  });

  it("a reset, then a connect refusal on the retry: NOT proven (the first may have landed)", async () => {
    expect(await twice(() => Promise.reject(reset()), () => Promise.reject(refused()))).toBe(false);
  });

  it("a response, then a connect refusal on the retry: NOT proven", async () => {
    expect(await twice(async () => new Response("{}", { status: 503 }), () => Promise.reject(refused()))).toBe(false);
  });
});

describe("🔒 at most one lens copy (gap #6): one same-key replay when the outcome is unknown", () => {
  const delivered = () => ok({ delivery_id: "dl1", routed_to: { device_id: "g2", kind: "glasses", reason: "r" }, status: "delivered" }, 202);
  function scripted(...steps: Array<() => Response>) {
    const seen: Array<{ key: string | null; body: string }> = [];
    const dopl = new Dopl({
      apiKey: KEY,
      baseUrl: "https://app.example/api/v1",
      fetch: async (_u, init) => {
        seen.push({ key: new Headers(init.headers).get("idempotency-key"), body: String(init.body) });
        const step = steps.shift();
        if (!step) throw new Error("no more steps");
        return step();
      },
    });
    return { lens: sdkUserLens(dopl, USER), seen };
  }
  const reset = () => {
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
  };
  const ask = { question: "Q?", options: ["A", "B"], idempotencyKey: "k-1" };

  it("5xx then the replay lands: one delivery, same key and body both times", async () => {
    const s = scripted(() => err(503, "service_unavailable", "api_error"), delivered);
    expect(await s.lens.startAsk(ask)).toMatchObject({ deliveryId: "dl1" });
    expect(s.seen).toHaveLength(2);
    expect(s.seen[0]).toEqual(s.seen[1]);
    expect(s.seen[0].key).toBe("k-1");
    expect(logs.map((l) => [l.op, l.outcome])).toEqual([["ask", "service_unavailable"], ["ask_replay", "ok"]]);
  });

  it("a connection lost mid-call, then a refusal on replay: that refusal", async () => {
    const s = scripted(reset, () => err(409, "device_offline", "device_error"));
    await expect(s.lens.startAsk(ask)).rejects.toMatchObject({ code: "device_offline", fallback: false });
  });

  it("still unknown after the replay (or the replay proven unsent): `unconfirmed`, never the prosumer path", async () => {
    await expect(scripted(reset, reset).lens.startAsk(ask)).rejects.toMatchObject({ code: "unconfirmed", fallback: false, unconfirmed: false });
    await expect(scripted(() => err(500, "internal", "api_error"), () => err(401, "unauthenticated", "authentication_error")).lens.startAsk(ask)).rejects.toMatchObject({
      code: "unconfirmed",
      fallback: false,
    });
  });

  it("a refusal or a proven non-delivery is NOT replayed", async () => {
    const refused = scripted(() => err(429, "rate_limited", "rate_limit_error"), delivered);
    await expect(refused.lens.startAsk(ask)).rejects.toMatchObject({ code: "rate_limited" });
    expect(refused.seen).toHaveLength(1);
    const keyOff = scripted(() => err(401, "unauthenticated", "authentication_error"), delivered);
    await expect(keyOff.lens.startAsk(ask)).rejects.toMatchObject({ fallback: true });
    expect(keyOff.seen).toHaveLength(1);
  });

  it("screens follow the same rule", async () => {
    const s = scripted(() => err(502, "bad_gateway", "api_error"), delivered);
    await s.lens.screen({ blocks: [{ id: "h", type: "heading", text: "Hi" } as never], idempotencyKey: "k-2" });
    expect(s.seen.map((x) => x.key)).toEqual(["k-2", "k-2"]);
    await expect(scripted(reset, reset).lens.screen({ blocks: [{ id: "h", type: "heading", text: "Hi" } as never], idempotencyKey: "k-3" })).rejects.toMatchObject({ code: "unconfirmed", fallback: false });
  });

  it("a read is never replayed: unknown = unavailable (it delivered nothing)", async () => {
    const s = scripted(() => err(503, "service_unavailable", "api_error"));
    await expect(s.lens.state()).rejects.toMatchObject({ fallback: true });
    expect(s.seen).toHaveLength(1);
  });
});

describe("createSdkLens", () => {
  it("🔒 every call asks for respond-async (no ask hold), and a connection that never opened is a proven fallback", async () => {
    sdkDeliveryFor.mockResolvedValue({ on: true, deviceIds: ["g2"] });
    const prefer: Array<string | null> = [];
    const answered = createSdkLens({
      key: KEY,
      baseUrl: "https://app.example/api/v1",
      fetch: async (_u, init) => {
        prefer.push(new Headers(init.headers).get("prefer"));
        return ok({ delivery_id: "dl1", routed_to: { device_id: "g2", kind: "glasses", reason: "r" }, status: "delivered" }, 202);
      },
    });
    await (await answered.forUser(USER))!.lens.startAsk({ question: "Q?", options: ["A", "B"], idempotencyKey: "k" });
    expect(prefer).toEqual([SDK_LENS_HEADERS.Prefer]);

    let calls = 0;
    const refused = createSdkLens({
      key: KEY,
      baseUrl: "https://app.example/api/v1",
      fetch: async () => {
        calls++;
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      },
    });
    await expect((await refused.forUser(USER))!.lens.startAsk({ question: "Q?", options: ["A", "B"], idempotencyKey: "k" })).rejects.toMatchObject({
      code: "network_error",
      fallback: true,
    });
    expect(calls).toBe(1);
    sdkDeliveryFor.mockReset();
  });

  it("flag off → null; flag on without a key, or a failed lookup → unavailable (prosumer path)", async () => {
    sdkDeliveryFor.mockResolvedValueOnce({ on: false, deviceIds: [] });
    expect(await createSdkLens({ key: KEY }).forUser(USER)).toBeNull();
    sdkDeliveryFor.mockResolvedValueOnce({ on: true, deviceIds: ["g2"] });
    expect(await createSdkLens({ key: KEY }).forUser(USER)).toMatchObject({ deviceIds: ["g2"] });
    sdkDeliveryFor.mockResolvedValueOnce({ on: true, deviceIds: ["g2"] });
    const prev = process.env.DOPL_APP_SDK_KEY;
    delete process.env.DOPL_APP_SDK_KEY;
    await expect(createSdkLens().forUser(USER)).rejects.toMatchObject({ code: "no_key", fallback: true });
    if (prev !== undefined) process.env.DOPL_APP_SDK_KEY = prev;
    sdkDeliveryFor.mockRejectedValueOnce(new Error("rpc down"));
    await expect(createSdkLens({ key: KEY }).forUser(USER)).rejects.toBeInstanceOf(SdkLensError);
  });
});

describe("toSdkBlocks / sdkPlanOf", () => {
  const deps = { store: {} as never, devices: {} as never };
  const choice = { id: "c", type: "choice" as const, options: [{ label: "Yes" }, { label: "No" }] };
  const plan = (blocks: object[], o: Partial<Parameters<typeof sdkPlanOf>[1]> = {}) =>
    sdkPlanOf(deps, { blocks: blocks as never, layout: "stack", level: 0, choice: (blocks.find((b) => (b as { type: string }).type === "choice") as never) ?? null, question: "Ship?", shortcut: null, ...o });

  it("strips only the layout keys", () => {
    expect(toSdkBlocks([{ id: "t", type: "text", content: "a", x: 1, y: 2, w: 3, h: 4 } as never])).toEqual([{ id: "t", type: "text", content: "a" }]);
  });

  it("screen, ask, or the prosumer path with a reason", () => {
    expect(plan([{ id: "h", type: "heading", text: "Hi" }])).toEqual({ kind: "screen" });
    expect(plan([{ id: "h", type: "heading", text: "Ship?" }, choice])).toEqual({ kind: "ask", question: "Ship?", options: ["Yes", "No"] });
    expect(plan([choice], { question: "" })).toEqual({ kind: "none", reason: "choice exceeds the ask card" });
    expect(plan([{ id: "h", type: "heading", text: "Hi" }], { level: 2 })).toEqual({ kind: "none", reason: "degraded level 2" });
    expect(plan([{ id: "h", type: "heading", text: "Hi" }], { layout: "absolute" })).toEqual({ kind: "none", reason: "absolute layout" });
    const five = { ...choice, options: ["a", "b", "c", "d", "e"].map((label) => ({ label })) };
    expect(plan([five])).toEqual({ kind: "none", reason: "choice exceeds the ask card" });
    expect(() => plan([five], { shortcut: "ask" })).toThrow(GlassesValidationError);
  });
});
