/**
 * INVARIANT SUITE — ontology object create route: over-free-cap 403 body.
 *
 * When the service throws EntitlementError, the POST handler must answer
 * HTTP 403 with the friendly upgrade envelope ({ error: "over_free_cap",
 * message, upgrade_url }) rather than a generic 500. Auth + service are
 * mocked so this exercises the route's error mapping in isolation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { EntitlementError } from "@/features/billing/server/entitlements";

const AUTH: WorkspaceAuthContext = {
  userId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "acme",
  workspacePublicId: "pub-1",
  role: "member",
  apiKeyWorkspaceId: null,
};

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth:
    (handler: (req: Request, ctx: WorkspaceAuthContext) => Promise<Response>) =>
    (req: Request) =>
      handler(req, AUTH),
}));

vi.mock("@/features/ontology/server/service", () => ({
  buildOntologyContext: (auth: WorkspaceAuthContext) => ({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
  }),
  createObject: vi.fn(),
}));

import { POST } from "./route";
import { createObject } from "@/features/ontology/server/service";

const mockCreate = vi.mocked(createObject);

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/ontology/objects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  name: "Sales Rep",
  clusterId: "11111111-1111-4111-8111-111111111111",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/ontology/objects — free-cap denial", () => {
  it("maps EntitlementError to a 403 over_free_cap envelope", async () => {
    mockCreate.mockRejectedValue(new EntitlementError("ws-1"));

    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error).toBe("over_free_cap");
    expect(body.message.toLowerCase()).toContain("upgrade");
    expect(body.upgrade_url).toMatch(/\/billing\?billing=upgrade$/);
  });

  it("returns 201 with the created object on success", async () => {
    mockCreate.mockResolvedValue({
      id: "obj-1",
      name: "Sales Rep",
      subtitle: "",
      attributes: [],
      methods: [],
      template: [],
      relationships: [],
      childIds: [],
    });

    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.object.id).toBe("obj-1");
  });
});
