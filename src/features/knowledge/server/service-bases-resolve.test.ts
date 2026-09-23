/**
 * `readBaseById` — a knowledge base follows its own id (B2).
 *
 * The fence itself is asserted un-mocked in
 * `shared/tenancy/resolve-resource.test.ts` and the follow in
 * `shared/tenancy/read-resource.test.ts`. This file owns only that the feature's
 * read door re-runs its own two gates on top — the M-10 matrix and the agent
 * audience ceiling. Sibling of
 * `agent-identities/server/service-resolve.test.ts`; the pair must move together.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeBase, KnowledgeContext } from "../types";

// The grant arm is a DB read, so it is declared here (F-604, 2026-09-02). Every
// case in this file is about the other arms, so the grant set is empty; grant
// cases live in `service-shared-grant-arm.test.ts` and the redteam suites.
// The changelog capture is a real awaited write (`./service-revisions.ts`), so
// an unstubbed service test reaches `supabaseAdmin()` and fails on a missing
// service-role key. That the row is recorded is `service-revisions.test.ts`'s
// subject.
vi.mock("@/features/revisions/server/repository", () => ({
  appendRevision: vi.fn(async () => ({ id: "rev-1" })),
  replaceRevisionSnapshot: vi.fn(async () => ({ id: "rev-1" })),
  findLatestRevision: vi.fn(async () => null),
  findRevisionById: vi.fn(async () => null),
  listRevisionsForResource: vi.fn(async () => []),
  listRevisionsForResources: vi.fn(async () => []),
}));

vi.mock("@/shared/tenancy/resource-grant-reach", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/shared/tenancy/resource-grant-reach")
  >()),
  grantedResourceIds: vi.fn(async () => new Set<string>()),
}));

vi.mock("./repository");
vi.mock("./service-audience", () => ({
  resolveAgentAudience: vi.fn(async () => ({ kind: "unrestricted" })),
  audienceAdmits: vi.fn(() => true),
}));
vi.mock("@/shared/tenancy/resolve-resource", () => ({
  resolveResource: vi.fn(async () => null),
}));
// The write cases reach two more seams: the storage gate reads a billing row
// and the embedding scheduler talks to an API. Unmocked, either hangs the suite.
// Headroom always passes, so a refusal here can only be a tenancy refusal.
vi.mock("./service-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./service-storage")>()),
  assertStorageHeadroom: vi.fn(async () => {}),
}));
vi.mock("./embeddings", () => ({ scheduleEntryEmbedding: vi.fn() }));

import * as repo from "./repository";
import * as audience from "./service-audience";
import * as tenancy from "@/shared/tenancy/resolve-resource";
import type { ResolvedResource } from "@/shared/tenancy/resolve-resource";
import { getBaseById, readBaseById } from "./service-bases";
import { readFileByPath, writeFileByPath } from "./service-paths";
import { listDirByPath } from "./service-paths-tree";
import { getBaseTree, listFolders } from "./service-folders";
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
    credentialSubjectUserId: ME,
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
    ownedByCaller: true,
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
    // The row is in `THERE`; the caller was authorised in `HERE`.
    vi.mocked(repo.findBaseById).mockResolvedValue(base());
    vi.mocked(tenancy.resolveResource).mockResolvedValue(resolvedIn(THERE));
    await expect(readBaseById(ctx(), BASE)).resolves.toMatchObject({
      id: BASE,
      workspaceId: THERE,
    });
  });

  it("🔒 RESOLUTION IS NOT AUTHORISATION — the matrix still refuses", async () => {
    // Somebody else's private base: the resolver could not have named it, and
    // even handed the address the M-10 gate answers the same single 404.
    vi.mocked(repo.findBaseById).mockResolvedValue(
      base({ createdBy: OTHER })
    );
    vi.mocked(tenancy.resolveResource).mockResolvedValue(resolvedIn(THERE));
    await expect(readBaseById(ctx(), BASE)).rejects.toBeInstanceOf(
      KnowledgeBaseNotFoundError
    );
  });

  it("🔒 the AGENT AUDIENCE CEILING still applies in the container it named", async () => {
    // The ceiling is `getBaseById`'s second gate: a granted-audience agent must
    // not reach a base it holds no channel grant on, in any container.
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
    // The reason there are two functions: every write funnels through
    // `getBaseById`, so following an id here would make `workspace=` ignorable
    // on a PATCH (INVARIANTS §T35).
    vi.mocked(repo.findBaseById).mockResolvedValue(base());
    vi.mocked(tenancy.resolveResource).mockResolvedValue(resolvedIn(THERE));
    await expect(getBaseById(ctx(), BASE)).rejects.toBeInstanceOf(
      KnowledgeBaseMismatchError
    );
    expect(tenancy.resolveResource).not.toHaveBeenCalled();
  });
});

/**
 * The secondary read doors follow the id too (F-470). `.../tree`,
 * `.../files?path=` and `.../folders` used the workspace-keyed `getBaseById`,
 * so the same id that opened a base answered `KNOWLEDGE_BASE_MISMATCH` for its
 * contents.
 */
