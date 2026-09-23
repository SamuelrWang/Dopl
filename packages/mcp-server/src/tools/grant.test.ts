/**
 * 🔒 **`dopl_kb(op="grant")` AND THE SCOPE/LEVEL PAIRING** — the op that
 * replaced `op="copy_base"` (slice B15, 2026-09-02, ruling B11).
 *
 * ⚠ **THE IDENTITY HALF LIVES IN `agent-fences.test.ts`**, beside that tool's
 * other fences, and the two are deliberately not one parameterised file: the
 * refusals they share come from `grant.ts`, and a shared driver would let a
 * regression in ONE registrar's wiring hide behind the other's.
 *
 * ⚠ **THE SERVER'S FENCE IS NOT PINNED HERE.** `PUT /api/resource-grants`
 * refuses a foreign resource and an unreachable scope with an identical 404
 * (`src/shared/grants/service.ts`); what these cases pin is the LOCAL half — the
 * refusals this tier can already prove without spending a round trip, and can
 * therefore explain, where the server's uniform answer deliberately cannot.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, KnowledgeBase, WorkspaceListItem } from "@dopl/client";
import { createWorkspaceDirectory } from "../workspace-directory";

import { opGrantBase } from "./knowledge-ops-grant";
import { channelScopeRefusal, levelForScope } from "./grant";
import { stub } from "./narration-fixtures";

const ME = "user-1";

const BASE: KnowledgeBase = {
  id: "kb-1",
  workspaceId: "ws-1",
  name: "Notes",
  slug: "notes",
  publicId: "pub-1",
  description: null,
  agentWriteEnabled: true,
  visibility: "private",
  accessMode: "workspace",
  createdBy: ME,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
};

const textOf = (res: { content: Array<{ text: string }> }) =>
  res.content.map((c) => c.text).join("\n");

const DIRECTORY = {
  // ⚠ `resolveContainerRef` since 2026-09-17 — the addressing contract, which
  // handles `home` and REFUSES an ambiguous slug instead of taking the head.
  resolveContainerRef: vi.fn(async (ref: string) =>
    ref === "container-1" ? { id: "container-1" } : null,
  ),
} as never;

function client(over: Record<string, unknown> = {}) {
  return stub({ listKbBases: vi.fn(async () => [BASE]), ...over }) as DoplClient;
}

describe("levelForScope — two vocabularies, one column", () => {
  it("defaults to the NARROWER word in each vocabulary", () => {
    // ⚠ An omitted argument must never be the widening one. `visible` names the
    // humans in the room and hands nobody a pen; `read` likewise.
    expect(levelForScope("channel", undefined)).toBe("visible");
    expect(levelForScope("container", undefined)).toBe("read");
  });

  it("accepts each scope's own words and refuses the other's", () => {
    expect(levelForScope("channel", "agent_only")).toBe("agent_only");
    expect(levelForScope("container", "edit")).toBe("edit");
    // ⚠ Refused HERE rather than by a `23514` with no field name.
    expect(levelForScope("channel", "read")).toHaveProperty("isError", true);
    expect(levelForScope("container", "visible")).toHaveProperty("isError", true);
  });
});

describe('dopl_kb op="grant"', () => {
  it("LENDS a base the caller created, and says the row did not move", async () => {
    const grant = vi.fn(async () => ({}));
    const res = await opGrantBase(
      client({ grantResource: grant }),
      DIRECTORY,
      ME,
      "notes",
      "container",
      "container-1",
      "edit",
    );
    expect(res.isError).toBeFalsy();
    expect(grant).toHaveBeenCalledWith({
      resourceType: "knowledge_base",
      resourceId: "kb-1",
      scopeType: "container",
      scopeId: "container-1",
      level: "edit",
    });
    expect(textOf(res)).toContain("It is ONE row");
    // 🔒 THE WHOLE DIFFERENCE FROM THE COPY, stated on the result rather than
    // left for the caller to discover when an edit fails to propagate.
    expect(textOf(res)).toContain("an edit reaches everyone it is lent to");
  });

  it("🔒 REFUSES a base the caller did not create, and writes nothing (R2)", async () => {
    const grant = vi.fn();
    const res = await opGrantBase(
      client({
        listKbBases: vi.fn(async () => [{ ...BASE, createdBy: "somebody-else" }]),
        grantResource: grant,
      }),
      DIRECTORY,
      ME,
      "notes",
      "channel",
      "ch-1",
      undefined,
    );
    expect(res.isError).toBe(true);
    expect(grant).not.toHaveBeenCalled();
    expect(textOf(res)).toContain("NOTHING was shared");
    expect(textOf(res)).toContain("Being able to read it is not the same");
  });

  it("🔒 FAILS CLOSED when ownership cannot be proved at all", async () => {
    // ⚠ BOTH halves are nullable — an unattributed row (an author who left,
    // `created_by` SET NULL) and an unresolved caller — and neither is evidence.
    const grant = vi.fn();
    for (const [createdBy, self] of [
      [null, ME],
      [ME, null],
    ] as const) {
      const res = await opGrantBase(
        client({
          listKbBases: vi.fn(async () => [{ ...BASE, createdBy }]),
          grantResource: grant,
        }),
        DIRECTORY,
        self,
        "notes",
        "channel",
        "ch-1",
        undefined,
      );
      expect(res.isError).toBe(true);
    }
    expect(grant).not.toHaveBeenCalled();
  });

  it("REFUSES an unresolvable container UNIFORMLY, with no fallback to the current workspace", async () => {
    // ⚠ "No such container" and "not one you can act in" stay ONE answer: a
    // sentence that distinguished them is an existence oracle over the
    // operator's other rooms, which is the whole point of B3's lock.
    const grant = vi.fn();
    const res = await opGrantBase(
      client({ grantResource: grant }),
      DIRECTORY,
      ME,
      "notes",
      "container",
      "nowhere",
      undefined,
    );
    expect(res.isError).toBe(true);
    expect(grant).not.toHaveBeenCalled();
    expect(textOf(res)).toContain("never falls back");
  });

  it("does NOT resolve a channel scope through the workspace directory", async () => {
    // ⚠ A channel id is a uuid and is fenced SERVER-SIDE against the caller's
    // own visible channels. Sending it through `resolveContainerRef` would
    // refuse every legitimate channel grant.
    const grant = vi.fn(async () => ({}));
    const resolve = vi.fn();
    await opGrantBase(
      client({ grantResource: grant }),
      { resolveContainerRef: resolve } as never,
      ME,
      "notes",
      "channel",
      "ch-1",
      undefined,
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(grant).toHaveBeenCalledWith(
      expect.objectContaining({ scopeType: "channel", scopeId: "ch-1" }),
    );
  });
});

// ── 🔒 The container-KIND refusal (Samuel's ruling 2026-09-17) ───────────

/**
 * ⚠ The server owns the fence. What is pinned here is that its refusal ARRIVES AS A
 * SENTENCE rather than a bare 400, and that no unrelated failure is relabelled as one.
 */
