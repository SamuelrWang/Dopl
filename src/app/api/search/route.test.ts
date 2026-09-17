/**
 * `GET /api/search`. What is under test is the COMPOSITION, not the service:
 * auth is mocked at the wrapper so the wrapper's own configuration — that it is
 * `withUserAuth` and NOT `withWorkspaceAuth`, and that it carries neither
 * `sessionOnly` nor `writeScopeExempt` — is assertable as part of the contract.
 * Same idiom as `agent-templates/route.test.ts`.
 *
 * The properties that fail quietly:
 *  - 🔒 **THE CREDENTIAL'S CONTAINER LOCK REACHES THE SERVICE.** This route is
 *    `withUserAuth`, so nothing upstream applies B1 (INVARIANTS §4/§10, R3) — a
 *    handler that dropped `apiKeyWorkspaceId` would let a locked credential
 *    search every container its operator belongs to, and no service test can see
 *    that.
 *  - 🔒 **`container` IS REFUSED UNDER `scope=account`, NOT IGNORED.** A scoping
 *    parameter that silently does nothing gives one endpoint two answers to the
 *    question it exists to answer whole.
 *  - **A 400 IS THE NESTED ENVELOPE** — `{error:{code,message}}` (INVARIANTS §2:
 *    a NEW route uses the nested shape).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const AUTH: {
  userId: string;
  credentialSubjectUserId: string | null;
  apiKeyWorkspaceId: string | null;
} = {
  userId: "user-1",
  credentialSubjectUserId: "user-1",
  apiKeyWorkspaceId: null,
};

/** Captured so a test can assert the wrapper's config — it IS the contract. */
const wrapperOptions: Array<Record<string, unknown> | undefined> = [];

vi.mock("@/shared/auth/with-auth", () => ({
  withUserAuth:
    (
      handler: (req: NextRequest, ctx: typeof AUTH) => Promise<Response>,
      options?: Record<string, unknown>
    ) =>
    (req: NextRequest) => {
      wrapperOptions.push(options);
      return handler(req, AUTH);
    },
}));

vi.mock("@/features/search/server/service", () => ({ runSearch: vi.fn() }));

import { GET } from "./route";
import { runSearch } from "@/features/search/server/service";
import { HttpError } from "@/shared/lib/http-error";

const mockRun = vi.mocked(runSearch);

const EMPTY = { q: "", scope: "account" as const, tookMs: 1, groups: [] };

function req(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/search${query}`, {
    method: "GET",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  wrapperOptions.length = 0;
  AUTH.apiKeyWorkspaceId = null;
  mockRun.mockResolvedValue(EMPTY);
});

describe("the wrapper", () => {
  it("is withUserAuth with NO caller-type options", async () => {
    await GET(req("?q=zephyr"), { params: Promise.resolve({}) });
    // ⚠ A `GET`, and an agent token is a caller it is built for. Adding
    // `sessionOnly` here would break every MCP reader of this surface.
    expect(wrapperOptions[0]).toBeUndefined();
  });
});

describe("params", () => {
  it("defaults scope to account", async () => {
    await GET(req("?q=zephyr"), { params: Promise.resolve({}) });
    expect(mockRun.mock.calls[0]?.[1]).toEqual({
      q: "zephyr",
      scope: "account",
      container: undefined,
    });
  });

  it("400s scope=container with no container", async () => {
    const res = await GET(req("?q=zephyr&scope=container"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "VALIDATION_FAILED" },
    });
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("400s a container that is not a uuid", async () => {
    const res = await GET(req("?q=zephyr&scope=container&container=nope"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(400);
  });

  it("400s an unknown scope", async () => {
    const res = await GET(req("?q=zephyr&scope=everything"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(400);
  });

  it("🔒 400s a container sent alongside scope=account", async () => {
    const res = await GET(
      req("?q=zephyr&container=6f1c9b6e-6a63-4f0e-9a2e-2f5b0a6f1c9b"),
      { params: Promise.resolve({}) }
    );
    expect(res.status).toBe(400);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("does NOT 400 a short query — the service answers it empty", async () => {
    const res = await GET(req("?q=a"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(mockRun.mock.calls[0]?.[1]).toMatchObject({ q: "a" });
  });

  it("does NOT 400 an absent query", async () => {
    const res = await GET(req(""), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(mockRun.mock.calls[0]?.[1]).toMatchObject({ q: undefined });
  });
});

describe("🔒 the credential axes", () => {
  it("passes the container lock through as lockedWorkspaceId", async () => {
    AUTH.apiKeyWorkspaceId = "ws-locked";
    await GET(req("?q=zephyr"), { params: Promise.resolve({}) });
    expect(mockRun.mock.calls[0]?.[0]).toEqual({
      userId: "user-1",
      credentialSubjectUserId: "user-1",
      lockedWorkspaceId: "ws-locked",
    });
  });

  it("passes an absent lock as null, never undefined", async () => {
    await GET(req("?q=zephyr"), { params: Promise.resolve({}) });
    expect(mockRun.mock.calls[0]?.[0]).toMatchObject({
      lockedWorkspaceId: null,
    });
  });

  it("carries the SUBJECT axis, which every visibility arm reads", async () => {
    AUTH.credentialSubjectUserId = null;
    await GET(req("?q=zephyr"), { params: Promise.resolve({}) });
    expect(mockRun.mock.calls[0]?.[0]).toMatchObject({
      credentialSubjectUserId: null,
    });
    AUTH.credentialSubjectUserId = "user-1";
  });
});

describe("errors", () => {
  it("surfaces the service's 403 in the nested envelope", async () => {
    mockRun.mockRejectedValue(
      new HttpError(403, "SEARCH_CONTAINER_FORBIDDEN", "No access")
    );
    const res = await GET(
      req("?q=zephyr&scope=container&container=6f1c9b6e-6a63-4f0e-9a2e-2f5b0a6f1c9b"),
      { params: Promise.resolve({}) }
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "SEARCH_CONTAINER_FORBIDDEN", message: "No access" },
    });
  });

  it("never caches — the answer is per-caller and per-keystroke", async () => {
    const res = await GET(req("?q=zephyr"), { params: Promise.resolve({}) });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
