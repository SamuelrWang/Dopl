/**
 * 🔒 **AN ID RESOLVES ITS OWN CONTAINER ON THE `dopl_kb` SURFACE TOO (F-470).**
 *
 * ⚠ **THE DEFECT THIS PINS.** `knowledge-shared.ts › resolveBase` matched a ref
 * against `listKbBases()`, which answers for the ONE container the connection is
 * bound to. So every op whose whole argument is an ID was container-keyed: a
 * base on the caller's own personal shelf — or in any other container they
 * belong to — answered `base_not_found` for an id the server's own id door
 * (`GET /api/knowledge/bases/<id>`) resolves. Reproduced in the 1.26.0 smoke on
 * a home channel's `container_session` credential.
 *
 * ⚠ **THIS SUITE ASSERTS THE ROUTING, NOT THE FENCE.** What a caller may name is
 * decided server-side (`shared/tenancy/resolve-resource.ts` and its suite); what
 * is asserted here is that the id lane is CONSULTED at all, that it is consulted
 * only for a UUID, and that a refusal still reads as `base_not_found`.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, KnowledgeBase, KnowledgeEntry } from "@dopl/client";
import { opReadFile, opGetTree } from "./knowledge-ops-read.js";

/** The base lives in the caller's PERSONAL container; the connection is bound
 *  to a home channel's container, so `list_bases` never names it. */
const ELSEWHERE: KnowledgeBase = {
  id: "a5b5a013-d2dc-4387-a41b-e08b47d68e79",
  workspaceId: "ws-personal",
  name: "Orchestration Guidelines",
  slug: "orchestration-guidelines",
  publicId: "pub-og",
  description: null,
  agentWriteEnabled: true,
  visibility: "private",
  createdBy: "u1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
};

const ENTRY: KnowledgeEntry = {
  id: "e1",
  workspaceId: "ws-personal",
  knowledgeBaseId: ELSEWHERE.id,
  folderId: null,
  title: "Desktop Orchestrator Protocol",
  excerpt: null,
  body: "the contract",
  entryType: "note",
  position: 0,
  createdBy: "u1",
  lastEditedBy: null,
  lastEditedSource: "user",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
};

function textOf(res: { content: Array<{ text: string }> }): string {
  return res.content.map((c) => c.text).join("\n");
}

/** An api error shaped the way `@dopl/client` throws one — duck-typed, exactly
 *  as `respond.ts › isApiError` reads it. */
function apiError(status: number, code: string) {
  return Object.assign(new Error(code), { status, code });
}

/** A connection bound to a container that holds NO bases the ref could match. */
function clientFor(over: Partial<DoplClient> = {}) {
  return {
    listKbBases: vi.fn(async () => []),
    getKbBase: vi.fn(async () => ELSEWHERE),
    readKbFileByPath: vi.fn(async () => ENTRY),
    getKbTree: vi.fn(async () => ({
      base: ELSEWHERE,
      folders: [],
      entries: [ENTRY],
    })),
    ...over,
  } as unknown as DoplClient;
}

describe("🔒 dopl_kb reaches a base by ID outside the bound container", () => {
  it("read_file falls through to the id door and returns the entry", async () => {
    // ⚠ MUTATION CHECK. Drop the fallback and this is `base_not_found` — the
    // exact symptom on prod, with the row perfectly readable by the same caller
    // through `GET /api/knowledge/bases/<id>`.
    const client = clientFor();
    const res = await opReadFile(client, ELSEWHERE.id, "protocol.md");
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toContain("Desktop Orchestrator Protocol");
    expect(client.getKbBase).toHaveBeenCalledWith(ELSEWHERE.id);
  });

  it("get_tree takes the same lane — one resolver, every op", async () => {
    const client = clientFor();
    const res = await opGetTree(client, ELSEWHERE.id);
    expect(res.isError).toBeFalsy();
    expect(client.getKbBase).toHaveBeenCalledWith(ELSEWHERE.id);
  });

  it("prefers the BOUND container's row when the ref matches there", async () => {
    // ⚠ No second round trip when the answer is already in hand: the id door is
    // a fallback, never the first question.
    const client = clientFor({ listKbBases: vi.fn(async () => [ELSEWHERE]) });
    await opReadFile(client, ELSEWHERE.id, "protocol.md");
    expect(client.getKbBase).not.toHaveBeenCalled();
  });

  it("🔒 does NOT ask the id door about a SLUG", async () => {
    // A slug is scoped to a container by definition, so asking the id door
    // about one would be asking a different question and answering it anyway.
    const client = clientFor();
    const res = await opReadFile(client, "orchestration-guidelines", "x.md");
    expect(res.isError).toBe(true);
    expect(client.getKbBase).not.toHaveBeenCalled();
  });

  it("🔒 reports a REFUSED id as base_not_found, adding no reach", async () => {
    const client = clientFor({
      getKbBase: vi.fn(async () => {
        throw apiError(404, "KNOWLEDGE_BASE_NOT_FOUND");
      }),
    });
    const res = await opReadFile(client, ELSEWHERE.id, "x.md");
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("base_not_found");
  });

  it("🔒 does NOT swallow a transport failure as `no such base`", async () => {
    // An outage reading as a deletion is how an agent concludes its operator's
    // notes are gone and writes them again somewhere else.
    const client = clientFor({
      getKbBase: vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    });
    await expect(opReadFile(client, ELSEWHERE.id, "x.md")).rejects.toThrow(
      "socket hang up"
    );
  });
});