describe("🔒 channelScopeRefusal — the server's SCOPE_NOT_ALLOWED_IN_WORKSPACE", () => {
  const refused = { code: "SCOPE_NOT_ALLOWED_IN_WORKSPACE" };

  it("names the rule, the remedy and that nothing was written", () => {
    const res = channelScopeRefusal(refused);
    expect(res?.isError).toBe(true);
    expect(textOf(res!)).toContain("NOTHING was shared");
    expect(textOf(res!)).toMatch(/team/i);
    expect(textOf(res!)).toMatch(/HOME channel/);
  });

  it("🔒 passes EVERY other failure through — a catch-all would report an outage as a refusal", () => {
    expect(channelScopeRefusal({ code: "INTERNAL_ERROR" })).toBeNull();
    expect(channelScopeRefusal(new Error("connection reset"))).toBeNull();
    expect(channelScopeRefusal(null)).toBeNull();
    expect(channelScopeRefusal(undefined)).toBeNull();
  });

  it('dopl_kb op="grant" answers with it instead of throwing', async () => {
    const grant = vi.fn(async () => {
      throw Object.assign(new Error("400"), refused);
    });
    const res = await opGrantBase(
      client({ grantResource: grant }),
      DIRECTORY,
      ME,
      "notes",
      "channel",
      "ch-1",
      "visible",
    );
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("NOTHING was shared");
  });

  it("🔒 …and RETHROWS anything else from the same call", async () => {
    const grant = vi.fn(async () => {
      throw new Error("connection reset");
    });
    await expect(
      opGrantBase(
        client({ grantResource: grant }),
        DIRECTORY,
        ME,
        "notes",
        "channel",
        "ch-1",
        "visible",
      ),
    ).rejects.toThrow("connection reset");
  });
});

