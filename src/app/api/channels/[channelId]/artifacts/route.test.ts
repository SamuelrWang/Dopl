/**
 * **AN UNKNOWN ARTIFACT ID IS A 404, NOT A 500** (Review 40 quick-check,
 * 2026-10-12).
 *
 * ⚠ **THIS WAS A LIVE BUG, NOT A HYPOTHETICAL.** `ArtifactNotFoundError` was
 * declared in `service-artifacts.ts` rather than `errors.ts`, so
 * `mapChannelError` had no arm for it and `http-mapping-completeness.test.ts`
 * could not see it either — the gate enumerates `errors.ts`. A GET for an artifact
 * id that does not resolve in this channel answered **500**.
 *
 * ⚠ **AND 500 IS THE WRONG ANSWER IN THE ONE WAY THAT MATTERS**: it is the status
 * a client is entitled to RETRY. An id that does not resolve will not resolve on
 * the second attempt either, so the retry loop is indefinite — and it reads to an
 * operator as a server fault rather than a bad request.
 *
 * The route's own catch is `toChannelErrorResponse`, so this asserts the whole
 * path an agent actually hits: service throws → route maps → status on the wire.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";

const AUTH = {
  userId: "u-1",
  workspaceId: "w-1",
  params: { channelId: "c-1" },
} as unknown as WorkspaceAuthContext;

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth:
    (handler: (req: NextRequest, ctx: WorkspaceAuthContext) => Promise<Response>) =>
    (req: NextRequest) =>
      handler(req, AUTH),
}));

// ⚠ The ERROR CLASS IS NOT MOCKED — it comes from the real `errors.ts`, because
// `mapChannelError` matches on `instanceof` and a mocked class would make the
// mapping arm unreachable while the test still passed for the wrong reason.
vi.mock("@/features/channels/server/service", async () => {
  const errors = await import("@/features/channels/server/errors");
  return {
    buildChannelContext: (auth: WorkspaceAuthContext) => ({
      userId: auth.userId,
      workspaceId: auth.workspaceId,
    }),
    listChannelArtifacts: vi.fn(),
    readArtifact: vi.fn(),
    applyArtifactAction: vi.fn(),
    ArtifactNotFoundError: errors.ArtifactNotFoundError,
  };
});

import { GET } from "./route";
import { readArtifact } from "@/features/channels/server/service";
import { ArtifactNotFoundError } from "@/features/channels/server/errors";

function get(query: string) {
  return GET(
    new NextRequest(`http://x/api/channels/c-1/artifacts${query}`),
    { params: Promise.resolve({ channelId: "c-1" }) } as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/channels/[channelId]/artifacts", () => {
  it("🔒 an unknown artifact id is 404 — it answered 500 until 2026-10-12", async () => {
    vi.mocked(readArtifact).mockRejectedValue(new ArtifactNotFoundError("art-nope"));
    const res = await get("?artifact=art-nope");
    expect(res.status).toBe(404);
  });

  it("🔒 and the body names the code, so a client can branch on it", async () => {
    vi.mocked(readArtifact).mockRejectedValue(new ArtifactNotFoundError("art-nope"));
    const res = await get("?artifact=art-nope");
    const body = (await res.json()) as { error?: { code?: string } };
    expect(JSON.stringify(body)).toContain("ARTIFACT_NOT_FOUND");
  });

  it("🔒 the message never says whether the id exists elsewhere", async () => {
    // Artifact ids are not probeable across rooms: "not here" and "not anywhere"
    // must be the same answer.
    vi.mocked(readArtifact).mockRejectedValue(new ArtifactNotFoundError("art-nope"));
    const text = JSON.stringify(await (await get("?artifact=art-nope")).json());
    expect(text).not.toMatch(/another channel|elsewhere|other room/i);
  });
});
