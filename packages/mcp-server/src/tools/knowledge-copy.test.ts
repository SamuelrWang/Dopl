/**
 * `dopl_kb(op="copy_base")` — THE TWO-LEG COPY, driven through the REAL
 * registrar.
 *
 * ⚠ THE TOOL IS DRIVEN, NOT THE OP FUNCTION — the routing and the arg names are
 * half of what this ticket ships, and a suite calling `opCopyBase` directly
 * would stay green through a mis-wired `case`.
 *
 * ⚠ THE LOAD-BEARING ASSERTIONS ARE THREE, and each is a different failure:
 *   1. WHICH TENANCY each call ran in, read off `workspaceContext.getStore()`
 *      inside the mocked client — the fence the whole design rests on;
 *   2. the CAP refuses BEFORE the first write, so an oversized base leaves
 *      nothing behind;
 *   3. a failure AFTER the base lands reports PARTIAL — a suite that only
 *      asserted `isError` would pass over a result narrating a clean success;
 *   4. 🔒 R2 (2026-09-02): the source must be one the CALLER CREATED, and the
 *      refusal costs no tree read at all.
 */

import { describe, expect, it, vi } from "vitest";
import { workspaceContext } from "@dopl/client";
import type {
  DoplClient,
  KnowledgeBase,
  KnowledgeBaseCreateInput,
  KnowledgeEntry,
  KnowledgeFolder,
  WorkspaceListItem,
} from "@dopl/client";
import {
  createWorkspaceDirectory,
  type WorkspaceDirectory,
} from "../workspace-directory.js";
import { registerKnowledgeTools } from "./knowledge.js";
import { UNKNOWN_CALLER, type CallerIdentity } from "./identity.js";
import { MAX_COPY_ENTRIES } from "./knowledge-ops-copy.js";
import type { RegisterTool, ToolResponse } from "./respond.js";

/** The fixtures' `createdBy`. 🔒 R2: a copy is of a base the caller CREATED. */
const OWNER = "user-1";
const OWNER_CALLER: CallerIdentity = { ...UNKNOWN_CALLER, userId: OWNER };

const SOURCE_WS = "ws-source";
const TARGET_WS = "ws-target";

function wsItem(
  id: string,
  slug: string,
  kind: "standard" | "link" = "standard",
): WorkspaceListItem {
  return {
    id,
    ownerId: "owner",
    name: `${slug} room`,
    slug,
    publicId: `pub-${id}`,
    description: null,
    kind,
    memberCount: 2,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    role: "member",
  };
}

const SOURCE = wsItem(SOURCE_WS, "source");
const TARGET = wsItem(TARGET_WS, "target");
const CONTAINER = wsItem("ws-container", "container-c", "link");

const STAMPS = {
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
};

function base(over: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: "base-src",
    workspaceId: SOURCE_WS,
    name: "Handbook",
    slug: "handbook",
    publicId: "pub-handbook",
    description: "How we work",
    agentWriteEnabled: true,
    visibility: "public",
    accessMode: "workspace",
    createdBy: "user-1",
    ...STAMPS,
    ...over,
  };
}

function folder(id: string, name: string, parentId: string | null): KnowledgeFolder {
  return {
    id,
    workspaceId: SOURCE_WS,
    knowledgeBaseId: "base-src",
    parentId,
    name,
    description: `${name} summary`,
    position: 0,
    createdBy: "user-1",
    ...STAMPS,
  };
}

function entry(id: string, title: string, folderId: string | null): KnowledgeEntry {
  return {
    id,
    workspaceId: SOURCE_WS,
    knowledgeBaseId: "base-src",
    folderId,
    title,
    excerpt: `${title} excerpt`,
    // ⚠ EMPTY, exactly as `get_tree` ships it — the body is a second read, and
    // a fixture that pre-filled it would hide a copy that never fetched one.
    body: "",
    entryType: "note",
    position: 0,
    createdBy: "user-1",
    lastEditedBy: null,
    lastEditedSource: "web",
    ...STAMPS,
  };
}

/** A two-level tree: `deep/` under `projects/`, one entry at each level. */
const FOLDERS = [
  folder("f-deep", "deep", "f-proj"),
  folder("f-proj", "projects", null),
];
const ENTRIES = [entry("e-root", "Readme", null), entry("e-deep", "Notes", "f-deep")];

