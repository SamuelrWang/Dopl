/**
 * `dopl_kb(op="move_folder" | "move_file")` — ONE mover, two nouns.
 *
 * ⚠ **THESE OPS HAD NO COVERAGE AT ALL** until `opMoveFolder` and `opMoveFile`
 * were collapsed into {@link opMove} (2026-09-17): two functions differing only
 * in a noun, and nothing asserted either sentence. What is pinned here is the
 * half the collapse could have got wrong — that the KIND the caller named is
 * what the refusal is measured against, and that each noun reaches its own
 * result line.
 *
 * ⚠ Also the shared catch (`writeOr`): the read-only-to-agents 403 arrives as
 * the server's own sentence, and everything else RETHROWS — a catch that
 * swallowed an outage would report it as a refusal.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, KnowledgeBase } from "@dopl/client";

import { opMove } from "./knowledge-ops-write";
import { registerKnowledgeTools } from "./knowledge";
import { UNKNOWN_CALLER } from "./identity";
import type { ToolResponse } from "./respond";
import type { WorkspaceDirectory } from "../workspace-directory";
import { stub } from "./narration-fixtures";

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
  createdBy: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
};

const textOf = (res: { content: Array<{ text: string }> }) =>
  res.content.map((c) => c.text).join("\n");

const client = (move: unknown) =>
  stub({
    listKbBases: vi.fn(async () => [BASE]),
    moveKbByPath: move,
  }) as DoplClient;

const moved = (kind: "folder" | "entry") =>
  vi.fn(async () => ({ kind, id: "x-1" }));

describe("opMove — the kind the caller named is the kind it checks", () => {
  it('kind="folder" moves a folder and says "Folder moved"', async () => {
    const move = moved("folder");
    const res = await opMove(client(move), "notes", "a/b", "c/b", "folder");
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toBe("Folder moved: `a/b` → `c/b`.");
    expect(move).toHaveBeenCalledWith("kb-1", "a/b", "c/b");
  });

  it('kind="entry" moves an entry and says "Entry moved"', async () => {
    const res = await opMove(client(moved("entry")), "notes", "a/n.md", "c/n.md", "entry");
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toBe("Entry moved: `a/n.md` → `c/n.md`.");
  });

  it("REFUSES when the path resolved to the other kind — both directions", async () => {
    const asFolder = await opMove(client(moved("folder")), "notes", "a/b", "c", "entry");
    expect(asFolder.isError).toBe(true);
    expect(textOf(asFolder)).toBe("Path `a/b` resolved to a folder, not an entry.");

    const asEntry = await opMove(client(moved("entry")), "notes", "a/b", "c", "folder");
    expect(asEntry.isError).toBe(true);
    expect(textOf(asEntry)).toBe("Path `a/b` resolved to a entry, not a folder.");
  });
});

describe("opMove — the shared catch", () => {
  const apiError = (status: number, code: string, apiMessage?: string) =>
    Object.assign(new Error(code), { status, code, apiMessage });

  it("a read-only-to-agents base answers with the server's sentence", async () => {
    const move = vi.fn(async () => {
      throw apiError(403, "AGENT_WRITE_DISABLED", "This base is read-only to agents.");
    });
    const res = await opMove(client(move), "notes", "a/b", "c/b", "folder");
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("read-only to agents");
  });

  it("🔒 anything else RETHROWS — an outage is not a refusal", async () => {
    const move = vi.fn(async () => {
      throw new Error("connection reset");
    });
    await expect(
      opMove(client(move), "notes", "a/b", "c/b", "folder"),
    ).rejects.toThrow("connection reset");
  });
});

// ── The two call sites, through the REAL registrar ──────────────────────

/**
 * ⚠ **THE KIND IS NOW AN ARGUMENT, so the registrar arms are where it can be
 * swapped silently** — `move_folder` passing `"entry"` would refuse every
 * legitimate folder move and no unit test of {@link opMove} would notice.
 */
describe("the registrar hands each op its own kind", () => {
  const doplKb = (move: unknown) => {
    const handlers = new Map<string, unknown>();
    const directory = {
      getWorkspaceList: async () => [],
      resolveWorkspaceRef: async () => null,
      noWorkspaceError: async () => ({ content: [], isError: true }),
      resolveContainerRef: async () => null,
      homeContainer: async () => null,
      containerKindIndex: async () => new Map(),
      lockedWorkspaceId: () => null,
    } as unknown as WorkspaceDirectory;
    registerKnowledgeTools(
      (name, _d, _s, handler) => handlers.set(name, handler),
      client(move),
      UNKNOWN_CALLER,
      directory,
    );
    return handlers.get("dopl_kb") as (
      a: Record<string, unknown>,
    ) => Promise<ToolResponse>;
  };

  it('op="move_folder" checks for a FOLDER', async () => {
    const kb = doplKb(moved("folder"));
    const res = await kb({ op: "move_folder", base: "notes", from_path: "a", to_path: "b" });
    expect(textOf(res)).toContain("Folder moved");
  });

  it('op="move_file" checks for an ENTRY', async () => {
    const kb = doplKb(moved("entry"));
    const res = await kb({ op: "move_file", base: "notes", from_path: "a", to_path: "b" });
    expect(textOf(res)).toContain("Entry moved");
  });
});
