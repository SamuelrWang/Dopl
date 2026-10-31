/**
 * `POST /api/developers/keys/{keyId}/rotate` (W1.3). Auth is mocked at the wrapper so its config
 * is assertable (search/route.test.ts idiom). The properties that fail quietly:
 *  - 🔒 `sessionOnly`: an agent token never mints a key;
 *  - 🔒 a key outside the caller's projects is 404 (indistinguishable from missing), and
 *    rotateApiKey is never reached;
 *  - 🔒 a `developer` member is 403; owner/admin rotate;
 *  - the raw key comes back once with `no-store`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const wrapperOptions: Array<Record<string, unknown> | undefined> = [];
const KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

vi.mock("@/shared/auth/with-auth", () => ({
  withUserAuth:
    (
      handler: (req: NextRequest, ctx: { userId: string; params?: Record<string, string> }) => Promise<Response>,
      options?: Record<string, unknown>
    ) =>
    (req: NextRequest, rc: { params: Promise<Record<string, string>> }) => {
      wrapperOptions.push(options);
      return rc.params.then((params) => handler(req, { userId: "u1", params }));
    },
}));

const getKeyProject = vi.fn();
const listPortalProjects = vi.fn();
const rotateApiKey = vi.fn();
vi.mock("@/features/device-sdk/server/portal", () => ({
  getKeyProject: (...a: unknown[]) => getKeyProject(...a),
  listPortalProjects: (...a: unknown[]) => listPortalProjects(...a),
}));
vi.mock("@/features/device-sdk/server/keys", () => {
  class KeyNotRotatableError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  }
  return { KeyNotRotatableError, rotateApiKey: (...a: unknown[]) => rotateApiKey(...a), lockedKeyIds: async () => [] };
});

import { POST } from "./route";

const project = (id: string, role: string) => ({
  id,
  name: id,
  apiVersion: "2026-10-27",
  org: { id: "o", name: "o", internal: false },
  role,
});

const call = (keyId = KEY) =>
  POST(new NextRequest(`http://x/api/developers/keys/${keyId}/rotate`, { method: "POST" }), {
    params: Promise.resolve({ keyId }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  wrapperOptions.length = 0;
});

describe("rotate route", () => {
  it("is sessionOnly", async () => {
    getKeyProject.mockResolvedValue(null);
    listPortalProjects.mockResolvedValue([]);
    await call();
    expect(wrapperOptions[0]).toEqual({ sessionOnly: true });
  });

  it("404s a malformed id without reading", async () => {
    const res = await call("nope");
    expect(res.status).toBe(404);
    expect(getKeyProject).not.toHaveBeenCalled();
  });

  it("404s a key in someone else's project", async () => {
    getKeyProject.mockResolvedValue({ projectId: "p-other", revokedAt: null, expiresAt: null });
    listPortalProjects.mockResolvedValue([project("p1", "owner")]);
    const res = await call();
    expect(res.status).toBe(404);
    expect(rotateApiKey).not.toHaveBeenCalled();
  });

  it("403s a developer member", async () => {
    getKeyProject.mockResolvedValue({ projectId: "p1", revokedAt: null, expiresAt: null });
    listPortalProjects.mockResolvedValue([project("p1", "developer")]);
    expect((await call()).status).toBe(403);
    expect(rotateApiKey).not.toHaveBeenCalled();
  });

  it.each([
    ["revoked", { revokedAt: "2026-10-01T00:00:00.000Z", expiresAt: null }, "KEY_REVOKED"],
    ["expired", { revokedAt: null, expiresAt: "2020-01-01T00:00:00.000Z" }, "KEY_EXPIRED"],
    ["in its overlap window", { revokedAt: null, expiresAt: "2999-01-01T00:00:00.000Z" }, "KEY_ROTATING"],
  ])("409s a %s key without minting", async (_label, life, code) => {
    getKeyProject.mockResolvedValue({ projectId: "p1", ...life });
    listPortalProjects.mockResolvedValue([project("p1", "admin")]);
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code } });
    expect(rotateApiKey).not.toHaveBeenCalled();
  });

  it("🔒 an internal org's admin cannot rotate: only its owner", async () => {
    getKeyProject.mockResolvedValue({ projectId: "p1", revokedAt: null, expiresAt: null });
    listPortalProjects.mockResolvedValue([{ ...project("p1", "admin"), org: { id: "o", name: "o", internal: true } }]);
    const res = await call();
    expect(res.status).toBe(409);
    expect(rotateApiKey).not.toHaveBeenCalled();
  });

  it("maps a lost check→rotate race to 409, not 500", async () => {
    getKeyProject.mockResolvedValue({ projectId: "p1", revokedAt: null, expiresAt: null });
    listPortalProjects.mockResolvedValue([project("p1", "owner")]);
    const { KeyNotRotatableError } = await import("@/features/device-sdk/server/keys");
    rotateApiKey.mockRejectedValue(new KeyNotRotatableError("KEY_ROTATING", "This key is already being rotated"));
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "KEY_ROTATING" } });
  });

  it("rotates for an owner and returns the secret once, no-store", async () => {
    getKeyProject.mockResolvedValue({ projectId: "p1", revokedAt: null, expiresAt: null });
    listPortalProjects.mockResolvedValue([project("p1", "owner")]);
    rotateApiKey.mockResolvedValue({
      secret: "sk_test_RAW",
      key: { id: "new" },
      previous: { id: KEY, expires_at: "2026-10-29T00:00:00.000Z" },
    });
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ secret: "sk_test_RAW", previous: { id: KEY } });
    expect(rotateApiKey).toHaveBeenCalledWith({ projectId: "p1", keyId: KEY });
  });
});
