/**
 * 🔒 **`readBaseById` — A KNOWLEDGE BASE FOLLOWS ITS OWN ID (B2).**
 *
 * ⚠ **THE FENCE ITSELF IS NOT RE-TESTED HERE.** Shared credentials, the `viewer`
 * floor, the container lock and the two-arm "rows you could already list for
 * yourself" `.or()` are asserted un-mocked in
 * `shared/tenancy/resolve-resource.test.ts`; the follow is asserted in
 * `shared/tenancy/read-resource.test.ts`. What this file owns is that THIS
 * feature's read door composes the answer and re-runs its OWN two gates on top
 * of it — the M-10 matrix and the agent audience ceiling.
 *
 * ⚠ The sibling of `agent-templates/server/service-resolve.test.ts`, and the
 * pair must move together: two read doors disagreeing about what an id may name
 * is the whole defect this slice removes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeBase, KnowledgeContext } from "../types";

vi.mock("./repository");
vi.mock("./service-audience", () => ({
  resolveAgentAudience: vi.fn(async () => ({ kind: "unrestricted" })),
  audienceAdmits: vi.fn(() => true),
}));
vi.mock("@/shared/tenancy/resolve-resource", () => ({
  resolveResource: vi.fn(async () => null),
}));

import * as repo from "./repository";
import * as audience from "./service-audience";
import * as tenancy from "@/shared/tenancy/resolve-resource";
import type { ResolvedResource } from "@/shared/tenancy/resolve-resource";
import { getBaseById, readBaseById } from "./service-bases";
import { KnowledgeBaseMismatchError, KnowledgeBaseNotFoundError } from "./errors";

const ME = "user-me";
const OTHER = "user-other";
const HERE = "ws-here";
const THERE = "ws-there";
const BASE = "base-1";

function ctx(over: Partial<KnowledgeContext> = {}): KnowledgeContext {
  return {
    workspaceId: HERE,
    userId: ME,
    source: "user",
    role: "member",
    apiKeyWorkspaceId: null,
    ...over,
  };
}

function base(over: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: BASE,
    workspaceId: THERE,
    name: "Runbooks",
    slug: "runbooks",
    publicId: "kb_runbooks",
    description: null,
    agentWriteEnabled: false,
    visibility: "private",
    accessMode: "workspace",
    createdBy: ME,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    ...over,
  };
}

function resolvedIn(containerId: string): ResolvedResource {
  return {
    type: "knowledge_base",
    id: BASE,
    name: "Runbooks",
    containerId,
    containerName: "Acme",
    containerKind: "standard",
    homeScoped: false,
    containerRole: "admin",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tenancy.resolveResource).mockResolvedValue(null);
  vi.mocked(audience.resolveAgentAudience).mockResolvedValue({
    kind: "unrestricted",
  } as never);
  vi.mocked(audience.audienceAdmits).mockReturnValue(true);
});

describe("🔒 the id names its own container", () => {
  it("reads the caller's own base out of ANOTHER container of theirs", async () => {
    // The row is in `THERE`; the caller was authorised in `HERE`. Before B2 this
    // was a `KnowledgeBaseMismatchError` about a perfectly good id.
    vi.mocked(repo.findBaseById).mockResolvedValue(base());
    vi.mocked(tenancy.resolveResource).mockResolvedValue(resolvedIn(THERE));
    await expect(readBaseById(ctx(), BASE)).resolves.toMatchObject({
      id: BASE,
      workspaceId: THERE,
    });
  });

  it("🔒 RESOLUTION IS NOT AUTHORISATION — the matrix still refuses", async () => {
    // Somebody else's PRIVATE base. The resolver could not have named it (its
    // `.or()` has no arm that matches), and even handed the address the
    // feature's own M-10 gate answers the same single 404.
    vi.mocked(repo.findBaseById).mockResolvedValue(
      base({ createdBy: OTHER })
    );
    vi.mocked(tenancy.resolveResource).mockResolvedValue(resolvedIn(THERE));
    await expect(readBaseById(ctx(), BASE)).rejects.toBeInstanceOf(
      KnowledgeBaseNotFoundError
    );
  });

  it("🔒 the AGENT AUDIENCE CEILING still applies in the container it named", async () => {
    // ⚠ MUTATION CHECK. The ceiling is `getBaseById`'s second gate and the one a
    // hand-written follow forgets: a granted-audience agent must not reach a
    // base it holds no channel grant on, in ANY container.
    vi.mocked(repo.findBaseById).mockResolvedValue(base());
    vi.mocked(tenancy.resolveResource).mockResolvedValue(resolvedIn(THERE));
    vi.mocked(audience.audienceAdmits).mockReturnValue(false);
    await expect(readBaseById(ctx(), BASE)).rejects.toBeInstanceOf(
      KnowledgeBaseNotFoundError
    );
  });

  it("404s an id that is nameable nowhere, exactly as a nonexistent one", async () => {
    vi.mocked(repo.findBaseById).mockResolvedValue(base());
    await expect(readBaseById(ctx(), BASE)).rejects.toBeInstanceOf(
      KnowledgeBaseNotFoundError
    );
    vi.mocked(repo.findBaseById).mockResolvedValue(null);
    await expect(readBaseById(ctx(), BASE)).rejects.toBeInstanceOf(
      KnowledgeBaseNotFoundError
    );
  });

  it("costs nothing when the base is where it was asked for", async () => {
    vi.mocked(repo.findBaseById).mockResolvedValue(base({ workspaceId: HERE }));
    await expect(readBaseById(ctx(), BASE)).resolves.toMatchObject({ id: BASE });
    expect(tenancy.resolveResource).not.toHaveBeenCalled();
  });
});

describe("🔒 the WRITE gate did not move", () => {
  it("getBaseById still refuses a base in another container", async () => {
    // ⚠ MUTATION CHECK, and it is the whole reason there are two functions:
    // every write in this feature funnels through `getBaseById`, so following an
    // id here would make `workspace=` ignorable on a PATCH — a ruling nobody has
    // made (INVARIANTS §T35).
    vi.mocked(repo.findBaseById).mockResolvedValue(base());
    vi.mocked(tenancy.resolveResource).mockResolvedValue(resolvedIn(THERE));
    await expect(getBaseById(ctx(), BASE)).rejects.toBeInstanceOf(
      KnowledgeBaseMismatchError
    );
    expect(tenancy.resolveResource).not.toHaveBeenCalled();
  });
});
