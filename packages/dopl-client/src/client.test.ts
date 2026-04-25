import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DoplClient, parseRetryAfter } from "./client.js";
import {
  DoplApiError,
  DoplAuthError,
  DoplNetworkError,
  DoplTimeoutError,
} from "./errors.js";

type FetchArgs = Parameters<typeof fetch>;

interface FetchCall {
  url: string;
  init: RequestInit;
}

function installFetchMock(responders: Array<() => Promise<Response> | Response>): {
  calls: FetchCall[];
  restore: () => void;
} {
  const calls: FetchCall[] = [];
  const original = global.fetch;
  let i = 0;
  global.fetch = (async (...args: FetchArgs) => {
    const [input, init] = args;
    calls.push({ url: String(input), init: init ?? {} });
    const responder = responders[Math.min(i++, responders.length - 1)];
    return responder();
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      global.fetch = original;
    },
  };
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function textResponse(status: number, body = "", headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

const BASE = "https://api.example.test";

describe("DoplClient headers", () => {
  let mock: ReturnType<typeof installFetchMock>;

  beforeEach(() => {
    mock = installFetchMock([() => jsonResponse(200, { packs: [] })]);
  });

  afterEach(() => mock.restore());

  it("sends Authorization bearer", async () => {
    const client = new DoplClient(BASE, "sk-dopl-abc");
    await client.listPacks();
    const headers = mock.calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-dopl-abc");
  });

  it("omits X-Dopl-Client when identifier not provided", async () => {
    const client = new DoplClient(BASE, "k");
    await client.listPacks();
    const headers = mock.calls[0].init.headers as Record<string, string>;
    expect(headers["X-Dopl-Client"]).toBeUndefined();
  });

  it("includes X-Dopl-Client when identifier provided", async () => {
    const client = new DoplClient(BASE, "k", {
      clientIdentifier: "@dopl/cli@1.2.3",
    });
    await client.listPacks();
    const headers = mock.calls[0].init.headers as Record<string, string>;
    expect(headers["X-Dopl-Client"]).toBe("@dopl/cli@1.2.3");
  });

  it("sets the tool header name with the called tool", async () => {
    const client = new DoplClient(BASE, "k");
    await client.listPacks();
    const headers = mock.calls[0].init.headers as Record<string, string>;
    expect(headers["X-MCP-Tool"]).toBe("kb_list_packs");
  });

  it("uses a custom tool header name", async () => {
    const client = new DoplClient(BASE, "k", { toolHeaderName: "X-Dopl-Cli" });
    await client.listPacks();
    const headers = mock.calls[0].init.headers as Record<string, string>;
    expect(headers["X-Dopl-Cli"]).toBe("kb_list_packs");
    expect(headers["X-MCP-Tool"]).toBeUndefined();
  });
});

describe("DoplClient retries", () => {
  let mock: ReturnType<typeof installFetchMock>;
  afterEach(() => {
    if (mock) mock.restore();
    vi.restoreAllMocks();
  });

  it("retries 503 then succeeds on 200 (GET)", async () => {
    mock = installFetchMock([
      () => textResponse(503, ""),
      () => textResponse(503, ""),
      () => jsonResponse(200, { packs: [{ id: "a" }] }),
    ]);
    const client = new DoplClient(BASE, "k");
    const { packs } = await client.listPacks();
    expect(packs).toEqual([{ id: "a" }]);
    expect(mock.calls).toHaveLength(3);
  });

  it("does NOT retry on POST (non-idempotent)", async () => {
    mock = installFetchMock([() => textResponse(503, "")]);
    const client = new DoplClient(BASE, "k");
    await expect(client.searchSetups({ query: "x" })).rejects.toBeInstanceOf(DoplApiError);
    expect(mock.calls).toHaveLength(1);
  });

  it("honors Retry-After seconds on 429", async () => {
    const spy = vi.spyOn(global, "setTimeout");
    mock = installFetchMock([
      () => textResponse(429, "", { "retry-after": "2" }),
      () => jsonResponse(200, { packs: [] }),
    ]);
    const client = new DoplClient(BASE, "k");
    await client.listPacks();
    const delays = spy.mock.calls.map((call) => Number(call[1]));
    expect(delays.some((ms) => ms === 2000)).toBe(true);
    spy.mockRestore();
  });

  it("does NOT retry on 4xx other than 429", async () => {
    mock = installFetchMock([() => textResponse(404, "")]);
    const client = new DoplClient(BASE, "k");
    await expect(client.listPacks()).rejects.toBeInstanceOf(DoplApiError);
    expect(mock.calls).toHaveLength(1);
  });

  it("retries on network errors then eventually fails", async () => {
    mock = installFetchMock([
      () => {
        throw new TypeError("fetch failed");
      },
      () => {
        throw new TypeError("fetch failed");
      },
      () => {
        throw new TypeError("fetch failed");
      },
      () => {
        throw new TypeError("fetch failed");
      },
    ]);
    const client = new DoplClient(BASE, "k");
    await expect(client.listPacks()).rejects.toBeInstanceOf(DoplNetworkError);
    expect(mock.calls).toHaveLength(4);
  });

  it("wraps AbortError into DoplTimeoutError", async () => {
    mock = installFetchMock([
      () => {
        const err = new DOMException("aborted", "AbortError");
        throw err;
      },
    ]);
    const client = new DoplClient(BASE, "k");
    const err = await client
      .searchSetups({ query: "x" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DoplTimeoutError);
  });
});

describe("DoplClient error mapping", () => {
  let mock: ReturnType<typeof installFetchMock>;
  afterEach(() => mock?.restore());

  it("401 → DoplAuthError without retry", async () => {
    mock = installFetchMock([() => textResponse(401, "")]);
    const client = new DoplClient(BASE, "k");
    await expect(client.listPacks()).rejects.toBeInstanceOf(DoplAuthError);
    expect(mock.calls).toHaveLength(1);
  });

  it("parses structured error body into code/apiMessage", async () => {
    mock = installFetchMock([
      () =>
        jsonResponse(400, { error: { code: "BAD_REQUEST", message: "Missing field" } }),
    ]);
    const client = new DoplClient(BASE, "k");
    const err = (await client.listPacks().catch((e: unknown) => e)) as DoplApiError;
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.apiMessage).toBe("Missing field");
  });
});

describe("parseRetryAfter", () => {
  it("returns null for null/empty", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter("   ")).toBeNull();
  });

  it("parses integer seconds", () => {
    expect(parseRetryAfter("5")).toBe(5000);
  });

  it("parses HTTP-date relative to now", () => {
    const now = Date.now();
    const future = new Date(now + 10_000).toUTCString();
    const ms = parseRetryAfter(future, now);
    expect(ms).toBeGreaterThanOrEqual(8_000);
    expect(ms).toBeLessThanOrEqual(11_000);
  });

  it("caps at 60 seconds", () => {
    expect(parseRetryAfter("120")).toBe(60_000);
  });

  it("returns null for junk", () => {
    expect(parseRetryAfter("not-a-date")).toBeNull();
  });

  it("clamps past dates to 0", () => {
    const now = Date.now();
    const past = new Date(now - 60_000).toUTCString();
    expect(parseRetryAfter(past, now)).toBe(0);
  });
});
