/**
 * 🔒 **`dopl_kb(op="grant")` AND THE SCOPE/LEVEL PAIRING** — the op that
 * replaced `op="copy_base"` (slice B15, 2026-09-02, ruling B11).
 *
 * ⚠ **THE TEMPLATE HALF LIVES IN `agent-fences.test.ts`**, beside that tool's
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
import type { DoplClient, KnowledgeBase } from "@dopl/client";

import { opGrantBase } from "./knowledge-ops-write";
import { levelForScope } from "./grant";
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
  resolveWorkspaceRef: vi.fn(async (ref: string) =>
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
    // own visible channels. Sending it through `resolveWorkspaceRef` would
    // refuse every legitimate channel grant.
    const grant = vi.fn(async () => ({}));
    const resolve = vi.fn();
    await opGrantBase(
      client({ grantResource: grant }),
      { resolveWorkspaceRef: resolve } as never,
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
