/**
 * 🔒 **`GET /api/ontology` CARRIES THE SNAPSHOT'S CLIP MARKER TO EVERY CLIENT**
 * (cleanup O03; Samuel #2935). `server/service-reads.ts › getSnapshot` sets
 * `truncated`; this route must hand it on unchanged, and `OntologySnapshot`
 * declares it (optional) so a typed client can read it.
 *
 * The ≤ 1.36.0 retired-name body aliases (`legacy-aliases.ts`) were DELETED 2026-10-11
 * (cleanup, Samuel #3738: the desktop floor is 1.39.0); an old version header now gets
 * exactly the current body.
 *
 * MUTATION-VERIFY (each alone turns the named case red):
 *  - re-add any version-gated key to the body → "an old desktop" case.
 *  - drop `truncated?: boolean` from `OntologySnapshot` → the type pin fails to
 *    compile (`expectTypeOf` is a compile-time check; proven with a scoped tsc).
 */

import { describe, it, expect, expectTypeOf, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import type { OntologySnapshot } from "@/features/ontology/types";

const auth = vi.hoisted(() => ({ appVersion: undefined as string | undefined }));

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth:
    (handler: (req: Request, ctx: WorkspaceAuthContext) => Promise<Response>) =>
    (req: Request) =>
      handler(req, {
        userId: "user-1",
        credentialSubjectUserId: "user-1",
        workspaceId: "ws-1",
        workspaceSlug: "acme",
        workspacePublicId: "pub-1",
        role: "member",
        apiKeyWorkspaceId: null,
        appVersion: auth.appVersion,
      } as WorkspaceAuthContext),
}));

vi.mock("@/features/ontology/server/service", () => ({
  buildOntologyContext: () => ({}),
  getSnapshot: vi.fn(),
  getSummary: vi.fn(),
}));

import { GET } from "./route";
import { getSnapshot } from "@/features/ontology/server/service";

const SNAPSHOT = { ontologies: [], objects: {}, homeSpaceOntologyIds: [], truncated: true };

async function getBody(): Promise<Record<string, unknown>> {
  const res = await GET(new NextRequest("http://localhost/api/ontology"), {
    params: Promise.resolve({}),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.appVersion = undefined;
  vi.mocked(getSnapshot).mockResolvedValue(SNAPSHOT);
});

describe("GET /api/ontology — the clip marker reaches the client", () => {
  it("a current client gets `truncated` as the service set it", async () => {
    expect((await getBody()).truncated).toBe(true);
  });

  it("an old desktop (1.36.0 header) gets exactly the current body: no retired keys", async () => {
    const current = await getBody();
    auth.appVersion = "1.36.0";
    expect(await getBody()).toEqual(current);
  });

  it("OntologySnapshot declares it, optional", () => {
    expectTypeOf<OntologySnapshot["truncated"]>().toEqualTypeOf<boolean | undefined>();
  });
});
