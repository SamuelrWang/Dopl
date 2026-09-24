// @vitest-environment jsdom
/**
 * A request that never got an answer, end to end on the renderer side: the
 * desktop bridge's `status: 0` envelope, an older main's Electron-wrapped
 * rejection, and the browser's `TypeError: Failed to fetch` all reach callers
 * as the same `NetworkError` — through the real `apiRequest`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  GENERIC_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  NetworkError,
  apiErrorFrom,
  decodeResponse,
  isNetworkError,
  transportFailure,
} from "./api-envelope";
import { apiRequest } from "./api-client";

const ELECTRON_WRAPPED =
  "Error invoking remote method 'dopl:api-request': TypeError: fetch failed";

function installBridge(apiRequestImpl: (...args: unknown[]) => Promise<unknown>) {
  Object.defineProperty(window, "dopl", {
    configurable: true,
    writable: true,
    value: {
      apiRequest: apiRequestImpl,
      getAuthState: async () => ({ signedIn: true, userId: "u" }),
      openExternal: async () => ({ ok: true }),
    },
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, "dopl");
  vi.unstubAllGlobals();
});

describe("decodeResponse — the bridge's status 0 envelope", () => {
  it("NETWORK_UNAVAILABLE and NETWORK_TIMEOUT decode to a NetworkError with friendly copy", () => {
    for (const code of ["NETWORK_UNAVAILABLE", "NETWORK_TIMEOUT"]) {
      let thrown: unknown;
      try {
        decodeResponse({ status: 0, statusText: "", hasBody: true, body: { error: { code } } });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(NetworkError);
      expect(thrown).toBeInstanceOf(ApiError);
      expect(isNetworkError(thrown)).toBe(true);
      expect((thrown as ApiError).status).toBe(0);
      expect((thrown as ApiError).code).toBe(code);
      expect((thrown as ApiError).message).toBe(NETWORK_ERROR_MESSAGE);
    }
  });

  it("a bridge failure decodes to a generic ApiError(0), not a network one", () => {
    let thrown: unknown;
    try {
      decodeResponse({ status: 0, statusText: "", hasBody: true, body: { error: { code: "BRIDGE_FAILURE" } } });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect(isNetworkError(thrown)).toBe(false);
    expect((thrown as ApiError).message).toBe(GENERIC_ERROR_MESSAGE);
  });
});

describe("transportFailure", () => {
  it("an older main's Electron-wrapped rejection becomes a NetworkError", () => {
    expect(transportFailure(new Error(ELECTRON_WRAPPED))).toBeInstanceOf(NetworkError);
  });

  it("an older main's timeout becomes NETWORK_TIMEOUT", () => {
    const out = transportFailure(
      new Error("Error invoking remote method 'dopl:api-request': AbortError: This operation was aborted")
    );
    expect((out as ApiError).code).toBe("NETWORK_TIMEOUT");
  });

  it("a bridge refusal becomes a generic ApiError(0) carrying no raw text", () => {
    const out = transportFailure(new Error("Error invoking remote method 'dopl:api-request': Error: dopl: refused"));
    expect(out).toBeInstanceOf(ApiError);
    expect(isNetworkError(out)).toBe(false);
    expect((out as Error).message).toBe(GENERIC_ERROR_MESSAGE);
  });

  it("the caller's own abort passes through untouched", () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const abort = new DOMException("Aborted", "AbortError");
    expect(transportFailure(abort, ctrl.signal)).toBe(abort);
  });
});

describe("isNetworkError", () => {
  it("recognises a feature client's re-wrap by status 0 + NETWORK_ code", () => {
    class ChannelApiError extends Error {
      constructor(readonly status: number, readonly code: string, message: string) {
        super(message);
      }
    }
    expect(isNetworkError(new ChannelApiError(0, "NETWORK_UNAVAILABLE", "x"))).toBe(true);
    expect(isNetworkError(new ChannelApiError(0, "BRIDGE_FAILURE", "x"))).toBe(false);
    expect(isNetworkError(new ChannelApiError(503, "NETWORK_UNAVAILABLE", "x"))).toBe(false);
  });

  it("recognises the raw browser and undici fetch TypeErrors", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new TypeError("fetch failed"))).toBe(true);
    expect(isNetworkError(new TypeError("x is not a function"))).toBe(false);
  });
});

describe("apiErrorFrom — a raw fetch site's non-2xx answer", () => {
  it("decodes the nested and the flat envelope like apiRequest does", () => {
    const nested = apiErrorFrom(409, { error: { code: "TAKEN", message: "Already taken" } });
    expect([nested.status, nested.code, nested.message]).toEqual([409, "TAKEN", "Already taken"]);
    const flat = apiErrorFrom(400, { error: "Invite expired" });
    expect([flat.status, flat.message]).toEqual([400, "Invite expired"]);
  });
});

describe("apiRequest (web client) — item 9", () => {
  it("the browser's TypeError: Failed to fetch rejects as a NetworkError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(apiRequest("/api/skills")).rejects.toBeInstanceOf(NetworkError);
  });

  it("a caller's abort still rejects as the AbortError TanStack reads as a cancel", async () => {
    const ctrl = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("Aborted", "AbortError"); }));
    ctrl.abort();
    await expect(apiRequest("/api/skills", { signal: ctrl.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("apiRequest (inside the SPA bridge)", () => {
  it("the bridge's status 0 envelope rejects as a NetworkError", async () => {
    installBridge(async () => ({ status: 0, statusText: "", hasBody: true, body: { error: { code: "NETWORK_UNAVAILABLE" } } }));
    await expect(apiRequest("/api/skills")).rejects.toBeInstanceOf(NetworkError);
  });

  it("an older main's rejection never reaches the caller as Electron's text", async () => {
    installBridge(async () => { throw new Error(ELECTRON_WRAPPED); });
    const err = await apiRequest("/api/skills").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as Error).message).not.toContain("invoking remote method");
  });
});
