/**
 * `/api/clusters/[slug]` — the error TAIL, and only the error tail.
 *
 * WHY THIS FILE EXISTS. All three handlers used to end the same way: take
 * `err.message`, decide 404-vs-500 by asking whether it contained "not found",
 * and then send that same raw string to the client as `{ error: <message> }`.
 * `clusters/server/service.ts` phrases its miss as
 * `Error("Cluster not found: <slug>")`, so the tail echoed a workspace's
 * cluster slug back to anyone who could provoke it, and any other throw echoed
 * whatever Postgres/PostgREST had put in `message` — relation names, RPC names
 * (LAUNCH-READINESS-ROADMAP §4, ENGINEERING §9 "Never return raw error
 * strings").
 *
 * The sweep routed the tail through `toHttpErrorResponse` with a local mapper.
 * The two properties that must both hold, and which are easy to break one at a
 * time, are pinned below:
 *
 *   1. the 404 SURVIVES — a miss is still a miss, not a 500;
 *   2. the raw exception text does NOT — neither the slug nor the DB internals
 *      appear anywhere in the response body.
 *
 * A typed `HttpError` (here: `parseJson`'s INVALID_JSON) must still arrive with
 * its own code and status, which is what stops the mapper from flattening every
 * error into NOT_FOUND/INTERNAL_ERROR.
 *
 * Auth is mocked at the wrapper (the `api/knowledge/bases/route.test.ts`
 * idiom) — what is under test is the tail, not `withWorkspaceAuth`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const SLUG = "acme-secret-cluster";

interface Ctx {
  userId: string;
  workspaceId: string;
  role: string;
  params?: Record<string, string>;
}

const AUTH: Ctx = {
  userId: "user-1",
  workspaceId: "ws-1",
  role: "member",
  params: { slug: SLUG },
};

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth:
    (handler: (req: Request, ctx: Ctx) => Promise<Response>) => (req: Request) =>
      handler(req, AUTH),
}));

vi.mock("@/features/clusters/server/service", () => ({
  getCluster: vi.fn(),
  updateCluster: vi.fn(),
  deleteCluster: vi.fn(),
}));

import { GET, PATCH, DELETE } from "./route";
import {
  getCluster,
  updateCluster,
  deleteCluster,
} from "@/features/clusters/server/service";

const mockGet = vi.mocked(getCluster);
const mockUpdate = vi.mocked(updateCluster);
const mockDelete = vi.mocked(deleteCluster);

/** Exactly what `clusters/server/service.ts` throws on a miss. */
const NOT_FOUND = () => new Error(`Cluster not found: ${SLUG}`);
/** A stand-in for the Postgres/PostgREST internals the tail used to echo. */
const DB_INTERNALS = () =>
  new Error('relation "cluster_workflows_v2" does not exist');

function req(body?: string): NextRequest {
  return new NextRequest(`http://localhost/api/clusters/${SLUG}`, {
    method: body === undefined ? "GET" : "PATCH",
    ...(body === undefined ? {} : { body }),
  });
}

type Envelope = { error: { code: string; message: string } };

beforeEach(() => {
  vi.clearAllMocks();
  // The shared tail logs the unmapped error server-side (which is where it
  // belongs); keep it out of the test output.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/clusters/[slug] error tail", () => {
  it("keeps the 404 for a miss without echoing the slug back", async () => {
    mockGet.mockRejectedValue(NOT_FOUND());

    const res = await GET(req());
    // Property 1: the status mapping the string-sniff used to provide.
    expect(res.status).toBe(404);

    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe("NOT_FOUND");
    // Property 2: the slug is the leak — it must not survive anywhere in the
    // body, not just in `message`.
    expect(JSON.stringify(body)).not.toContain(SLUG);
  });

  it("does not echo DB internals on an unmapped failure", async () => {
    mockGet.mockRejectedValue(DB_INTERNALS());

    const res = await GET(req());
    expect(res.status).toBe(500);

    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("cluster_workflows_v2");
    expect(JSON.stringify(body)).not.toContain("does not exist");
  });

  it("a DIFFERENTLY-CASED 'Not Found' is a 500, not a 404", async () => {
    // The predicate is case-SENSITIVE, and this is the reason. It matches the
    // one sentence the cluster service emits; any other producer phrasing a
    // failure with "Not Found" in it — a PostgrestError, a driver, a library —
    // must stay a 500. Lower-casing first would answer a genuine fault with a
    // clean 404 for a cluster that exists, which is the worst of both.
    mockGet.mockRejectedValue(new Error("Relation Not Found: clusters"));

    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(((await res.json()) as Envelope).error.code).toBe("INTERNAL_ERROR");
  });
});

describe("DELETE /api/clusters/[slug] error tail", () => {
  it("keeps the 404 for a miss without echoing the slug back", async () => {
    mockDelete.mockRejectedValue(NOT_FOUND());

    const res = await DELETE(req());
    expect(res.status).toBe(404);

    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe("NOT_FOUND");
    expect(JSON.stringify(body)).not.toContain(SLUG);
  });
});

describe("PATCH /api/clusters/[slug] error tail", () => {
  it("keeps the 404 for a miss without echoing the slug back", async () => {
    mockUpdate.mockRejectedValue(NOT_FOUND());

    const res = await PATCH(req(JSON.stringify({ name: "Renamed" })));
    expect(res.status).toBe(404);

    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe("NOT_FOUND");
    expect(JSON.stringify(body)).not.toContain(SLUG);
  });

  it("still passes a typed HttpError through with its own code and status", async () => {
    // The mapper must not flatten everything: `parseJson` throws
    // HttpError(400, INVALID_JSON) before the service is ever reached.
    const res = await PATCH(req("{ not json"));
    expect(res.status).toBe(400);

    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe("INVALID_JSON");
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
