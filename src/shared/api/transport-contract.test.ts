// @vitest-environment jsdom
/**
 * THE REQUEST CONTRACT BOTH TRANSPORTS SHARE, pinned at the shared module AND at
 * the web client that sends it.
 *
 * `requestHeaders` and `normalizeFetchResponse` were hand-copied in
 * `api-client.ts` and `apps/desktop-ui/src/lib/api-transport.ts`; the twin of
 * this file (`apps/desktop-ui/src/lib/transport-contract.test.ts`) pins the same
 * two behaviours on the renderer's transport, so the pair cannot drift again.
 *
 * Also pins the abort-listener removal on the IPC branch: `{ once: true }` never
 * detaches a listener that did not fire, so racing the signal without an
 * explicit removal leaked one listener per completed request.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeFetchResponse, requestHeaders } from "./api-envelope";
import { apiRequest } from "./api-client";

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
  vi.restoreAllMocks();
});

describe("requestHeaders", () => {
  it("emits all three headers when every input is present", () => {
    expect(
      requestHeaders({
        workspaceId: "ws-1",
        body: { a: 1 },
        expectedUpdatedAt: "2026-10-12T00:00:00Z",
      })
    ).toEqual({
      "x-workspace-id": "ws-1",
      "content-type": "application/json",
      "x-updated-at": "2026-10-12T00:00:00Z",
    });
  });

  it("emits NOTHING when nothing was asked for", () => {
    expect(requestHeaders({})).toEqual({});
  });

  it("content-type keys off body PRESENCE, so an explicit null still sends it", () => {
    expect(requestHeaders({ body: null })).toEqual({
      "content-type": "application/json",
    });
    expect(requestHeaders({ body: undefined })).toEqual({});
  });

  it("an empty workspaceId or updated-at is not a header", () => {
    expect(requestHeaders({ workspaceId: "", expectedUpdatedAt: "" })).toEqual({});
  });
});

describe("normalizeFetchResponse", () => {
  it("a 204 is 'no body' without reading the stream", async () => {
    const json = vi.fn();
    const res = { status: 204, statusText: "No Content", json } as unknown as Response;
    expect(await normalizeFetchResponse(res)).toEqual({
      status: 204,
      statusText: "No Content",
      hasBody: false,
    });
    expect(json).not.toHaveBeenCalled();
  });

  it("parsed JSON arrives as the body", async () => {
    const res = {
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true }),
    } as unknown as Response;
    expect(await normalizeFetchResponse(res)).toEqual({
      status: 200,
      statusText: "OK",
      hasBody: true,
      body: { ok: true },
    });
  });

  it("an UNPARSEABLE body is 'no body', never a throw — on 2xx and on 5xx alike", async () => {
    for (const status of [200, 500]) {
      const res = {
        status,
        statusText: "x",
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        },
      } as unknown as Response;
      expect(await normalizeFetchResponse(res)).toEqual({
        status,
        statusText: "x",
        hasBody: false,
      });
    }
  });
});

describe("api-client fetch branch sends the shared contract", () => {
  it("puts requestHeaders on the wire and normalizes the answer", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return {
        status: 200,
        statusText: "OK",
        json: async () => ({ hello: "world" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await apiRequest<{ hello: string }>("/api/thing", {
      method: "PATCH",
      workspaceId: "ws-9",
      body: { a: 1 },
      expectedUpdatedAt: "2026-10-12T00:00:00Z",
      query: { limit: 20, skip: undefined },
    });

    expect(out).toEqual({ hello: "world" });
    expect(seen).toHaveLength(1);
    // `withQuery` drops the undefined param.
    expect(seen[0].url).toBe("/api/thing?limit=20");
    expect(seen[0].init.method).toBe("PATCH");
    expect(seen[0].init.body).toBe(JSON.stringify({ a: 1 }));
    // ⚠ A LITERAL, never `requestHeaders(…)`: comparing the wire against the
    // helper under test compares it with itself and survives its own mutation.
    expect(seen[0].init.headers).toEqual({
      "x-workspace-id": "ws-9",
      "content-type": "application/json",
      "x-updated-at": "2026-10-12T00:00:00Z",
    });
    expect(seen[0].init.credentials).toBe("same-origin");
  });

  it("a 204 resolves undefined and never reads the body", async () => {
    const json = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 204, statusText: "No Content", json }))
    );
    await expect(apiRequest("/api/thing", { method: "DELETE" })).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });
});

describe("api-client IPC branch — the abort listener is detached", () => {
  /** Counts add/remove on one signal while leaving real behaviour intact. */
  function watchSignal(signal: AbortSignal) {
    const added: string[] = [];
    const removed: string[] = [];
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    vi.spyOn(signal, "addEventListener").mockImplementation(((
      type: string,
      listener: EventListenerOrEventListenerObject,
      opts?: boolean | AddEventListenerOptions
    ) => {
      added.push(type);
      return add(type, listener, opts);
    }) as typeof signal.addEventListener);
    vi.spyOn(signal, "removeEventListener").mockImplementation(((
      type: string,
      listener: EventListenerOrEventListenerObject,
      opts?: boolean | EventListenerOptions
    ) => {
      removed.push(type);
      return remove(type, listener, opts);
    }) as typeof signal.removeEventListener);
    return { added, removed };
  }

  it("removes the abort listener when the CALL wins the race", async () => {
    installBridge(async () => ({
      status: 200,
      statusText: "OK",
      hasBody: true,
      body: { ok: true },
    }));
    const ctrl = new AbortController();
    const seen = watchSignal(ctrl.signal);

    await expect(
      apiRequest("/api/boot", { signal: ctrl.signal })
    ).resolves.toEqual({ ok: true });

    expect(seen.added).toEqual(["abort"]);
    expect(seen.removed).toEqual(["abort"]);
  });

  it("removes it when the call REJECTS too", async () => {
    installBridge(async () => {
      throw new Error("dopl: refused");
    });
    const ctrl = new AbortController();
    const seen = watchSignal(ctrl.signal);

    await expect(apiRequest("/api/boot", { signal: ctrl.signal })).rejects.toThrow();

    expect(seen.added).toEqual(["abort"]);
    expect(seen.removed).toEqual(["abort"]);
  });

  it("the caller's own abort still rejects as AbortError (unchanged)", async () => {
    installBridge(() => new Promise(() => {}));
    const ctrl = new AbortController();
    const pending = apiRequest("/api/boot", { signal: ctrl.signal }).catch(
      (e: unknown) => e
    );
    ctrl.abort();
    expect(await pending).toMatchObject({ name: "AbortError" });
  });

  it("an ALREADY-aborted signal rejects without attaching a listener", async () => {
    installBridge(async () => ({
      status: 200,
      statusText: "OK",
      hasBody: true,
      body: {},
    }));
    const ctrl = new AbortController();
    ctrl.abort();
    const seen = watchSignal(ctrl.signal);

    expect(
      await apiRequest("/api/boot", { signal: ctrl.signal }).catch((e: unknown) => e)
    ).toMatchObject({ name: "AbortError" });

    expect(seen.added).toEqual([]);
  });
});