describe("🔒 every by-id READ door names the id's own container", () => {
  beforeEach(() => {
    vi.mocked(repo.findBaseById).mockResolvedValue(base());
    vi.mocked(tenancy.resolveResource).mockResolvedValue(resolvedIn(THERE));
    vi.mocked(repo.listFoldersForBase).mockResolvedValue([]);
    vi.mocked(repo.listEntriesForBase).mockResolvedValue([]);
    vi.mocked(repo.findActiveFolderByName).mockResolvedValue(null);
  });

  it("read_file resolves the path in the container the base lives in", async () => {
    // If only the base lookup follows while `resolvePath` keeps the original
    // context, the entry's own `assertSameWorkspace` still mismatches.
    vi.mocked(repo.findActiveEntryByTitle).mockResolvedValue({
      id: "e1",
      workspaceId: THERE,
      knowledgeBaseId: BASE,
      title: "protocol.md",
    } as never);
    await expect(
      readFileByPath(ctx(), BASE, "protocol.md")
    ).resolves.toMatchObject({ id: "e1" });
  });

  it("get_tree reads the snapshot of a base in another container", async () => {
    await expect(getBaseTree(ctx(), BASE)).resolves.toMatchObject({
      base: { id: BASE, workspaceId: THERE },
    });
  });

  it("list_dir lists the root of a base in another container", async () => {
    await expect(listDirByPath(ctx(), BASE, "")).resolves.toMatchObject({
      folder: null,
    });
  });

  it("list_folders takes the same lane", async () => {
    await expect(listFolders(ctx(), BASE)).resolves.toEqual([]);
  });

  it("🔒 and every one of them still refuses what the matrix refuses", async () => {
    // The follow re-runs `getBaseById` in the container the id named, so
    // somebody else's private row is the same single 404 on every door.
    vi.mocked(repo.findBaseById).mockResolvedValue(base({ createdBy: OTHER }));
    await expect(readFileByPath(ctx(), BASE, "x.md")).rejects.toBeInstanceOf(
      KnowledgeBaseNotFoundError
    );
    await expect(getBaseTree(ctx(), BASE)).rejects.toBeInstanceOf(
      KnowledgeBaseNotFoundError
    );
    await expect(listDirByPath(ctx(), BASE, "")).rejects.toBeInstanceOf(
      KnowledgeBaseNotFoundError
    );
  });
});

/**
 * The write doors follow the id too (ruling 2026-09-06, INVARIANTS §T35).
 *
 * The second assertion in each case is the load-bearing one: the entry insert,
 * the path walk and the delete are all workspace-keyed, so they must land in
 * `THERE` (the base's container), not `HERE` (the room the call came from). A
 * write gated on the followed base but executed against the calling context
 * would be worse than the refusal it replaces.
 */
describe("🔓 the by-id WRITE doors name the id's own container", () => {
  beforeEach(() => {
    vi.mocked(repo.findBaseById).mockResolvedValue(
      base({ agentWriteEnabled: true })
    );
    vi.mocked(tenancy.resolveResource).mockResolvedValue(resolvedIn(THERE));
    vi.mocked(repo.findActiveFolderByName).mockResolvedValue(null);
    vi.mocked(repo.findActiveEntryByTitle).mockResolvedValue(null);
    // Slug fallback inside `resolvePath` — empty, so the path is a clean miss
    // and `write_file` takes its create arm.
    vi.mocked(repo.listActiveEntryTitlesIn).mockResolvedValue([]);
    vi.mocked(repo.insertEntry).mockResolvedValue({
      id: "e-new",
      workspaceId: THERE,
    } as never);
  });

  it("write_file edits a base in another container, and inserts THERE", async () => {
    await expect(
      writeFileByPath(ctx(), BASE, "x.md", { body: "hi" })
    ).resolves.toMatchObject({ entry: { id: "e-new" } });
    // Composing the insert against the original ctx reads `HERE`: gated on the
    // base's container, written into the caller's.
    expect(repo.insertEntry).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: THERE, knowledgeBaseId: BASE })
    );
  });

  it("🔒 and it still refuses what the matrix refuses", async () => {
    // Following an id authorises nothing: the gate re-runs in the container the
    // id named, so somebody else's private base is the same single 404.
    vi.mocked(repo.findBaseById).mockResolvedValue(base({ createdBy: OTHER }));
    await expect(
      writeFileByPath(ctx(), BASE, "x.md", { body: "hi" })
    ).rejects.toBeInstanceOf(KnowledgeBaseNotFoundError);
    expect(repo.insertEntry).not.toHaveBeenCalled();
  });

  it("🔒 an id that resolves NOWHERE is still the mismatch refusal", async () => {
    // The resolver answers `null` for a row the caller could not have listed for
    // themselves — no follow, no write.
    vi.mocked(tenancy.resolveResource).mockResolvedValue(null);
    await expect(
      writeFileByPath(ctx(), BASE, "x.md", { body: "hi" })
    ).rejects.toBeInstanceOf(KnowledgeBaseNotFoundError);
    expect(repo.insertEntry).not.toHaveBeenCalled();
  });
});
