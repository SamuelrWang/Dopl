/**
 * THE RENDERER HALF of the shared request contract. Twin of
 * `src/shared/api/transport-contract.test.ts`.
 *
 * `requestHeaders` and `normalizeFetchResponse` live in
 * `@/shared/api/api-envelope` because this transport and the web client used to
 * hand-copy both. Each suite pins its own side, so a change made on one and not
 * the other goes red here rather than shipping as drift.
 *
 * ⚠ `credentials` is deliberately NOT shared and is pinned per transport: this
 * one sends the cookie explicitly when `VITE_API_BASE_URL` names a cross-origin
 * dev API, and keeps the stricter `same-origin` otherwise.
 *
 * ⚠ EVERY EXPECTATION HERE IS A LITERAL, never a call to the helper under test.
 * Comparing `init.headers` against `requestHeaders(…)` is a tautology: it
 * compares the shared function with itself and stays GREEN when that function
 * is mutated (measured — dropping the `x-workspace-id` line left this suite
 * 6/6 passing). Spell the wire out.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { sendRequest } from "./api-transport";

/** No `window.dopl` → `getBridge()` is null → the fetch transport runs. */
function noBridge(): void {
  Reflect.deleteProperty(window, "dopl");
}

/** Stub `fetch` and record every `(url, init)` the transport handed it. */
function stubFetch(answer: () => unknown): { url: string; init: RequestInit }[] {
  const seen: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return answer();
    })
  );
  return seen;
}

const okJson = (body: unknown) => () => ({
  status: 200,
  statusText: "OK",
  json: async () => body,
});

afterEach(() => {
  Reflect.deleteProperty(window, "dopl");
  vi.unstubAllGlobals();
});

describe("fetchTransport sends the shared headers", () => {
  it("every header the shared builder makes reaches fetch", async () => {
    noBridge();
    const seen = stubFetch(okJson({ ok: true }));

    await sendRequest({
      path: "/api/skills?limit=20",
      method: "PATCH",
      body: { a: 1 },
      workspaceId: "ws-7",
      expectedUpdatedAt: "2026-10-12T00:00:00Z",
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("/api/skills?limit=20");
    expect(seen[0].init.headers).toEqual({
      "x-workspace-id": "ws-7",
      "content-type": "application/json",
      "x-updated-at": "2026-10-12T00:00:00Z",
    });
    // The field the two transports legitimately disagree on.
    expect(seen[0].init.credentials).toBe("same-origin");
  });

  it("content-type keys off body PRESENCE, so an explicit null still sends it", async () => {
    noBridge();
    const seen = stubFetch(okJson({}));

    await sendRequest({ path: "/api/thing", method: "POST", body: null });

    expect(seen[0].init.headers).toEqual({ "content-type": "application/json" });
  });

  it("asks for no headers when the request carries none", async () => {
    noBridge();
    const seen = stubFetch(okJson({}));

    await sendRequest({ path: "/api/boot", method: "GET" });

    expect(seen[0].init.headers).toEqual({});
  });
});

describe("fetchTransport normalizes the answer the shared way", () => {
  it("a 204 is 'no body' and the stream is never read", async () => {
    noBridge();
    const json = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 204, statusText: "No Content", json }))
    );

    const out = await sendRequest({ path: "/api/thing", method: "DELETE" });

    expect(out).toEqual({ status: 204, statusText: "No Content", hasBody: false });
    expect(json).not.toHaveBeenCalled();
  });

  it("parsed JSON arrives as the body", async () => {
    noBridge();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
        statusText: "OK",
        json: async () => ({ hello: "world" }),
      }))
    );

    expect(await sendRequest({ path: "/api/thing", method: "GET" })).toEqual({
      status: 200,
      statusText: "OK",
      hasBody: true,
      body: { hello: "world" },
    });
  });

  it("an unparseable body is 'no body', never a throw", async () => {
    noBridge();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 502,
        statusText: "Bad Gateway",
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        },
      }))
    );

    expect(await sendRequest({ path: "/api/thing", method: "GET" })).toEqual({
      status: 502,
      statusText: "Bad Gateway",
      hasBody: false,
    });
  });

  it("a non-2xx body is still parsed and handed on, envelope intact", async () => {
    noBridge();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 404,
        statusText: "Not Found",
        json: async () => ({ error: { code: "NOPE", message: "nope" } }),
      }))
    );

    expect(await sendRequest({ path: "/api/thing", method: "GET" })).toEqual({
      status: 404,
      statusText: "Not Found",
      hasBody: true,
      body: { error: { code: "NOPE", message: "nope" } },
    });
  });
});
