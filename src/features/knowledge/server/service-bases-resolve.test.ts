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

// ⚠ **THE GRANT ARM IS A DB READ, SO IT IS DECLARED HERE** (F-604, 2026-09-02).
// `canSeeBase` / `canSeeTemplate` gained an arm over `resource_grants`, and its
// batch precompute is the one part of this seam that talks to Postgres. Every
// case in this file is about the OTHER arms, so the grant set is empty — which
// is also the pre-2026-09-02 behaviour, and therefore the right default for a
// suite that predates the arm. The cases that exercise a GRANT live in
// `service-shared-grant-arm.test.ts` and the redteam suites.
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
// ⚠ THE WRITE CASES BELOW REACH TWO SEAMS THE READ CASES NEVER DID. The storage
// gate reads a billing row and the embedding scheduler talks to an API; both are
// out of scope here (this file is about WHICH CONTAINER a call lands in) and an
// unmocked either hangs the suite. Headroom always passes, so a refusal in these
// cases can only ever be a tenancy refusal.
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
import { listDirByPath, readFileByPath, writeFileByPath } from "./service-paths";
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

/**
 * 🔒 **THE SECONDARY READ DOORS FOLLOW THE ID TOO (F-470).**
 *
 * ⚠ **THE CLAIM WAS TRUE FOR ONE DOOR AND FALSE FOR THE REST, WHICH IS WORSE
 * THAN FALSE FOR ALL OF THEM.** `GET /api/knowledge/bases/<id>` resolved an id
 * to its own container from A12/B2 onward; `.../tree`, `.../files?path=` and
 * `.../folders` composed the WORKSPACE-KEYED `getBaseById` instead, so the same
 * id that opened a base answered `KNOWLEDGE_BASE_MISMATCH` for its contents —
 * F-604's shape ("a base you could open and could not read") one layer up, and
 * the reason `dopl_kb read_file` failed on a personal-shelf base in the 1.26.0
 * smoke.
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
    // ⚠ MUTATION CHECK. Put `getBaseById` back and this is a
    // `KnowledgeBaseMismatchError` — and if only the BASE lookup follows while
    // `resolvePath` keeps the original context, it is one anyway, from the
    // entry's own `assertSameWorkspace`.
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
    // ⚠ MUTATION CHECK. The follow re-runs `getBaseById` in the container the id
    // named, so somebody else's private row is the same single 404 on every door
    // — the address is not the authorisation.
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
 * 🔓 **THE WRITE DOORS FOLLOW THE ID TOO — SAMUEL'S RULING, 2026-09-06**
 * (INVARIANTS §T35, rewritten; `shared/tenancy/read-resource.ts` carries the
 * argument).
 *
 * ⚠ **THIS BLOCK USED TO ASSERT THE OPPOSITE** ("the by-id WRITE doors stay
 * workspace-keyed"), and the behaviour it pinned is the defect that was
 * reported: a base you could OPEN from a channel and could not EDIT from the
 * same session, one call apart, because the read door followed the id and the
 * write door did not.
 *
 * ⚠ **THE SECOND ASSERTION IN EACH CASE IS THE LOAD-BEARING ONE.** Following the
 * id is only half a write — the entry insert, the path walk and the delete are
 * all workspace-keyed, so what matters is that they land in `THERE` (the base's
 * container) and not in `HERE` (the room the call came from). A write gated on
 * the followed base and executed against the calling context would be worse than
 * the refusal it replaces, and that is what these pin.
 */
describe("🔓 the by-id WRITE doors name the id's own container", () => {
  beforeEach(() => {
    vi.mocked(repo.findBaseById).mockResolvedValue(
      base({ agentWriteEnabled: true })
    );
    vi.mocked(tenancy.resolveResource).mockResolvedValue(resolvedIn(THERE));
    vi.mocked(repo.findActiveFolderByName).mockResolvedValue(null);
    vi.mocked(repo.findActiveEntryByTitle).mockResolvedValue(null);
    // The slug fallback inside `resolvePath` — empty, so the path is a clean miss
    // and `write_file` takes its CREATE arm.
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
    // ⚠ MUTATION CHECK. Compose the insert against the ORIGINAL ctx and this
    // reads `HERE`: gated on the base's container, written into the caller's.
    expect(repo.insertEntry).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: THERE, knowledgeBaseId: BASE })
    );
  });

  it("🔒 and it still refuses what the matrix refuses", async () => {
    // ⚠ Following an id authorises nothing: the gate re-runs in the container
    // the id named, so somebody else's private base is the same single 404.
    vi.mocked(repo.findBaseById).mockResolvedValue(base({ createdBy: OTHER }));
    await expect(
      writeFileByPath(ctx(), BASE, "x.md", { body: "hi" })
    ).rejects.toBeInstanceOf(KnowledgeBaseNotFoundError);
    expect(repo.insertEntry).not.toHaveBeenCalled();
  });

  it("🔒 an id that resolves NOWHERE is still the mismatch refusal", async () => {
    // The resolver is the first fence and it answers `null` for a row the caller
    // could not have listed for themselves — no follow, no write.
    vi.mocked(tenancy.resolveResource).mockResolvedValue(null);
    await expect(
      writeFileByPath(ctx(), BASE, "x.md", { body: "hi" })
    ).rejects.toBeInstanceOf(KnowledgeBaseNotFoundError);
    expect(repo.insertEntry).not.toHaveBeenCalled();
  });
});
