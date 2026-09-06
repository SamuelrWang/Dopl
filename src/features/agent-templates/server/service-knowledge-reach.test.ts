/**
 * `unreachableKnowledgeBaseCount` — WHAT A LAUNCH IS TOLD ABOUT AN ATTACHMENT IT
 * CANNOT REACH (Samuel's ruling, 2026-09-05).
 *
 * ⚠ THE RULING IN ONE LINE: a user MAY attach a shared base to a personal
 * template, and launching it where the base is out of reach must START THE AGENT
 * ANYWAY and let it say *"I don't have access to this knowledge base in this
 * channel"* — WITHOUT saying where the base lives.
 *
 * So the two halves this file pins are:
 *   1. the COUNT is honest (it is the junction rows the viewer filter dropped),
 *      and it never blocks the launch;
 *   2. the payload carries NOTHING ELSE about a dropped base — no id, no name,
 *      no container — because the prompt line the desktop writes from it is the
 *      one place a location leak would land in text an agent reads.
 *
 * ⚠ SIBLING OF `service-resolve.test.ts`, same seam and same mocks: this file
 * owns the REACH arithmetic, that one owns `authoredByCaller` and the 404.
 * Through the public service with the repository mocked: no Supabase, no network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentTemplate, AgentTemplateContext } from "../types";

// ⚠ THE GRANT ARM IS A DB READ (F-604) — empty here, exactly as the sibling
// suite declares it: every case below is about the viewer filter's OTHER arms.
vi.mock("@/shared/tenancy/resource-grant-reach", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/shared/tenancy/resource-grant-reach")
  >()),
  grantedResourceIds: vi.fn(async () => new Set<string>()),
}));

vi.mock("./repository", () => ({
  listTemplatesForWorkspace: vi.fn(),
  findTemplateById: vi.fn(),
  listTeamLinksForTemplates: vi.fn(),
  listTeamIdsForUser: vi.fn(),
  listKnowledgeLinksForTemplates: vi.fn(),
  listKnowledgeBaseAccessRows: vi.fn(),
  listKnowledgeBaseTeamGrants: vi.fn(),
}));

vi.mock("@/shared/tenancy/resolve-resource", () => ({
  resolveResource: vi.fn(async () => null),
}));

import * as repo from "./repository";
import * as tenancy from "@/shared/tenancy/resolve-resource";
import { resolveTemplateForLaunch } from "./service";

const mockRepo = vi.mocked(repo);
const mockTenancy = vi.mocked(tenancy);

const CREATOR = "user-creator";
const REACHABLE = "kb-reachable";
const OUT_OF_REACH = "kb-out-of-reach";

function ctx(overrides: Partial<AgentTemplateContext> = {}): AgentTemplateContext {
  return {
    workspaceId: "ws-1",
    userId: CREATOR,
    source: "user",
    role: "member",
    apiKeyWorkspaceId: null,
    credentialSubjectUserId: CREATOR,
    ...overrides,
  };
}

function template(overrides: Partial<AgentTemplate> = {}): AgentTemplate {
  return {
    id: "tpl-1",
    workspaceId: "ws-1",
    name: "Code Auditor",
    description: "ignored by the launch payload",
    instructions: "Audit the diff.",
    model: "claude-opus-5",
    fields: [],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [],
    createdBy: CREATOR,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** A junction row: the template NAMES this base, whatever the reader can see. */
const link = (knowledgeBaseId: string) => ({
  templateId: "tpl-1",
  knowledgeBaseId,
});

/** A base row the viewer filter WILL keep — public, workspace-wide. */
const visibleBase = (id: string, name: string) => ({
  id,
  name,
  visibility: "public" as const,
  accessMode: "workspace" as const,
  createdBy: CREATOR,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockTenancy.resolveResource.mockResolvedValue(null);
  mockRepo.findTemplateById.mockResolvedValue(template());
  mockRepo.listKnowledgeLinksForTemplates.mockResolvedValue([]);
  mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([]);
  mockRepo.listKnowledgeBaseTeamGrants.mockResolvedValue([]);
  mockRepo.listTeamLinksForTemplates.mockResolvedValue([]);
  mockRepo.listTeamIdsForUser.mockResolvedValue([]);
});

