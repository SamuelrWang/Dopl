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
import { classify, createSdkLens, sdkUserLens, SdkLensError, toSdkBlocks } from "./sdk-lens";
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
  it("unavailable (fallback) vs refusal", () => {
    expect(classify(de(null, "network_error", "api_error"))).toMatchObject({ code: "network_error", fallback: true });
    expect(classify(de(503, "unexpected_response", "api_error"))).toMatchObject({ fallback: true });
    expect(classify(de(401, "unauthenticated", "authentication_error"))).toMatchObject({ fallback: true });
    expect(classify(new TypeError("boom"))).toMatchObject({ code: "error", fallback: true });
    expect(classify(de(409, "device_offline", "device_error"))).toMatchObject({ code: "device_offline", fallback: false });
    expect(classify(de(400, "invalid_request"))).toMatchObject({ fallback: false });
    // Our own timeout: the call may have landed, so never a second copy.
    expect(classify(de(null, "network_error", "api_error"), true)).toMatchObject({ code: "timeout", fallback: false });
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

  it("ask: answered, dismissed and refused outcomes; never rejects", async () => {
    const deliver = () => ok({ delivery_id: "dl1", routed_to: { device_id: "g2", kind: "glasses", reason: "r" }, status: "done" }, 202);
    const action = (result: unknown) => () => ok({ id: "dl1", status: "done", result, error: null });
    const run = (result: unknown) =>
      sdkUserLens(client({ [`POST /users/${USER}/deliver`]: deliver, ["GET /actions/dl1"]: action(result) }).dopl, USER).ask({ question: "Q?", options: ["A", "B"], timeoutMs: 5_000, idempotencyKey: "k" });
    expect(await run({ index: 1, label: "B", lens_message_id: "x" })).toMatchObject({ status: "answered", index: 1, label: "B", deviceId: "g2" });
    expect(await run({ dismissed: true, index: null, label: null })).toMatchObject({ status: "dismissed", deviceId: "g2" });
    const offline = sdkUserLens(client({ [`POST /users/${USER}/deliver`]: () => err(409, "device_offline", "device_error") }).dopl, USER);
    expect(await offline.ask({ question: "Q?", options: ["A", "B"], timeoutMs: 5_000, idempotencyKey: "k" })).toMatchObject({ status: "refused", code: "device_offline" });
    expect(logs.filter((l) => l.op === "ask").map((l) => l.outcome)).toEqual(["answered", "dismissed", "device_offline"]);
  });
});

describe("createSdkLens", () => {
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
