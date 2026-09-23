/**
 * HISTORY + RESTORE on `dopl_kb`, `dopl_skill` and `dopl_ontology` (DMP-002, 2026-09-23).
 *
 * What is pinned: the list hands back revision ids and the current Version; `revision=` previews
 * the snapshot; `restore` REQUIRES `expected_version`, refuses a stale one before any write, sends
 * it as the precondition, maps 412 / 404 / 409 to named refusals, returns the NEW Version, and
 * refuses a param the op does not take.
 */

import { describe, it, expect, vi } from "vitest";
import type { ContentRevision, DoplClient } from "@dopl/client";

import { registerKnowledgeTools } from "./knowledge";
import { registerSkillTools } from "./skills";
import { registerOntologyTool } from "./ontology";
import type { RegisterTool, ToolResponse } from "./respond";
import type { WorkspaceDirectory } from "../workspace-directory";
import { stub } from "./narration-fixtures";

const ME = "user-me";
const V1 = "2026-09-20T00:00:00.000Z";
const V2 = "2026-09-23T00:00:00.000Z";

const DIRECTORY: WorkspaceDirectory = {
  getWorkspaceList: async () => [],
  resolveWorkspaceRef: async () => null,
  noWorkspaceError: async () => ({ content: [], isError: true }),
  resolveContainerRef: async () => null,
  homeContainer: async () => null,
  containerKindIndex: async () => new Map(),
  lockedWorkspaceId: () => null,
};

function capture(register: (r: RegisterTool) => void, name: string) {
  let handler: ((a: Record<string, unknown>) => Promise<ToolResponse>) | null = null;
  register(((n: string, _d: string, _s: unknown, h: unknown) => {
    if (n === name) handler = h as typeof handler;
  }) as RegisterTool);
  return async (args: Record<string, unknown>) => {
    const res = await (handler as NonNullable<typeof handler>)(args);
    return { text: res.content.map((c) => c.text).join("\n"), isError: res.isError === true };
  };
}

const apiError = (status: number, code: string) =>
  Object.assign(new Error(code), { status, code, apiMessage: code });

function rev(over: Partial<ContentRevision> = {}): ContentRevision {
  return {
    id: "rev-1",
    resourceType: "knowledge_entry",
    resourceId: "entry-1",
    workspaceId: "ws-1",
    actor: { userId: "user-other", kind: "user", agentSessionId: null },
    op: "edit",
    summary: null,
    payload: { body: "old body", title: "Notes", path: "Notes" },
    contentHash: "h",
    createdAt: V1,
    updatedAt: V1,
    ...over,
  };
}

// ─── dopl_kb ─────────────────────────────────────────────────────────

const BASE = { id: "base-1", slug: "notes", name: "Notes", workspaceId: "ws-1" };
const ENTRY = {
  id: "entry-1",
  title: "Notes",
  body: "",
  updatedAt: V2,
  createdBy: ME,
  lastEditedBy: ME,
};

function kbClient(over: Record<string, unknown> = {}) {
  return stub({
    listKbBases: vi.fn(async () => [BASE]),
    readKbFilePart: vi.fn(async () => ({ entry: ENTRY, outline: { totalChars: 42, sections: [] } })),
    listKbEntryRevisions: vi.fn(async () => ({ revisions: [rev()], nextCursor: "c2" })),
    restoreKbEntryRevision: vi.fn(async () => ({ ...ENTRY, body: "old body", updatedAt: "2026-09-23T01:00:00.000Z" })),
    ...over,
  });
}

const kb = (client: DoplClient) =>
  capture((r) => registerKnowledgeTools(r, client, { userId: ME } as never, DIRECTORY), "dopl_kb");

