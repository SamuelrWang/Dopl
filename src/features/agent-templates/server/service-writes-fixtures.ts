/**
 * SHARED FIXTURES for the agent-template write suites — ⚠ NOT a test file, and
 * not a place for assertions.
 *
 * `service-writes.test.ts` and `service-writes-junction.test.ts` drive the same
 * service against the same mocked repository, and both need the same context,
 * the same template row and the same knowledge-base rows. They are two files
 * only because one file was over the 500-line cap, so a second copy of this
 * harness would be a copy made for a formatting reason — the worst kind, since
 * nothing would ever tell you the two had drifted.
 *
 * ⚠ **`vi.mock` STAYS IN EACH TEST FILE.** It is hoisted above imports by the
 * transform, so it cannot live here; what CAN live here is everything that runs
 * afterwards — the row fixtures and the per-test reset ({@link resetRepoMocks}).
 */

import type { MockedObject } from "vitest";
import type * as Repo from "./repository";
import type { AgentTemplate, AgentTemplateContext } from "../types";

export const OWNER = "user-owner";
export const OTHER = "user-other";
export const TEAM_A = "11111111-1111-4111-8111-111111111111";
export const TEAM_B = "22222222-2222-4222-8222-222222222222";
export const KB_OPEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const KB_PRIVATE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const KB_TEAM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

export function ctx(
  overrides: Partial<AgentTemplateContext> = {}
): AgentTemplateContext {
  return {
    workspaceId: "ws-1",
    userId: OWNER,
    source: "user",
    role: "member",
    apiKeyWorkspaceId: null,
    ...overrides,
  };
}

export function template(
  overrides: Partial<AgentTemplate> = {}
): AgentTemplate {
  return {
    id: "tpl-1",
    workspaceId: "ws-1",
    name: "Researcher",
    description: null,
    instructions: null,
    model: null,
    fields: [],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [],
    createdBy: OWNER,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Knowledge-base rows as the repository hands them over. */
export const BASES = {
  [KB_OPEN]: {
    id: KB_OPEN,
    name: "Handbook",
    visibility: "public" as const,
    accessMode: "workspace" as const,
    createdBy: OTHER,
  },
  [KB_PRIVATE]: {
    id: KB_PRIVATE,
    name: "Someone's notes",
    visibility: "private" as const,
    accessMode: "workspace" as const,
    createdBy: OTHER,
  },
  [KB_TEAM]: {
    id: KB_TEAM,
    name: "Legal",
    visibility: "public" as const,
    accessMode: "teams" as const,
    createdBy: OTHER,
  },
};

/**
 * The per-test reset both suites run.
 *
 * ⚠ The insert mock ECHOES the visibility it was asked for, and
 * `findTemplateById` returns the same row. Both writes re-read through
 * `getTemplateById` so the response is the gated shape a GET returns — a
 * fixture that answered a fixed `private` row would make every create by a
 * non-owner 404 on its own result, which is a fixture bug that reads exactly
 * like a gate bug.
 *
 * ⚠ Takes the mocked module as an ARGUMENT rather than importing it: the
 * `vi.mock` factory lives in the calling test file, so this module must not
 * bind to one. The parameter is `MockedObject<typeof Repo>`, so a repository
 * function that changes shape fails HERE rather than in whichever suite runs
 * first.
 */
export function resetRepoMocks(mockRepo: MockedObject<typeof Repo>): void {
  mockRepo.listTeamLinksForTemplates.mockResolvedValue([]);
  mockRepo.listTeamIdsForUser.mockResolvedValue([]);
  mockRepo.listKnowledgeLinksForTemplates.mockResolvedValue([]);
  mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([]);
  mockRepo.listKnowledgeBaseTeamGrants.mockResolvedValue([]);
  mockRepo.filterTeamIdsInWorkspace.mockImplementation(async (_ws, ids) => ids);
  mockRepo.insertTemplate.mockImplementation(async (args) => {
    const row = template({ visibility: args.visibility, createdBy: args.createdBy });
    mockRepo.findTemplateById.mockResolvedValue(row);
    return row;
  });
  mockRepo.updateTemplateRow.mockResolvedValue(template());
  mockRepo.findTemplateById.mockResolvedValue(template());
}