// ── 🔒 The ADDRESSING CONTRACT, not a second resolver (2026-09-17) ───────

/**
 * 🔒 **`to` RESOLVES THROUGH `resolveContainerRef`, LIKE EVERY OTHER CONTAINER
 * ADDRESS.** It went through `resolveWorkspaceRef` — `matchContainerRefs(ref)[0]`,
 * FIRST-WINS — until this date, which meant a slug naming two containers the
 * caller is in silently LENT INTO THE FIRST (F-719's case, and a grant is a
 * widen-the-audience write), and `to="home"` resolved to nothing at all though
 * R-32 made the personal shelf a first-class address.
 *
 * ⚠ A REAL directory, not a stub: what is pinned is that the grant reaches the
 * SAME resolver `container=` reaches, so a stub of its shape proves nothing.
 */
describe('🔒 op="grant" addresses a container the way every other call does', () => {
  const ws = (
    id: string,
    slug: string,
    kind: "standard" | "link" | "personal",
  ): WorkspaceListItem => ({
    id,
    ownerId: "owner",
    name: slug,
    slug,
    publicId: `pub-${id}`,
    description: null,
    kind,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    role: "owner",
  });

  // ⚠ ONE SLUG, TWO ROWS, NEITHER A MISTAKE: a home channel is named by the
  // peer who minted it, so a caller seeing two `ops` is the documented case.
  const MINE = ws("id-ws-ops", "ops", "standard");
  const THEIRS = ws("id-room-ops", "ops", "link");
  const HOME = ws("id-home", "sam", "personal");

  const directoryOf = (rows: WorkspaceListItem[]) =>
    createWorkspaceDirectory(
      { listWorkspaces: vi.fn(async () => ({ workspaces: rows })) } as unknown as DoplClient,
      { directory: rows },
    );

  const grantTo = async (rows: WorkspaceListItem[], to: string) => {
    const grant = vi.fn(async () => ({}));
    const res = await opGrantBase(
      client({ grantResource: grant }),
      directoryOf(rows),
      ME,
      "notes",
      "container",
      to,
      undefined,
    );
    return { res, grant };
  };

  it('to="home" resolves the caller\'s PERSONAL container (R-32)', async () => {
    const { res, grant } = await grantTo([MINE, HOME], "home");
    expect(res.isError).toBeFalsy();
    expect(grant).toHaveBeenCalledWith(
      expect.objectContaining({ scopeType: "container", scopeId: "id-home" }),
    );
  });

  it("an AMBIGUOUS slug refuses, names both ids, and shares NOTHING", async () => {
    const { res, grant } = await grantTo([MINE, THEIRS, HOME], "ops");
    expect(res.isError).toBe(true);
    expect(grant).not.toHaveBeenCalled();
    const text = textOf(res);
    // ⚠ The refusal re-issues with `to=<id>`, not `container=<id>`.
    expect(text).toContain("to=<id>");
    expect(text).toContain("id-ws-ops");
    expect(text).toContain("id-room-ops");
  });

  it("an ID never ties — it is the remedy the refusal hands back", async () => {
    const { res, grant } = await grantTo([MINE, THEIRS, HOME], "id-room-ops");
    expect(res.isError).toBeFalsy();
    expect(grant).toHaveBeenCalledWith(
      expect.objectContaining({ scopeId: "id-room-ops" }),
    );
  });

  it("an UNAMBIGUOUS slug still resolves, exactly as before", async () => {
    const { res, grant } = await grantTo([MINE, HOME], "ops");
    expect(res.isError).toBeFalsy();
    expect(grant).toHaveBeenCalledWith(
      expect.objectContaining({ scopeId: "id-ws-ops" }),
    );
  });
});