describe("dopl_kb history + restore", () => {
  it("history lists revision ids, the current Version and the next cursor", async () => {
    const client = kbClient();
    const { text } = await kb(client)({ op: "history", base: "notes", path: "Notes", limit: 5 });
    expect(client.listKbEntryRevisions).toHaveBeenCalledWith("entry-1", { cursor: undefined, limit: 5 });
    expect(text).toContain("`rev-1` · edit");
    expect(text).toContain(`Version \`${V2}\``);
    expect(text).toContain('entry_cursor="c2"');
    expect(text).toContain("by a member");
  });

  it("history with revision= previews the snapshot, FENCED when another member wrote it", async () => {
    const { text } = await kb(kbClient())({ op: "history", base: "notes", path: "Notes", revision: "rev-1" });
    expect(text).toContain("Restoring writes THIS snapshot");
    expect(text).toContain(`expected_version="${V2}"`);
    expect(text).toContain("old body");
    expect(text).toContain("untrusted");
  });

  it("restore sends the precondition and returns old → new Version", async () => {
    const client = kbClient();
    const { text, isError } = await kb(client)({
      op: "restore", base: "notes", path: "Notes", revision: "rev-1", expected_version: V2,
    });
    expect(isError).toBe(false);
    expect(client.restoreKbEntryRevision).toHaveBeenCalledWith("entry-1", "rev-1", V2);
    expect(text).toContain(`\`${V2}\` → \`2026-09-23T01:00:00.000Z\``);
    expect(text).toContain("NEW revision");
  });

  it("restore REQUIRES expected_version", async () => {
    const client = kbClient();
    const { text } = await kb(client)({ op: "restore", base: "notes", path: "Notes", revision: "rev-1" });
    expect(client.restoreKbEntryRevision).not.toHaveBeenCalled();
    expect(text).toContain("reason=missing_params");
    expect(text).toContain("expected_version");
  });

  it("a stale expected_version is refused BEFORE any write", async () => {
    const client = kbClient();
    const { text } = await kb(client)({
      op: "restore", base: "notes", path: "Notes", revision: "rev-1", expected_version: V1,
    });
    expect(client.restoreKbEntryRevision).not.toHaveBeenCalled();
    expect(text).toContain("reason=version_conflict");
  });

  it.each([
    [412, "KNOWLEDGE_STALE_VERSION", "reason=version_conflict"],
    [404, "REVISION_NOT_FOUND", "reason=revision_not_found"],
    [409, "REVISION_NOT_RESTORABLE", "reason=revision_not_restorable"],
  ])("maps a %i %s to %s", async (status, code, reason) => {
    const client = kbClient({ restoreKbEntryRevision: vi.fn(async () => { throw apiError(status, code); }) });
    const { text, isError } = await kb(client)({
      op: "restore", base: "notes", path: "Notes", revision: "rev-1", expected_version: V2,
    });
    expect(isError).toBe(true);
    expect(text).toContain(reason);
  });

  it("refuses a param the op does not take", async () => {
    const client = kbClient();
    const { text } = await kb(client)({
      op: "restore", base: "notes", path: "Notes", revision: "rev-1", expected_version: V2, force: true,
    });
    expect(client.restoreKbEntryRevision).not.toHaveBeenCalled();
    expect(text).toContain("reason=unused_param");
    expect(text).toContain("force");
  });
});

// ─── dopl_skill ──────────────────────────────────────────────────────

const FILE = { id: "f-1", skillId: "skill-1", body: "new body", updatedAt: V2, createdBy: ME, lastEditedBy: ME };

function skillClient(over: Record<string, unknown> = {}) {
  return stub({
    readSkillBody: vi.fn(async () => FILE),
    getSkillHistory: vi.fn(async () => ({
      versions: [{ id: "ver-1", skillId: "skill-1", authorId: ME, source: "web", createdAt: V1, bodyBytes: 8 }],
      events: [],
    })),
    getSkillVersion: vi.fn(async () => ({
      id: "ver-1", skillId: "skill-1", authorId: ME, source: "web", createdAt: V1, bodyBytes: 8, body: "old body",
    })),
    restoreSkillVersion: vi.fn(async () => ({ ...FILE, body: "old body", updatedAt: "2026-09-23T02:00:00.000Z" })),
    ...over,
  });
}

const skill = (client: DoplClient) =>
  capture((r) => registerSkillTools(r, client, { userId: ME } as never), "dopl_skill");

