/**
 * 🔒 THE GUEST KNOWLEDGE LANE — THE ADVERSARIAL PIN, PART 2: THE ENTRY-ADDRESSED
 * PAIR (Home Knowledge Panels M2, plan §3.5 assertions ⑤–⑧; INVARIANTS §4A).
 *
 * `grant-lane.test.ts` is part 1 and carries the full contract, the mutation
 * table and the reasoning; read it first. This half is here because the two
 * together exceed the 500-line cap (§1), not because it is a separate claim.
 *
 * What is peculiar to these two `(route, method)` pairs, and why they need their
 * own file's worth of attack: THE ROUTE IS ADDRESSED BY ENTRY, AND AN ENTRY ID
 * SAYS NOTHING ABOUT A CHANNEL. Every other fence on the lane starts from a base
 * id the grant table can be asked about directly. Here the service must resolve
 * the entry, walk UP to its `knowledge_base_id`, and ask the grant question
 * there — and every way that walk can go wrong is a way to read somebody else's
 * knowledge base one uuid at a time.
 *
 * ⑤ `visible` + `guest_write:false` → GET 200, PUT 403
 * ⑥ `guest_write:true` → PUT 200, stamped to the guest
 * ⑦ an entry whose base is NOT granted → 404, wearing the ENTRY's code
 * ⑧ an entry in ANOTHER workspace → 404, before its base is ever read
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KnowledgeEntry } from "@/features/knowledge/types";

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth:
    (handler: (req: Request, ctx: Record<string, unknown>) => Promise<Response>) =>
    (req: Request, routeCtx: { params: Promise<Record<string, string>> }) =>
      routeCtx.params.then(async (params) => {
        // ⚠ DYNAMIC import — see part 1: `vi.mock` hoists above the imports.
        const { authState } = await import("./lane-harness");
        return handler(req, { ...authState.current, params });
      }),
}));

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({ __marker: "admin-client" }),
}));

vi.mock("@/features/channels/server/repository");
vi.mock("@/features/channels/server/repository-messages");
vi.mock("@/features/channels/server/repository-collab");
vi.mock("@/features/knowledge/server/repository");
vi.mock("@/features/knowledge/server/repository-channel-grants");
vi.mock("@/features/knowledge/server/embeddings", () => ({
  scheduleEntryEmbedding: vi.fn(),
}));

import * as kbRepo from "@/features/knowledge/server/repository";
import * as grantRepo from "@/features/knowledge/server/repository-channel-grants";

import { GET as TREE_GET } from "./bases/[baseId]/tree/route";
import { GET as ENTRY_GET, PUT as ENTRY_PUT } from "./entries/[entryId]/route";
import {
  authState,
  body,
  entryPutReq,
  entryReq,
  ENTRIES,
  E_FOREIGN,
  E_NONE,
  E_READ,
  E_WRITE,
  GUEST,
  KB_READ,
  makeAuth,
  treeReq,
  wireLaneMocks,
  withoutId,
  WS,
} from "./lane-harness";

beforeEach(() => {
  vi.clearAllMocks();
  wireLaneMocks();
});

// ════════════════════════════════════════════════════════════════════
// ⑤ visible + guest_write:false → read yes, write no
// ════════════════════════════════════════════════════════════════════
describe("5. `visible` with `guest_write:false` — GET 200, PUT 403", () => {
  it("GET 200: the grant admits a PRIVATE base owned by somebody else", async () => {
    // ⚠ The property that matters: `service-shared.ts › canSeeBase` would refuse
    // this base to this caller outright, and `assertBaseVisible` would refuse a
    // guest whatever the base's visibility. The 200 is the grant row, alone.
    const res = await ENTRY_GET(...entryReq(E_READ));
    expect(res.status).toBe(200);
    expect((await body<{ entry: KnowledgeEntry }>(res)).entry.id).toBe(E_READ);
  });

  it("PUT 403 — and it is the ONE refusal on this lane that is not a 404", async () => {
    // Nothing left to conceal: the caller was just shown the row by the same
    // grant. A 404 here would only mean "the thing in front of you is missing".
    const res = await ENTRY_PUT(...entryPutReq(E_READ, { body: "after" }));
    expect(res.status).toBe(403);
    expect((await body<{ error: { code: string } }>(res)).error.code).toBe(
      "CHANNEL_GRANT_READ_ONLY"
    );
    expect(kbRepo.updateEntryRow).not.toHaveBeenCalled();
  });

  it("the tree of that base is readable too", async () => {
    const res = await TREE_GET(...treeReq(KB_READ));
    expect(res.status).toBe(200);
    expect((await body<{ base: { id: string } }>(res)).base.id).toBe(KB_READ);
  });
});

// ════════════════════════════════════════════════════════════════════
// ⑥ guest_write:true → PUT 200, stamped to the guest
// ════════════════════════════════════════════════════════════════════
describe("6. `guest_write:true` — the guest may edit, and the edit says so", () => {
  it("200, and stamps `last_edited_by` = the guest with source `user`", async () => {
    const res = await ENTRY_PUT(...entryPutReq(E_WRITE, { body: "after" }));
    expect(res.status).toBe(200);
    expect(kbRepo.updateEntryRow).toHaveBeenCalledWith(
      E_WRITE,
      expect.objectContaining({
        body: "after",
        lastEditedBy: GUEST,
        // ⚠ The LITERAL `"user"`, not `ctx.source` — see the service.
        lastEditedSource: "user",
      }),
      undefined
    );
    expect((await body<{ entry: KnowledgeEntry }>(res)).entry.lastEditedBy).toBe(
      GUEST
    );
  });

  it("accepts title + body + expectedVersion and NOTHING else", async () => {
    // `.strict()`: `position` reorders somebody else's tree, `entryType`
    // reclassifies their document. A 400, not a silent drop.
    const res = await ENTRY_PUT(...entryPutReq(E_WRITE, { position: 3 }));
    expect(res.status).toBe(400);
    expect(kbRepo.updateEntryRow).not.toHaveBeenCalled();
  });

  it("a stale `expectedVersion` is a 412, not a clobber", async () => {
    const res = await ENTRY_PUT(
      ...entryPutReq(E_WRITE, {
        body: "after",
        expectedVersion: "2026-01-01T00:00:00Z",
      })
    );
    expect(res.status).toBe(412);
    expect(kbRepo.updateEntryRow).not.toHaveBeenCalled();
  });

  it("a MATCHING `expectedVersion` goes through and is passed to the CAS", async () => {
    const res = await ENTRY_PUT(
      ...entryPutReq(E_WRITE, {
        body: "after",
        expectedVersion: ENTRIES[E_WRITE]!.updatedAt,
      })
    );
    expect(res.status).toBe(200);
    // ⚠ The version is not merely compared in the service — it rides into the
    // UPDATE's own `.eq("updated_at", …)`, or a concurrent write between the two
    // is lost silently.
    expect(kbRepo.updateEntryRow).toHaveBeenCalledWith(
      E_WRITE,
      expect.anything(),
      ENTRIES[E_WRITE]!.updatedAt
    );
  });

  it("an AGENT token is refused even here — the lane is for people", async () => {
    // Otherwise this route is the one place `agent_write_enabled` (false on every
    // fixture base) can be walked around: a `full`-profile session has Bash and
    // the 90-day device token is on disk. F-10/F-10b through a new door.
    authState.current = { ...makeAuth("guest"), agentTokenId: "dopl_at_x" };
    const res = await ENTRY_PUT(...entryPutReq(E_WRITE, { body: "after" }));
    expect(res.status).toBe(403);
    expect((await body<{ error: { code: string } }>(res)).error.code).toBe(
      "AGENT_WRITE_DISABLED"
    );
    expect(kbRepo.updateEntryRow).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════
// ⑦ an entry of a base that is NOT granted
// ════════════════════════════════════════════════════════════════════
describe("7. an entry id is CHASED UP TO ITS BASE before the grant is asked", () => {
  it("an entry in an ungranted base is 404 on GET", async () => {
    // The entry EXISTS and is in this workspace. The only thing wrong with it is
    // its parent, which is the whole reason the chase has to happen.
    expect(ENTRIES[E_NONE]!.workspaceId).toBe(WS);
    expect((await ENTRY_GET(...entryReq(E_NONE))).status).toBe(404);
  });

  it("…and on PUT, before any write", async () => {
    const res = await ENTRY_PUT(...entryPutReq(E_NONE, { body: "after" }));
    expect(res.status).toBe(404);
    expect(kbRepo.updateEntryRow).not.toHaveBeenCalled();
  });

  it("the refusal wears the ENTRY's code, not the BASE's", async () => {
    // `KNOWLEDGE_BASE_NOT_FOUND` here would separate "no such entry" from "that
    // entry's base is not shared with you" — i.e. confirm the entry exists and
    // map the container one uuid at a time.
    const ABSENT = "bbbbbbbb-0000-4000-8000-0000000000ff";
    const hiddenBody = await withoutId(
      await ENTRY_GET(...entryReq(E_NONE)),
      E_NONE
    );
    expect((hiddenBody as { error: { code: string } }).error.code).toBe(
      "KNOWLEDGE_ENTRY_NOT_FOUND"
    );
    expect(hiddenBody).toEqual(
      await withoutId(await ENTRY_GET(...entryReq(ABSENT)), ABSENT)
    );
  });

  it("a MALFORMED entry id is that same 404, and reaches no query", async () => {
    const res = await ENTRY_GET(...entryReq("not-a-uuid"));
    expect(res.status).toBe(404);
    expect(kbRepo.findEntryById).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════
// ⑧ cross-workspace entry
// ════════════════════════════════════════════════════════════════════
describe("8. an entry in ANOTHER workspace is 404, and is refused before its base is read", () => {
  it("404", async () => {
    expect((await ENTRY_GET(...entryReq(E_FOREIGN))).status).toBe(404);
  });

  it("no base lookup happens for it at all", async () => {
    // `findEntryById` takes no workspace id, so the entry's OWN `workspace_id` is
    // the only thing standing between a foreign id and a chase into another
    // tenant's base.
    await ENTRY_GET(...entryReq(E_FOREIGN));
    expect(grantRepo.findChannelKnowledgeGrant).not.toHaveBeenCalled();
    expect(kbRepo.findBaseById).not.toHaveBeenCalled();
  });
});
