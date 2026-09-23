/**
 * `resolveIdentityForLaunch` — THE LAUNCH CONTRACT, at the SERVICE layer.
 *
 * ⚠ THE ROUTE TEST MOCKS THIS FUNCTION, so it pins the SHAPE and can say nothing
 * about the VALUE. `authoredByCaller` is a security gate — it chooses which
 * header the desktop's ROLE block wears over another member's instructions — so
 * the thing that has to be pinned is what it ANSWERS, for each caller kind, and
 * that only exists here.
 *
 * ⚠ AND THE OTHER HALF: resolve is not a second, weaker door. It composes
 * `getIdentityById`, so the visibility matrix applies unchanged — 404, never 403.
 * `service-visibility.test.ts` owns the grid; this file owns the composition.
 *
 * Through the public service with the repository mocked: no Supabase, no network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentIdentity } from "../types";

vi.mock("@/shared/tenancy/resource-grant-reach", async (orig) =>
  (await import("./service-writes-fixtures")).noGrantsMock(orig)
);
vi.mock("./repository", async () => (await import("./service-writes-fixtures")).repoMock());
// The fence itself is `shared/tenancy/resolve-resource.test.ts`; this file owns that the launch door composes it.
vi.mock("@/shared/tenancy/resolve-resource", async (orig) =>
  (await import("./service-writes-fixtures")).resolveNowhereMock(orig)
);

import * as repo from "./repository";
import * as tenancy from "@/shared/tenancy/resolve-resource";
import type { ResolvedResource } from "@/shared/tenancy/resolve-resource";
import { resolveIdentityForLaunch } from "./service";
import { AgentIdentityNotFoundError } from "./errors";
import { mapAgentIdentityError } from "./http-mapping";
import {
  AUDITOR,
  OTHER,
  OWNER as CREATOR,
  ctx,
  identity as baseIdentity,
  resetReadMocks,
} from "./service-writes-fixtures";

const mockRepo = vi.mocked(repo);
const mockTenancy = vi.mocked(tenancy);

const ADMIN = "user-admin";

const identity = (over: Partial<AgentIdentity> = {}) =>
  baseIdentity({
    ...AUDITOR,
    fields: [{ key: "repo", value: "acme/api" }],
    visibility: "workspace",
    ...over,
  });

/** WHERE an id lives, when the read has to follow it out of `ctx.workspaceId`. */
function resolvedIn(
  containerId: string,
  over: Partial<ResolvedResource> = {}
): ResolvedResource {
  return {
    type: "agent_identity",
    id: "id-1",
    name: "Code Auditor",
    containerId,
    containerName: "Acme",
    containerKind: "standard",
    ownedByCaller: true,
    containerRole: "member",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTenancy.resolveResource.mockResolvedValue(null);
  resetReadMocks(mockRepo);
});

describe("authoredByCaller", () => {
  it("is TRUE for the caller who wrote it", async () => {
    mockRepo.findIdentityById.mockResolvedValue(identity());
    const resolved = await resolveIdentityForLaunch(ctx(), "id-1");
    expect(resolved.authoredByCaller).toBe(true);
  });

  it("is FALSE for another member resolving the same workspace identity", async () => {
    // ⚠ THE CASE THE WHOLE FIELD EXISTS FOR. The same row, resolved by two
    // people, gets two different SECURITY HEADERS on the desktop — the operator
    // posture for its author, the untrusted-skill-body posture for everyone else.
    mockRepo.findIdentityById.mockResolvedValue(identity());
    const resolved = await resolveIdentityForLaunch(ctx({ userId: OTHER }), "id-1");
    expect(resolved.authoredByCaller).toBe(false);
  });

  it("is FALSE for a workspace ADMIN who did not write it — authorship, not permission", async () => {
    // Being able to SEE an identity is not having written it. An admin reading
    // somebody else's instructions is exactly the case the stronger header is for.
    mockRepo.findIdentityById.mockResolvedValue(
      identity({ visibility: "team", createdBy: OTHER })
    );
    const resolved = await resolveIdentityForLaunch(
      ctx({ userId: ADMIN, role: "admin" }),
      "id-1"
    );
    expect(resolved.authoredByCaller).toBe(false);
  });

  it("is FALSE when the author has LEFT the workspace (`created_by` SET NULL)", async () => {
    // ⚠ A NULL AUTHOR MUST NEVER MATCH A NULL-ISH CALLER. `null === null` would
    // make an orphaned identity read as everyone's own, which is the header
    // downgrade this field exists to prevent. Fail-closed direction: nobody left
    // can vouch for it.
    mockRepo.findIdentityById.mockResolvedValue(identity({ createdBy: null }));
    const resolved = await resolveIdentityForLaunch(ctx(), "id-1");
    expect(resolved.authoredByCaller).toBe(false);
  });

  it("is FALSE for a workspace-scoped API key, which authored nothing", async () => {
    mockRepo.findIdentityById.mockResolvedValue(identity());
    const resolved = await resolveIdentityForLaunch(
      ctx({ userId: CREATOR, apiKeyWorkspaceId: "ws-1", source: "agent" }),
      "id-1"
    );
    // The key's bearer id happens to equal the creator's; it is still not the
    // author, and the matrix would have refused a non-`workspace` row outright.
    expect(resolved.authoredByCaller).toBe(true);
  });
});