interface Trace {
  calls: Array<{ method: string; workspace: string | undefined; arg?: string }>;
  created: KnowledgeBaseCreateInput[];
}

interface ClientOpts {
  entries?: KnowledgeEntry[];
  entryTotal?: number;
  /** Path whose write throws — the mid-copy failure. */
  failWriteAt?: string;
}

function client(trace: Trace, opts: ClientOpts = {}): DoplClient {
  const note = (method: string, arg?: string): void => {
    trace.calls.push({ method, workspace: workspaceContext.getStore(), arg });
  };
  const entries = opts.entries ?? ENTRIES;
  return {
    listKbBases: vi.fn(async () => {
      note("listKbBases");
      return [base()];
    }),
    getKbTree: vi.fn(async () => {
      note("getKbTree");
      return {
        base: base(),
        folders: FOLDERS,
        entries,
        entryTotal: opts.entryTotal ?? entries.length,
        nextEntryCursor: null,
      };
    }),
    readKbFileByPath: vi.fn(async (_baseId: string, path: string) => {
      note("readKbFileByPath", path);
      return { ...entry("e-read", path, null), body: `body of ${path}` };
    }),
    createKbBase: vi.fn(async (input: KnowledgeBaseCreateInput) => {
      note("createKbBase");
      trace.created.push(input);
      return base({
        id: "base-new",
        workspaceId: TARGET_WS,
        name: input.name,
        slug: "handbook-2",
        visibility: "private",
      });
    }),
    createKbFolderByPath: vi.fn(async (_baseId: string, path: string) => {
      note("createKbFolderByPath", path);
      return folder("f-new", path, null);
    }),
    writeKbFileByPath: vi.fn(async (_baseId: string, path: string) => {
      note("writeKbFileByPath", path);
      if (opts.failWriteAt === path) throw new Error("storage limit reached");
      return { entry: entry("e-new", path, null), created: true };
    }),
  } as unknown as DoplClient;
}

function stubDirectory(rows: WorkspaceListItem[]): WorkspaceDirectory {
  return {
    getWorkspaceList: async () => rows,
    resolveWorkspaceRef: async (ref) =>
      rows.find((w) => w.id === ref || w.slug === ref) ?? null,
    noWorkspaceError: async () => ({ content: [], isError: true }),
    lockedWorkspaceId: () => null,
  };
}

type Handler = (args: Record<string, unknown>) => Promise<ToolResponse>;

/** The REAL `dopl_kb` handler, captured off the real registrar. */
function doplKb(
  c: DoplClient,
  directory: WorkspaceDirectory,
  caller: CallerIdentity = OWNER_CALLER,
): Handler {
  const handlers = new Map<string, Handler>();
  const capture: RegisterTool = (name, _description, _schema, handler) => {
    handlers.set(name, handler as unknown as Handler);
  };
  registerKnowledgeTools(capture, c, caller, directory);
  const tool = handlers.get("dopl_kb");
  if (!tool) throw new Error("dopl_kb was not registered");
  return tool;
}

function text(res: ToolResponse): string {
  return res.content.map((c) => c.text).join("\n");
}

function of(trace: Trace, method: string): Trace["calls"] {
  return trace.calls.filter((c) => c.method === method);
}

