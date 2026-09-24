/**
 * INVARIANT SUITE — the ontology SHARE route's gates and its wire contract.
 *
 * ⚠ THE WRAPPER OPTIONS ARE PINNED PER METHOD, not per file. `sessionOnly` is
 * what stops a `full`-profile session (Bash, plus its own `dopl_at_*` bearer
 * read off disk) from widening its own operator's audience over loopback — and
 * it must NOT reach the GET, because reading which channels the caller's own
 * ontology already lends into decides nothing. A test that asserted "the file
 * mentions sessionOnly" would pass with the option on the wrong export.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";

const ONTOLOGY_ID = "11111111-1111-4111-8111-111111111111";
const CHANNEL_ID = "22222222-2222-4222-8222-222222222222";

const AUTH: WorkspaceAuthContext = {
  userId: "user-1",
  credentialSubjectUserId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "acme",
  workspacePublicId: "pub-1",
  role: "member",
  apiKeyWorkspaceId: null,
  params: { ontologyId: ONTOLOGY_ID },
};

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth: (
    handler: (req: Request, ctx: WorkspaceAuthContext) => Promise<Response>,
    options?: Record<string, unknown>
  ) => {
    const wrapped = (req: Request) => handler(req, AUTH);
    (wrapped as unknown as { options?: Record<string, unknown> }).options = options;
    return wrapped;
  },
}));

vi.mock("@/features/ontology/server/service", () => ({
  buildOntologyContext: (auth: WorkspaceAuthContext) => ({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    role: auth.role,
    source: "user",
    credentialSubjectUserId: auth.credentialSubjectUserId,
  }),
}));

vi.mock("@/features/ontology/server/service-shares", () => ({
  listOntologyShares: vi.fn(),
  setOntologyShare: vi.fn(),
  unshareOntology: vi.fn(),
}));

import { GET, PUT, DELETE } from "./route";
import {
  listOntologyShares,
  setOntologyShare,
  unshareOntology,
} from "@/features/ontology/server/service-shares";

const mockList = vi.mocked(listOntologyShares);
const mockSet = vi.mocked(setOntologyShare);
const mockUnshare = vi.mocked(unshareOntology);

function optionsOf(handler: unknown): Record<string, unknown> | undefined {
  return (handler as { options?: Record<string, unknown> }).options;
}

function request(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(url, init as never);
}


/** The route-segment argument the real wrapper takes. ⚠ The mock ignores it —
 *  `auth.params` is what the handlers read — but the EXPORTS keep the real
 *  wrapper's signature, and a test that could not type-check against it would
 *  not be testing the route Next.js calls. */
const SEGMENT = { params: Promise.resolve({ ontologyId: ONTOLOGY_ID }) };

const SHARE = {
  channelId: CHANNEL_ID,
  membersLevel: "view",
  guestsLevel: "none",
  ownerAgentsLevel: "edit",
} as const;

beforeEach(() => vi.clearAllMocks());

describe("wrapper options — the floor and the caller-type gate", () => {
  it("the GET is member-floored and NOT session-gated", () => {
    expect(optionsOf(GET)).toEqual({ minRole: "member" });
  });

  it("🔒 the PUT and the DELETE are member-floored AND `sessionOnly`", () => {
    expect(optionsOf(PUT)).toEqual({ minRole: "member", sessionOnly: true });
    expect(optionsOf(DELETE)).toEqual({ minRole: "member", sessionOnly: true });
  });

  it("no method is floored to `guest` — `guest-route-floor.test.ts` reads route SOURCE", () => {
    for (const handler of [GET, PUT, DELETE]) {
      expect(optionsOf(handler)?.minRole).not.toBe("guest");
    }
  });
});

describe("the wire contract", () => {
  it("GET returns canManage plus the share rows", async () => {
    mockList.mockResolvedValue({ canManage: true, shares: [SHARE] });
    const res = await GET(
      request(`http://localhost/api/ontology/ontologies/${ONTOLOGY_ID}/shares`),
      SEGMENT
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ canManage: true, shares: [SHARE] });
  });

  it("PUT upserts one channel's row and answers with it", async () => {
    mockSet.mockResolvedValue(SHARE);
    const res = await PUT(
      request(`http://localhost/api/ontology/ontologies/${ONTOLOGY_ID}/shares`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(SHARE),
      }),
      SEGMENT
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ share: SHARE });
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      ONTOLOGY_ID,
      SHARE
    );
  });

  it("PUT rejects a level outside the ladder with a 400, before the service", async () => {
    const res = await PUT(
      request(`http://localhost/api/ontology/ontologies/${ONTOLOGY_ID}/shares`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...SHARE, membersLevel: "admin" }),
      }),
      SEGMENT
    );
    expect(res.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("DELETE takes ?channelId= and answers 204", async () => {
    mockUnshare.mockResolvedValue(undefined);
    const res = await DELETE(
      request(
        `http://localhost/api/ontology/ontologies/${ONTOLOGY_ID}/shares?channelId=${CHANNEL_ID}`,
        { method: "DELETE" }
      ),
      SEGMENT
    );
    expect(res.status).toBe(204);
    expect(mockUnshare).toHaveBeenCalledWith(expect.anything(), ONTOLOGY_ID, CHANNEL_ID);
  });

  it("DELETE without a channelId is a 400, never a blanket unshare", async () => {
    const res = await DELETE(
      request(`http://localhost/api/ontology/ontologies/${ONTOLOGY_ID}/shares`, {
        method: "DELETE",
      }),
      SEGMENT
    );
    expect(res.status).toBe(400);
    expect(mockUnshare).not.toHaveBeenCalled();
  });
});
