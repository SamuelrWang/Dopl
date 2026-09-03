/**
 * 🔒 **`readEntry` — AN ENTRY FOLLOWS ITS BASE'S ID (B2).**
 *
 * ⚠ **AN ENTRY IS NOT A ROW IN THE RESOLVER REGISTRY, AND THAT IS THE CLAIM
 * THIS FILE PINS.** `knowledge_entries` has no `visibility` column: its base is
 * both its address and its fence, so clause 4 of
 * `shared/tenancy/resolve-resource.ts` would have no arm to apply and a registry
 * row would be a second, weaker door onto the same content. The follow goes
 * through `service-bases.ts › readBaseById` instead — which means the base's
 * matrix AND its agent audience ceiling come along for free, and that is exactly
 * what a hand-rolled entry resolver would have lost.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeBase, KnowledgeContext, KnowledgeEntry } from "../types";

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
import { getEntry, readEntry } from "./service-entries";
import { EntryNotFoundError, KnowledgeBaseMismatchError } from "./errors";

const ME = "user-me";
const OTHER = "user-other";
const HERE = "ws-here";
const THERE = "ws-there";
const BASE = "base-1";
const ENTRY = "entry-1";

function ctx(): KnowledgeContext {
  return {
    workspaceId: HERE,
    userId: ME,
    source: "user",
    role: "member",
    apiKeyWorkspaceId: null,
    credentialSubjectUserId: ME,
  };
}

function entry(over: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: ENTRY,
    workspaceId: THERE,
    knowledgeBaseId: BASE,
    folderId: null,
    title: "Runbook",
    entryType: "note",
    excerpt: null,
    body: "",
    position: 0,
    createdBy: ME,
    lastEditedBy: null,
    lastEditedSource: "user",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    ...over,
  } as KnowledgeEntry;
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
  vi.mocked(tenancy.resolveResource).mockResolvedValue(resolvedIn(THERE));
  vi.mocked(audience.resolveAgentAudience).mockResolvedValue({
    kind: "unrestricted",
  } as never);
  vi.mocked(audience.audienceAdmits).mockReturnValue(true);
  vi.mocked(repo.findEntryById).mockResolvedValue(entry());
  vi.mocked(repo.findBaseById).mockResolvedValue(base());
});

describe("🔒 the entry follows its base", () => {
  it("reads an entry whose base lives in another container of the caller's", async () => {
    await expect(readEntry(ctx(), ENTRY)).resolves.toMatchObject({ id: ENTRY });
  });

  it("🔒 the base's MATRIX still refuses — the entry is not a way around it", async () => {
    vi.mocked(repo.findBaseById).mockResolvedValue(base({ createdBy: OTHER }));
    await expect(readEntry(ctx(), ENTRY)).rejects.toBeInstanceOf(
      EntryNotFoundError
    );
  });

  it("🔒 the base's AUDIENCE CEILING still applies, in the container it named", async () => {
    // 🔒 MUTATION CHECK, and the reason the follow goes through `readBaseById`
    // rather than a registry row of its own: entry ids are cheap (ontology
    // attributes ship raw arrays), and a hand-rolled entry resolver would have
    // dropped this gate exactly as `getEntry` did before 2026-08-26.
    vi.mocked(audience.audienceAdmits).mockReturnValue(false);
    await expect(readEntry(ctx(), ENTRY)).rejects.toBeInstanceOf(
      EntryNotFoundError
    );
  });

  it("🔒 refuses an entry whose own workspace disagrees with its base's", async () => {
    // ⚠ MUTATION CHECK. The two columns are denormalized halves of one fact; a
    // row where they disagree is broken, not wider, and reads as the same 404.
    vi.mocked(repo.findEntryById).mockResolvedValue(
      entry({ workspaceId: "ws-third" })
    );
    await expect(readEntry(ctx(), ENTRY)).rejects.toBeInstanceOf(
      EntryNotFoundError
    );
  });

  it("404s an entry that does not exist", async () => {
    vi.mocked(repo.findEntryById).mockResolvedValue(null);
    await expect(readEntry(ctx(), ENTRY)).rejects.toBeInstanceOf(
      EntryNotFoundError
    );
  });
});

describe("🔒 the WRITE gate did not move", () => {
  it("getEntry still refuses an entry outside this container", async () => {
    // ⚠ MUTATION CHECK: `updateEntry`, `moveEntry`, `deleteEntry` and the pin
    // service all funnel through it (INVARIANTS §T35).
    await expect(getEntry(ctx(), ENTRY)).rejects.toBeInstanceOf(
      KnowledgeBaseMismatchError
    );
    expect(tenancy.resolveResource).not.toHaveBeenCalled();
  });
});