describe("dopl_skill history + restore", () => {
  it("history lists version ids with the current Version", async () => {
    const { text } = await skill(skillClient())({ op: "history", slug: "outreach" });
    expect(text).toContain("`ver-1`");
    expect(text).toContain(`Version \`${V2}\``);
  });

  it("history with revision= previews the old body", async () => {
    const { text } = await skill(skillClient())({ op: "history", slug: "outreach", revision: "ver-1" });
    expect(text).toContain("old body");
    expect(text).toContain(`expected_version="${V2}"`);
  });

  it("restore sends the precondition and returns the new Version", async () => {
    const client = skillClient();
    const { text } = await skill(client)({ op: "restore", slug: "outreach", revision: "ver-1", expected_version: V2 });
    expect(client.restoreSkillVersion).toHaveBeenCalledWith("ver-1", V2);
    expect(text).toContain("→ `2026-09-23T02:00:00.000Z`");
  });

  it("refuses a version that belongs to ANOTHER skill, writing nothing", async () => {
    const client = skillClient({
      getSkillVersion: vi.fn(async () => ({ id: "ver-9", skillId: "skill-9", authorId: ME, source: "web", createdAt: V1, bodyBytes: 1, body: "x" })),
    });
    const { text } = await skill(client)({ op: "restore", slug: "outreach", revision: "ver-9", expected_version: V2 });
    expect(client.restoreSkillVersion).not.toHaveBeenCalled();
    expect(text).toContain("reason=revision_not_found");
  });
});

// ─── dopl_ontology ───────────────────────────────────────────────────

const OBJECT = {
  id: "obj-1", name: "Acme", subtitle: "", attributes: [], methods: [], relationships: [],
  childIds: [], template: [], updatedAt: V2,
};

function ontologyClient(over: Record<string, unknown> = {}) {
  return stub({
    getOntology: vi.fn(async () => ({
      clusters: [{ id: "cl-1", slug: "crm", name: "CRM", purpose: "", columnIds: [] }],
      objects: { "obj-1": OBJECT },
    })),
    listOntologyObjectRevisions: vi.fn(async () => ({
      revisions: [rev({ resourceType: "ontology_object", resourceId: "obj-1", payload: { field: "name", before: "Acme Inc", after: "Acme" } })],
      nextCursor: null,
    })),
    listOntologyClusterRevisions: vi.fn(async () => ({ revisions: [], nextCursor: null })),
    restoreOntologyObjectRevision: vi.fn(async () => ({ ...OBJECT, name: "Acme Inc", updatedAt: "2026-09-23T03:00:00.000Z" })),
    ...over,
  });
}

const ontology = (client: DoplClient) =>
  capture((r) => registerOntologyTool(r, client, { userId: ME } as never), "dopl_ontology");

describe("dopl_ontology history + restore", () => {
  it("object history prints each field's before → after", async () => {
    const { text } = await ontology(ontologyClient())({ op: "history", object: "obj-1" });
    expect(text).toContain("`rev-1`");
    expect(text).toContain("`name`: `Acme Inc` → `Acme`");
    expect(text).toContain(`Version \`${V2}\``);
  });

  it("history refuses object= and cluster= together", async () => {
    const { text, isError } = await ontology(ontologyClient())({ op: "history", object: "obj-1", cluster: "crm" });
    expect(isError).toBe(true);
    expect(text).toContain("never both");
  });

  it("restore writes the precondition and returns the new Version", async () => {
    const client = ontologyClient();
    const { text } = await ontology(client)({ op: "restore", object: "obj-1", revision: "rev-1", expected_version: V2 });
    expect(client.restoreOntologyObjectRevision).toHaveBeenCalledWith("obj-1", "rev-1", V2);
    expect(text).toContain("→ `2026-09-23T03:00:00.000Z`");
  });

  it("restore with a stale Version writes nothing", async () => {
    const client = ontologyClient();
    const { text } = await ontology(client)({ op: "restore", object: "obj-1", revision: "rev-1", expected_version: V1 });
    expect(client.restoreOntologyObjectRevision).not.toHaveBeenCalled();
    expect(text).toContain("reason=version_conflict");
  });
});
