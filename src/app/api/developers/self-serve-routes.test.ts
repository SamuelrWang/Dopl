/**
 * The P3 self-serve `/api/developers/*` routes. Auth is mocked at the wrapper so its options are
 * assertable (rotate/route.test.ts idiom); the service is mocked, its rules have their own suite
 * (`portal-admin.test.ts`). The properties that fail quietly:
 *  - 🔒 every handler is `sessionOnly` (an agent token never mints, revokes or grants);
 *  - 🔒 a malformed path id is 404 and reaches no service call;
 *  - 🔒 a secret (key, invite link) comes back with `no-store`;
 *  - the service's HttpError status/code pass through; anything else is a 500 with no detail.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const wrapperOptions: Array<Record<string, unknown> | undefined> = [];
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

const svc = {
  createOrgWithProject: vi.fn(),
  createProject: vi.fn(),
  changeMemberRole: vi.fn(),
  removeMember: vi.fn(),
  createProjectKey: vi.fn(),
  revokeProjectKey: vi.fn(),
  createInvite: vi.fn(),
  revokeInvite: vi.fn(),
  acceptInvite: vi.fn(),
};
vi.mock("@/features/device-sdk/server/portal-admin", () => ({
  createOrgWithProject: (...a: unknown[]) => svc.createOrgWithProject(...a),
  createProject: (...a: unknown[]) => svc.createProject(...a),
  changeMemberRole: (...a: unknown[]) => svc.changeMemberRole(...a),
  removeMember: (...a: unknown[]) => svc.removeMember(...a),
  createProjectKey: (...a: unknown[]) => svc.createProjectKey(...a),
  revokeProjectKey: (...a: unknown[]) => svc.revokeProjectKey(...a),
}));
vi.mock("@/features/device-sdk/server/portal-invites", () => ({
  createInvite: (...a: unknown[]) => svc.createInvite(...a),
  revokeInvite: (...a: unknown[]) => svc.revokeInvite(...a),
  acceptInvite: (...a: unknown[]) => svc.acceptInvite(...a),
}));

import { HttpError } from "@/shared/lib/http-error";
import * as orgs from "./orgs/route";
import * as projects from "./orgs/[orgId]/projects/route";
import * as invites from "./orgs/[orgId]/invites/route";
import * as members from "./orgs/[orgId]/members/[memberId]/route";
import * as invite from "./invites/[inviteId]/route";
import * as accept from "./invites/accept/route";
import * as keys from "./projects/[projectId]/keys/route";
import * as key from "./keys/[keyId]/route";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Handler = (req: NextRequest, rc: { params: Promise<Record<string, string>> }) => Promise<Response>;
const call = (h: unknown, method: string, params: Record<string, string> = {}, body?: unknown) =>
  (h as Handler)(
    new NextRequest("http://x/api/developers", {
      method,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve(params) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  wrapperOptions.length = 0;
});

describe("self-serve routes", () => {
  const all: Array<[string, unknown, string, Record<string, string>, unknown]> = [
    ["POST orgs", orgs.POST, "POST", {}, { orgName: "a", projectName: "b" }],
    ["POST projects", projects.POST, "POST", { orgId: ID }, { name: "p" }],
    ["POST invites", invites.POST, "POST", { orgId: ID }, { email: "a@b.co", role: "developer" }],
    ["PATCH member", members.PATCH, "PATCH", { orgId: ID, memberId: ID2 }, { role: "admin" }],
    ["DELETE member", members.DELETE, "DELETE", { orgId: ID, memberId: ID2 }, undefined],
    ["DELETE invite", invite.DELETE, "DELETE", { inviteId: ID }, undefined],
    ["POST accept", accept.POST, "POST", {}, { token: "t" }],
    ["POST keys", keys.POST, "POST", { projectId: ID }, { env: "test", kind: "secret" }],
    ["DELETE key", key.DELETE, "DELETE", { keyId: ID }, undefined],
  ];

  it.each(all)("🔒 %s is sessionOnly", async (_label, h, method, params, body) => {
    await call(h, method, params, body);
    expect(wrapperOptions[0]).toEqual({ sessionOnly: true });
  });

  it.each([
    ["projects", projects.POST, "POST", { orgId: "x" }, { name: "p" }],
    ["invites", invites.POST, "POST", { orgId: "x" }, { email: "a@b.co" }],
    ["member", members.DELETE, "DELETE", { orgId: ID, memberId: "x" }, undefined],
    ["invite", invite.DELETE, "DELETE", { inviteId: "x" }, undefined],
    ["keys", keys.POST, "POST", { projectId: "x" }, { env: "test" }],
    ["key", key.DELETE, "DELETE", { keyId: "../x" }, undefined],
  ] as const)("🔒 %s: malformed id is 404 with no service call", async (_l, h, method, params, body) => {
    const res = await call(h, method, params, body);
    expect(res.status).toBe(404);
    for (const fn of Object.values(svc)) expect(fn).not.toHaveBeenCalled();
  });

  it("400s a non-object body", async () => {
    expect((await call(orgs.POST, "POST", {}, "not json")).status).toBe(400);
    expect((await call(orgs.POST, "POST", {}, [1])).status).toBe(400);
    expect((await call(accept.POST, "POST", {}, { token: 5 })).status).toBe(400);
    expect(svc.createOrgWithProject).not.toHaveBeenCalled();
    expect(svc.acceptInvite).not.toHaveBeenCalled();
  });

  it("🔒 key create returns the secret once with no-store and passes only env + kind", async () => {
    svc.createProjectKey.mockResolvedValue({ secret: "sk_test_RAW", key: { id: "k" } });
    const res = await call(keys.POST, "POST", { projectId: ID }, { env: "test", kind: "secret", scopes: ["x"] });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ secret: "sk_test_RAW", key: { id: "k" } });
    expect(svc.createProjectKey).toHaveBeenCalledWith("u1", ID, { env: "test", kind: "secret" });
  });

  it("🔒 invite create answers the link path once with no-store", async () => {
    svc.createInvite.mockResolvedValue({ token: "TOKEN", invite: { id: "i" } });
    const res = await call(invites.POST, "POST", { orgId: ID }, { email: "a@b.co", role: "developer" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ invite: { id: "i" }, path: "/developers/invite/TOKEN" });
  });

  it("passes a service HttpError through, hides anything else", async () => {
    svc.revokeProjectKey.mockRejectedValue(new HttpError(409, "KEY_REVOKED", "already"));
    const res = await call(key.DELETE, "DELETE", { keyId: ID });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "KEY_REVOKED" } });

    vi.spyOn(console, "error").mockImplementation(() => {});
    svc.revokeProjectKey.mockRejectedValue(new Error("db exploded: secret detail"));
    const res2 = await call(key.DELETE, "DELETE", { keyId: ID });
    expect(res2.status).toBe(500);
    expect(JSON.stringify(await res2.json())).not.toContain("secret detail");
  });

  it("member PATCH forwards the role; DELETE forwards the ids", async () => {
    await call(members.PATCH, "PATCH", { orgId: ID, memberId: ID2 }, { role: "admin" });
    expect(svc.changeMemberRole).toHaveBeenCalledWith("u1", ID, ID2, "admin");
    await call(members.DELETE, "DELETE", { orgId: ID, memberId: ID2 });
    expect(svc.removeMember).toHaveBeenCalledWith("u1", ID, ID2);
  });
});
