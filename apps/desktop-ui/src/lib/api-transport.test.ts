import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/shared/api/api-envelope";
import { installBridge } from "#/test-utils/bridge";
import { apiRequest } from "./api";

/**
 * The SPA's IPC transport: a request that never got an answer reaches every
 * caller as a NetworkError — whether the new main answered the status 0
 * envelope or an older main rejected with Electron's wrapper text.
 */

const ELECTRON_WRAPPED =
  "Error invoking remote method 'dopl:api-request': TypeError: fetch failed";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ipcTransport", () => {
  it("the status 0 envelope rejects as a NetworkError", async () => {
    installBridge({
      apiRequest: vi.fn(async () => ({
        status: 0,
        statusText: "",
        hasBody: true,
        body: { error: { code: "NETWORK_TIMEOUT" } },
      })),
    });
    const err = await apiRequest("/api/boot").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as ApiError).code).toBe("NETWORK_TIMEOUT");
  });

  it("an older main's rejection is mapped, never passed through", async () => {
    installBridge({ apiRequest: vi.fn(async () => { throw new Error(ELECTRON_WRAPPED); }) });
    const err = await apiRequest("/api/boot").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as Error).message).toBe("Can't reach Dopl.");
  });

  it("a bridge refusal becomes a generic ApiError(0)", async () => {
    installBridge({ apiRequest: vi.fn(async () => { throw new Error("dopl: refused"); }) });
    const err = await apiRequest("/api/boot").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(NetworkError);
    expect((err as Error).message).toBe("Dopl ran into a problem.");
  });

  it("the caller's own abort still wins", async () => {
    installBridge({ apiRequest: vi.fn(() => new Promise(() => {})) });
    const ctrl = new AbortController();
    const pending = apiRequest("/api/boot", { signal: ctrl.signal }).catch((e: unknown) => e);
    ctrl.abort(new DOMException("Aborted", "AbortError"));
    expect(await pending).toMatchObject({ name: "AbortError" });
  });
});