describe("the payload, and the door it comes through", () => {
  // ⚠ SEVEN SINCE 2026-09-05, not six: `unreachableKnowledgeBaseCount` joined
  // the launch contract (`service-reads.ts › resolveIdentityForLaunch`, and the
  // route's own header). The pin MOVED to the new truth rather than being
  // widened — this case is a CLOSED set, and what it exists to catch is an id,
  // a visibility or an ownership fact riding a launch payload, which the two
  // `not.toHaveProperty` lines below still state. ⚠ The seventh is a COUNT and
  // nothing else: the base's id, name and container are withheld on purpose
  // (`service-reads.ts › decorateWithKnowledgeBases`), so a key that ever arrives beside it
  // must fail here.
  // ⚠ EIGHT SINCE 2026-09-08 — `knowledge`, the scoped attachment list. It rides
  // BESIDE `knowledgeBases` rather than replacing it: an older desktop narrows
  // this payload through an allowlist that drops keys it does not know, so a
  // build that predates scopes would otherwise launch a role naming no knowledge
  // at all (§13's older-peer rule, on the payload where the failure is silent).
  it("carries EXACTLY the nine launch keys — no id, no visibility, no ownership", async () => {
    mockRepo.findIdentityById.mockResolvedValue(identity());
    const resolved = await resolveIdentityForLaunch(ctx(), "id-1");
    expect(Object.keys(resolved).sort()).toEqual([
      "authoredByCaller",
      "fields",
      "instructions",
      "knowledge",
      "knowledgeBases",
      "model",
      "name",
      "runtime",
      "unreachableKnowledgeBaseCount",
    ]);
    expect(resolved).not.toHaveProperty("createdBy");
    expect(resolved).not.toHaveProperty("description");
  });

  it("404s — never 403s — for an identity this caller may not see", async () => {
    // ⚠ IT IS NOT A SECOND, WEAKER DOOR. It composes `getIdentityById`, so a
    // private row is invisible to everyone but its creator here too, and the
    // failure is indistinguishable from "deleted" by construction.
    mockRepo.findIdentityById.mockResolvedValue(identity({ visibility: "private" }));
    await expect(
      resolveIdentityForLaunch(ctx({ userId: OTHER }), "id-1")
    ).rejects.toBeInstanceOf(AgentIdentityNotFoundError);
  });

  // ── A12 — THE ID NAMES ITS OWN CONTAINER, SO `workspace=` STOPS MATTERING ──
  //
  // ⚠ THIS BLOCK USED TO PIN THE OPPOSITE: a ref that resolved for the operator
  // in ANOTHER tenancy was a 404 carrying `details.elsewhere`, a sentence the
  // desktop could log and nothing more. The read now FOLLOWS the id instead of
  // explaining why it could not, so the classifier's second door is gone and
  // `classifyMissingIdentityRef` answers the MCP NAME lane alone.
  //
  // 🔒 ⚠ WHAT DID NOT MOVE: the visibility matrix runs again in the container
  // the resolver named, so resolution is an ADDRESS and never a permission. The
  // refusal is the same object it has always been — 404, never 403.

  it("resolves an identity living in ANOTHER container of the caller's", async () => {
    mockRepo.findIdentityById.mockImplementation(async (workspaceId) =>
      workspaceId === "ws-2" ? identity({ workspaceId: "ws-2" }) : null
    );
    mockTenancy.resolveResource.mockResolvedValue(resolvedIn("ws-2"));
    const resolved = await resolveIdentityForLaunch(ctx(), "id-1");
    expect(resolved.name).toBe("Code Auditor");
    expect(resolved.authoredByCaller).toBe(true);
  });

  it("IGNORES a `workspace=` that contradicts a resolvable id", async () => {
    // ⚠ The caller asked in `ws-9`, where the row does not live. An id is
    // globally unique, so the workspace it was asked in was never information —
    // it was the key the query happened to be built on.
    mockRepo.findIdentityById.mockImplementation(async (workspaceId) =>
      workspaceId === "ws-2" ? identity({ workspaceId: "ws-2" }) : null
    );
    mockTenancy.resolveResource.mockResolvedValue(resolvedIn("ws-2"));
    await expect(
      resolveIdentityForLaunch(ctx({ workspaceId: "ws-9" }), "id-1")
    ).resolves.toMatchObject({ name: "Code Auditor" });
  });

  it("re-runs the MATRIX in the container the id named — resolving is not seeing", async () => {
    // 🔒 The resolver names only rows the caller could already list, but it
    // cannot know about a row that went `private` under them. A second fence,
    // in the tenancy the first one pointed at.
    mockRepo.findIdentityById.mockImplementation(async (workspaceId) =>
      workspaceId === "ws-2"
        ? identity({ workspaceId: "ws-2", visibility: "private", createdBy: OTHER })
        : null
    );
    mockTenancy.resolveResource.mockResolvedValue(resolvedIn("ws-2"));
    await expect(
      resolveIdentityForLaunch(ctx(), "id-1")
    ).rejects.toBeInstanceOf(AgentIdentityNotFoundError);
  });

  it("carries the caller's REAL ROLE into the container it resolved into", async () => {
    // ⚠ A guessed `null` role would make the same identity answer differently
    // on the id lane than on the `workspace=` lane — an admin's team-scoped row
    // would resolve in one and 404 in the other.
    mockRepo.findIdentityById.mockImplementation(async (workspaceId) =>
      workspaceId === "ws-2"
        ? identity({ workspaceId: "ws-2", visibility: "team", createdBy: OTHER })
        : null
    );
    mockTenancy.resolveResource.mockResolvedValue(
      resolvedIn("ws-2", { containerRole: "admin" })
    );
    await expect(
      resolveIdentityForLaunch(ctx({ userId: ADMIN, role: null }), "id-1")
    ).resolves.toMatchObject({ name: "Code Auditor" });
  });

  it("404s for an identity nothing of the caller's can name — the probe-proof arm", async () => {
    // 🔒 Somebody else's private identity, an id that never existed, and a
    // container outside this credential's LOCK are one answer, by construction:
    // the resolver returns null and the refusal carries nothing.
    mockRepo.findIdentityById.mockResolvedValue(null);
    mockTenancy.resolveResource.mockResolvedValue(null);
    const err = await resolveIdentityForLaunch(ctx(), "id-1").catch((e) => e);
    expect(err).toBeInstanceOf(AgentIdentityNotFoundError);
  });

  it("asks with the CALLER'S OWN CONTEXT, so the container LOCK reaches the fence", async () => {
    // 🔒 ⚠ The lock lives on `apiKeyWorkspaceId` and is applied inside
    // `shared/tenancy/resolve-resource.ts`; a read that handed it a bare
    // `{ userId }` would strip a workspace fence in one line and every
    // assertion in that module's suite would still pass.
    mockRepo.findIdentityById.mockResolvedValue(null);
    mockTenancy.resolveResource.mockResolvedValue(null);
    const locked = ctx({
      apiKeyWorkspaceId: "ws-1",
      credentialSubjectUserId: CREATOR,
    });
    await resolveIdentityForLaunch(locked, "id-1").catch(() => {});
    expect(mockTenancy.resolveResource).toHaveBeenCalledWith(
      locked,
      "agent_identity",
      "id-1"
    );
  });

  it("costs NOTHING on the hit path — an identity found where it was asked never resolves", async () => {
    mockRepo.findIdentityById.mockResolvedValue(identity());
    await resolveIdentityForLaunch(ctx(), "id-1");
    expect(mockTenancy.resolveResource).not.toHaveBeenCalled();
  });

  it("404s for a row that does not exist at all — the same error, deliberately", async () => {
    mockRepo.findIdentityById.mockResolvedValue(null);
    await expect(resolveIdentityForLaunch(ctx(), "id-1")).rejects.toBeInstanceOf(
      AgentIdentityNotFoundError
    );
  });
});

// ── T35 — THE DESKTOP'S 404 BODY ────────────────────────────────────────
//
// ⚠ ABSENT, NOT NULL, for the same reason the channels mapper's arm gives: the
// PRESENCE of a `details` key must not itself be a fact about a row the caller
// may not see. `HttpError.toResponseBody` omits `undefined` details.
describe("the 404 the desktop reads", () => {
  it("carries no details at all for an ordinary miss", () => {
    const http = mapAgentIdentityError(new AgentIdentityNotFoundError("id-1"));
    expect(http?.status).toBe(404);
    expect(http?.details).toBeUndefined();
  });
});