describe("dopl_kb(op=copy_base)", () => {
  it("reads in the SOURCE tenancy and writes every row in the TARGET one", async () => {
    const trace: Trace = { calls: [], created: [] };
    const res = await doplKb(
      client(trace),
      stubDirectory([SOURCE, TARGET]),
    )({ op: "copy_base", base: "handbook", to_workspace: "target" });

    expect(res.isError).toBeUndefined();
    // 🔒 LEG 1 in the source, LEG 2 in the target — no write escapes the target.
    for (const c of [...of(trace, "getKbTree"), ...of(trace, "readKbFileByPath")]) {
      expect(c.workspace).toBe(SOURCE_WS);
    }
    for (const method of ["createKbBase", "createKbFolderByPath", "writeKbFileByPath"]) {
      expect(of(trace, method).length).toBeGreaterThan(0);
      for (const c of of(trace, method)) expect(c.workspace).toBe(TARGET_WS);
    }
    // ⚠ PARENTS FIRST — `projects` before `projects/deep`, so each folder is
    // created explicitly and carries its own description.
    expect(of(trace, "createKbFolderByPath").map((c) => c.arg)).toEqual([
      "projects",
      "projects/deep",
    ]);
    // Paths are the source's, rebuilt from the folder chain.
    expect(of(trace, "writeKbFileByPath").map((c) => c.arg)).toEqual([
      "Readme",
      "projects/deep/Notes",
    ]);
    expect(text(res)).toContain("2 folders and 2 entries written");
    expect(text(res)).toContain('workspace="target"');
  });

  it("lands PRIVATE and sends no shelf", async () => {
    const trace: Trace = { calls: [], created: [] };
    await doplKb(
      client(trace),
      stubDirectory([SOURCE, TARGET]),
    )({ op: "copy_base", base: "handbook", to_workspace: "target" });

    // ⚠ The source is `public`; carrying that would publish the copy into the
    // target, which inside a shared container is the confirm class.
    expect(trace.created).toEqual([
      { name: "Handbook", description: "How we work", visibility: "private" },
    ]);
    expect(trace.created[0]).not.toHaveProperty("homeScoped");
  });

  it("REFUSES an unresolvable to_workspace and creates nothing", async () => {
    const trace: Trace = { calls: [], created: [] };
    const res = await doplKb(
      client(trace),
      stubDirectory([SOURCE, TARGET]),
    )({ op: "copy_base", base: "handbook", to_workspace: "nowhere" });

    expect(res.isError).toBe(true);
    expect(text(res)).toContain("does not resolve for you");
    // ⚠ Not even the tree was read — the target resolves first.
    expect(trace.calls).toEqual([]);
  });

  it("REFUSES a copy onto the workspace the base already lives in", async () => {
    const trace: Trace = { calls: [], created: [] };
    const res = await doplKb(
      client(trace),
      stubDirectory([SOURCE, TARGET]),
    )({ op: "copy_base", base: "handbook", to_workspace: "source" });

    expect(res.isError).toBe(true);
    expect(text(res)).toContain("already lives in");
    expect(trace.created).toEqual([]);
    expect(of(trace, "getKbTree")).toEqual([]);
  });

  it("🔒 a CONTAINER-LOCKED session cannot aim a copy at another workspace", async () => {
    const trace: Trace = { calls: [], created: [] };
    // ⚠ The REAL directory under a real lock, not a stub imitating one.
    const locked = createWorkspaceDirectory(client(trace), {
      directory: [SOURCE, TARGET, CONTAINER],
      lockedTo: CONTAINER,
    });
    const tool = doplKb(client(trace), locked);

    for (const ref of ["target", TARGET_WS, "source"]) {
      const res = await tool({
        op: "copy_base",
        base: "handbook",
        to_workspace: ref,
      });
      expect(res.isError, `to_workspace=${ref} was not refused`).toBe(true);
      expect(text(res)).toContain("does not resolve for you");
    }
    expect(trace.created).toEqual([]);
    // The locked container itself still resolves — the lock narrows the op, it
    // does not disable it.
    const own = await tool({
      op: "copy_base",
      base: "handbook",
      to_workspace: CONTAINER.id,
    });
    expect(own.isError).toBeUndefined();
    expect(text(own)).toContain(`workspace="${CONTAINER.id}"`);
  });

  it("REFUSES above MAX_COPY_ENTRIES, before writing anything", async () => {
    const trace: Trace = { calls: [], created: [] };
    const oversized = Array.from({ length: MAX_COPY_ENTRIES + 1 }, (_, i) =>
      entry(`e-${i}`, `Note ${i}`, null),
    );
    const res = await doplKb(
      client(trace, { entries: oversized, entryTotal: MAX_COPY_ENTRIES + 1 }),
      stubDirectory([SOURCE, TARGET]),
    )({ op: "copy_base", base: "handbook", to_workspace: "target" });

    expect(res.isError).toBe(true);
    expect(text(res)).toContain(`${MAX_COPY_ENTRIES + 1} entries`);
    expect(text(res)).toContain(`at most ${MAX_COPY_ENTRIES}`);
    // ⚠ THE CAP IS CHECKED ON THE TREE: no body was read and no row was written.
    expect(of(trace, "readKbFileByPath")).toEqual([]);
    expect(trace.created).toEqual([]);
    expect(of(trace, "writeKbFileByPath")).toEqual([]);
  });

  it("reports a mid-copy failure as PARTIAL, never as success", async () => {
    const trace: Trace = { calls: [], created: [] };
    const res = await doplKb(
      client(trace, { failWriteAt: "projects/deep/Notes" }),
      stubDirectory([SOURCE, TARGET]),
    )({ op: "copy_base", base: "handbook", to_workspace: "target" });

    expect(res.isError).toBe(true);
    const body = text(res);
    expect(body).toContain("PARTIAL COPY");
    // ⚠ WHAT EXISTS, and how much of it — the operator cannot finish or discard
    // it without the id and the counts.
    expect(body).toContain("base-new");
    expect(body).toContain("2 of 2 folders and 1 of 2 entries");
    expect(body).toContain("projects/deep/Notes");
    expect(body).toContain("storage limit reached");
    // ⚠ And it must NOT read as a clean copy.
    expect(body).not.toContain("Copied the knowledge base");
  });

  describe("🔒 R2 — the source must be one the CALLER created", () => {
    it("refuses a base created by somebody else, and reads no tree at all", async () => {
      // ⚠ MUTATION CHECK. Delete `notOwnedRefusal` from `opCopyBase` and this
      // copy succeeds: the base is READABLE (`visibility: "public"`), which is
      // exactly the thing readability is not evidence of.
      const trace: Trace = { calls: [], created: [] };
      const c = client(trace);
      vi.mocked(c.listKbBases).mockResolvedValue([
        base({ createdBy: "somebody-else" }),
      ]);
      const res = await doplKb(c, stubDirectory([SOURCE, TARGET]))({
        op: "copy_base",
        base: "handbook",
        to_workspace: "target",
      });

      expect(res.isError).toBe(true);
      expect(text(res)).toContain("YOU created");
      // ⚠ BEFORE the tree read, so a refusal costs no loopback traffic.
      expect(of(trace, "getKbTree")).toEqual([]);
      expect(trace.created).toEqual([]);
    });

    it("FAILS CLOSED when the row has no owner recorded", async () => {
      const trace: Trace = { calls: [], created: [] };
      const c = client(trace);
      vi.mocked(c.listKbBases).mockResolvedValue([base({ createdBy: null })]);
      const res = await doplKb(c, stubDirectory([SOURCE, TARGET]))({
        op: "copy_base",
        base: "handbook",
        to_workspace: "target",
      });
      expect(res.isError).toBe(true);
      expect(trace.created).toEqual([]);
    });

    it("FAILS CLOSED when the session could not resolve who the caller is", async () => {
      const trace: Trace = { calls: [], created: [] };
      const res = await doplKb(
        client(trace),
        stubDirectory([SOURCE, TARGET]),
        UNKNOWN_CALLER,
      )({ op: "copy_base", base: "handbook", to_workspace: "target" });
      expect(res.isError).toBe(true);
      expect(text(res)).toContain("could not resolve who you are");
      expect(trace.created).toEqual([]);
    });
  });

  it("maps the shared-credential PRIVATE refusal, and calls it NOTHING created", async () => {
    // ⚠ The create sat OUTSIDE `writeCopy`'s try/catch until 2026-09-02, so this
    // 403 reached the agent as an unhandled throw over a copy that made nothing.
    // ⚠ MUTATION CHECK: it must NOT be re-framed as a PARTIAL copy — there is no
    // tree to finish.
    const trace: Trace = { calls: [], created: [] };
    const c = client(trace);
    vi.mocked(c.createKbBase).mockRejectedValue(
      Object.assign(new Error("denied"), {
        status: 403,
        code: "WORKSPACE_KEY_PRIVATE_VISIBILITY",
        apiMessage: "This credential cannot own a private knowledge base.",
      }),
    );
    const res = await doplKb(c, stubDirectory([SOURCE, TARGET]))({
      op: "copy_base",
      base: "handbook",
      to_workspace: "target",
    });

    expect(res.isError).toBe(true);
    expect(text(res)).toContain("NOTHING was created");
    expect(text(res)).not.toContain("PARTIAL COPY");
    expect(of(trace, "writeKbFileByPath")).toEqual([]);
  });
});
