import { describe, expect, it } from "vitest";

import { DEFAULT_BASE_URL, Dopl, DoplError } from "./index.js";
import { BASE, CONTEXT, DELIVERY, DEVICE, PK, SK, action, client, mockFetch } from "./test-helpers.js";

describe("every method hits its openapi path and method", () => {
  const cases: Array<[string, (d: Dopl) => Promise<unknown>, string, string]> = [
    [
      "connectSessions.create",
      (d) => d.connectSessions.create({ external_user_id: "usr_1", requested_scopes: ["present.*"] }),
      "POST",
      "/connect_sessions",
    ],
    ["connections.exchange", (d) => d.connections.exchange({ public_token: "pt_1" }), "POST", "/connections/exchange"],
    ["connections.list", (d) => d.connections.list("usr_1"), "GET", "/users/usr_1/connections"],
    ["connections.revoke", (d) => d.connections.revoke("con_1"), "DELETE", "/connections/con_1"],
    ["users.context", (d) => d.users.context("usr_1"), "GET", "/users/usr_1/context"],
    [
      "users.deliver",
      (d) => d.users.deliver("usr_1", { intent: "message", content: { text: "hi" } }),
      "POST",
      "/users/usr_1/deliver",
    ],
    ["devices.get", (d) => d.devices.get("dev_1"), "GET", "/devices/dev_1"],
    [
      "devices.action",
      (d) => d.devices.action("dev_1", "present.notify", { title: "t" }),
      "POST",
      "/devices/dev_1/actions/present.notify",
    ],
    ["actions.get", (d) => d.actions.get("act_1"), "GET", "/actions/act_1"],
  ];

  it.each(cases)("%s", async (_name, call, method, path) => {
    const { dopl, calls } = client(SK, { body: { ok: true } });
    await call(dopl);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe(method);
    expect(calls[0].url).toBe(BASE + path);
    expect(calls[0].headers.Authorization).toBe(`Bearer ${SK}`);
    expect(calls[0].headers.Accept).toBe("application/json");
    if (method === "POST") expect(calls[0].headers["Content-Type"]).toBe("application/json");
    else expect(calls[0].body).toBeUndefined();
  });
});