describe("the count", () => {
  it("is 0 when the template attaches nothing", async () => {
    // ⚠ A DECIDED ZERO, not an absence: this row went through the decoration and
    // the answer is "nothing was dropped".
    const resolved = await resolveTemplateForLaunch(ctx(), "tpl-1");
    expect(resolved.unreachableKnowledgeBaseCount).toBe(0);
    expect(resolved.knowledgeBases).toEqual([]);
  });

  it("is 0 when every attachment resolves", async () => {
    mockRepo.listKnowledgeLinksForTemplates.mockResolvedValue([link(REACHABLE)]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([
      visibleBase(REACHABLE, "Ops Notes"),
    ]);
    const resolved = await resolveTemplateForLaunch(ctx(), "tpl-1");
    expect(resolved.unreachableKnowledgeBaseCount).toBe(0);
    expect(resolved.knowledgeBases).toEqual([{ id: REACHABLE, name: "Ops Notes" }]);
  });

  it("counts the attachment the viewer filter dropped — THE RULED CASE", async () => {
    // The shared base attached to a personal template, launched where the base
    // does not resolve: the junction row exists, the base row does not come back.
    mockRepo.listKnowledgeLinksForTemplates.mockResolvedValue([link(OUT_OF_REACH)]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([]);
    const resolved = await resolveTemplateForLaunch(ctx(), "tpl-1");
    expect(resolved.unreachableKnowledgeBaseCount).toBe(1);
  });

  it("counts only the dropped ones when a template has both", async () => {
    mockRepo.listKnowledgeLinksForTemplates.mockResolvedValue([
      link(REACHABLE),
      link(OUT_OF_REACH),
    ]);
    mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([
      visibleBase(REACHABLE, "Ops Notes"),
    ]);
    const resolved = await resolveTemplateForLaunch(ctx(), "tpl-1");
    expect(resolved.unreachableKnowledgeBaseCount).toBe(1);
    expect(resolved.knowledgeBases).toEqual([{ id: REACHABLE, name: "Ops Notes" }]);
  });
});

describe("what it must NOT do", () => {
  it("does not block the launch — the payload is whole, minus the base", async () => {
    // ⚠ THE HALF OF THE RULING A REFUSAL WOULD BREAK. An unreachable attachment
    // is a thing to SAY, never a reason to refuse to start.
    mockRepo.listKnowledgeLinksForTemplates.mockResolvedValue([link(OUT_OF_REACH)]);
    const resolved = await resolveTemplateForLaunch(ctx(), "tpl-1");
    expect(resolved.name).toBe("Code Auditor");
    expect(resolved.instructions).toBe("Audit the diff.");
    expect(resolved.knowledgeBases).toEqual([]);
    expect(resolved.unreachableKnowledgeBaseCount).toBe(1);
  });

  it("says NOTHING about the dropped base beyond the count — no id, no name, no container", async () => {
    // 🔒 The leak test. Serialised, because a location could hide in any key: the
    // payload may not contain the dropped id anywhere, at any depth.
    mockRepo.listKnowledgeLinksForTemplates.mockResolvedValue([link(OUT_OF_REACH)]);
    const resolved = await resolveTemplateForLaunch(ctx(), "tpl-1");
    expect(JSON.stringify(resolved)).not.toContain(OUT_OF_REACH);
    expect(Object.keys(resolved).sort()).toEqual([
      "authoredByCaller",
      "fields",
      "instructions",
      "knowledgeBases",
      "model",
      "name",
      "unreachableKnowledgeBaseCount",
    ]);
  });

  it("issues NO second read to find out where the base went", async () => {
    // ⚠ THE ARITHMETIC IS OVER ROWS ALREADY READ. A probe for a base outside the
    // caller's reach is precisely what the no-location rule forbids, so the count
    // must cost exactly the queries the decoration already made.
    mockRepo.listKnowledgeLinksForTemplates.mockResolvedValue([link(OUT_OF_REACH)]);
    await resolveTemplateForLaunch(ctx(), "tpl-1");
    expect(mockRepo.listKnowledgeLinksForTemplates).toHaveBeenCalledTimes(1);
    expect(mockRepo.listKnowledgeBaseAccessRows).toHaveBeenCalledTimes(1);
    expect(mockRepo.listKnowledgeBaseAccessRows).toHaveBeenCalledWith("ws-1", [
      OUT_OF_REACH,
    ]);
  });
});