describe("request shapes", () => {
  it("encodes path segments", async () => {
    const { dopl, calls } = client(SK, { body: CONTEXT });
    await dopl.users.context("a/b c");
    expect(calls[0].url).toBe(`${BASE}/users/a%2Fb%20c/context`);
  });

  it("defaults the base URL to www.usedopl.com/api/v1 and trims a trailing slash", async () => {
    expect(DEFAULT_BASE_URL).toBe("https://www.usedopl.com/api/v1");
    const m1 = mockFetch({ body: DEVICE });
    await new Dopl({ apiKey: SK, fetch: m1.fn }).devices.get("d");
    expect(m1.calls[0].url).toBe("https://www.usedopl.com/api/v1/devices/d");
    const m2 = mockFetch({ body: DEVICE });
    await new Dopl({ apiKey: SK, baseUrl: "http://localhost:3000/api/v1/", fetch: m2.fn }).devices.get("d");
    expect(m2.calls[0].url).toBe("http://localhost:3000/api/v1/devices/d");
  });

  it("deliver fills urgency and one idempotency key in body and header", async () => {
    const { dopl, calls } = client(SK, { status: 202, body: DELIVERY });
    const res = await dopl.users.deliver("usr_1", { intent: "message", content: { text: "hi" }, target: "auto" });
    expect(res).toEqual(DELIVERY);
    const body = calls[0].body as Record<string, unknown>;
    expect(body.urgency).toBe("normal");
    expect(body.target).toBe("auto");
    expect(typeof body.idempotency_key).toBe("string");
    expect(calls[0].headers["Idempotency-Key"]).toBe(body.idempotency_key);
  });

  it("deliver uses the idempotencyKey option for body and header", async () => {
    const { dopl, calls } = client(SK, { status: 202, body: DELIVERY });
    await dopl.users.deliver("usr_1", { intent: "notify", content: { text: "x" } }, { idempotencyKey: "k1" });
    expect((calls[0].body as { idempotency_key: string }).idempotency_key).toBe("k1");
    expect(calls[0].headers["Idempotency-Key"]).toBe("k1");
  });

  it("deliver refuses a body key that differs from the option", async () => {
    const { dopl, fn } = client(SK, { body: DELIVERY });
    expect(() =>
      dopl.users.deliver("u", { intent: "message", content: { text: "x" }, idempotency_key: "a" }, { idempotencyKey: "b" }),
    ).toThrow(DoplError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("devices.action sends args and the idempotency key", async () => {
    const { dopl, calls } = client(SK, { status: 202, body: { action_id: "act_1", status: "queued" } });
    await dopl.devices.action("dev_1", "ask.choice", { question: "q" }, { idempotencyKey: "k2" });
    expect(calls[0].body).toEqual({ args: { question: "q" }, idempotency_key: "k2" });
    expect(calls[0].headers["Idempotency-Key"]).toBe("k2");
  });

  it("connectSessions.create and exchange forward the Idempotency-Key header", async () => {
    const { dopl, calls } = client(SK, { status: 201, body: {} });
    await dopl.connectSessions.create({ external_user_id: "u", requested_scopes: ["ask.*"] }, { idempotencyKey: "c1" });
    await dopl.connections.exchange({ public_token: "pt" }, { idempotencyKey: "c2" });
    expect(calls.map((c) => c.headers["Idempotency-Key"])).toEqual(["c1", "c2"]);
  });

  it("GET carries no Idempotency-Key", async () => {
    const { dopl, calls } = client(SK, { body: action("done") });
    await dopl.actions.get("a");
    expect(calls[0].headers["Idempotency-Key"]).toBeUndefined();
  });
});

describe("errors map to DoplError", () => {
  const body = {
    error: {
      type: "device_error",
      code: "device_offline",
      message: "The device is offline.",
      device_kind: "glasses",
      retryable: true,
      doc_url: "https://www.usedopl.com/docs/errors/device-offline",
    },
  };

  it("carries code, type, doc_url, retryable, status and request id", async () => {
    const { dopl } = client(SK, { status: 409, body, headers: { "request-id": "req_42" } });
    const err = await dopl.users.deliver("u", { intent: "message", content: { text: "x" } }).catch((e) => e);
    expect(err).toBeInstanceOf(DoplError);
    expect(err).toMatchObject({
      code: "device_offline",
      type: "device_error",
      docUrl: body.error.doc_url,
      retryable: true,
      deviceKind: "glasses",
      status: 409,
      requestId: "req_42",
      message: "The device is offline.",
    });
  });

  it("reads X-Request-Id too", async () => {
    const { dopl } = client(SK, { status: 404, body: { error: { ...body.error, type: "invalid_request_error", code: "not_found" } }, headers: { "x-request-id": "req_7" } });
    const err = await dopl.devices.get("nope").catch((e) => e);
    expect(err).toMatchObject({ code: "not_found", requestId: "req_7", status: 404 });
  });

  it("a non C10 body becomes unexpected_response", async () => {
    const { dopl } = client(SK, { status: 502, raw: "<html>bad gateway</html>" });
    const err = await dopl.actions.get("a").catch((e) => e);
    expect(err).toMatchObject({ code: "unexpected_response", type: "api_error", status: 502, retryable: true });
  });

  it("a thrown fetch becomes network_error", async () => {
    const dopl = new Dopl({ apiKey: SK, baseUrl: BASE, fetch: async () => { throw new TypeError("fetch failed"); } });
    const err = await dopl.actions.get("a").catch((e) => e);
    expect(err).toMatchObject({ code: "network_error", status: null, retryable: true });
  });
});

describe("key safety", () => {
  it("a pk_ key may create a Connect session", async () => {
    const { dopl, calls } = client(PK, { status: 201, body: { connect_token: "ct", url: "https://x", expires_at: "2026-10-27T00:00:00Z" } });
    await dopl.connectSessions.create({ external_user_id: "u", requested_scopes: ["present.*"] });
    expect(calls[0].headers.Authorization).toBe(`Bearer ${PK}`);
  });

  it.each([
    ["connections.exchange", (d: Dopl) => d.connections.exchange({ public_token: "p" })],
    ["connections.list", (d: Dopl) => d.connections.list("u")],
    ["connections.revoke", (d: Dopl) => d.connections.revoke("c")],
    ["users.context", (d: Dopl) => d.users.context("u")],
    ["users.deliver", (d: Dopl) => d.users.deliver("u", { intent: "message", content: { text: "x" } })],
    ["devices.get", (d: Dopl) => d.devices.get("d")],
    ["devices.action", (d: Dopl) => d.devices.action("d", "present.notify")],
    ["actions.get", (d: Dopl) => d.actions.get("a")],
    ["show", (d: Dopl) => d.show("u", { text: "x" })],
    ["notify", (d: Dopl) => d.notify("u", { text: "x" })],
    ["ask", (d: Dopl) => d.ask("u", { question: "q" })],
  ])("a pk_ key is refused client side for %s", async (_n, call) => {
    const { dopl, fn } = client(PK, { body: {} });
    const err = await call(dopl).catch((e) => e);
    expect(err).toBeInstanceOf(DoplError);
    expect(err.code).toBe("publishable_key_not_allowed");
    expect(err.message).toMatch(/publishable/);
    expect(err.message).not.toContain(PK);
    expect(fn).not.toHaveBeenCalled();
  });

  it("a missing key throws before any request", () => {
    expect(() => new Dopl({ apiKey: "" })).toThrow(/Missing apiKey/);
  });

  it("the key is not stored on the client, so inspecting it cannot print it", () => {
    const dopl = new Dopl({ apiKey: SK, baseUrl: BASE });
    expect(JSON.stringify(dopl)).not.toContain(SK);
    expect(Object.values(dopl).some((v) => v === SK)).toBe(false);
  });
});
