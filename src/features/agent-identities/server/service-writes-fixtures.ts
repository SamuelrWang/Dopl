/**
 * Builders and `vi.mock` factories shared by the agent-identity service suites. Deliberately not
 * `*.test.ts`: imported, never run. `vi.mock` is hoisted, so each suite keeps its own call and reaches
 * the factories here through `await import`.
 */

import { vi, type MockedObject } from "vitest";
import type * as GrantReach from "@/shared/tenancy/resource-grant-reach";
import type * as Resolver from "@/shared/tenancy/resolve-resource";
import type * as Repo from "./repository";
import type { AgentIdentity, AgentIdentityContext } from "../types";

export const OWNER = "user-owner";
export const OTHER = "user-other";
export const TEAM_A = "11111111-1111-4111-8111-111111111111";
export const TEAM_B = "22222222-2222-4222-8222-222222222222";
export const KB_OPEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const KB_PRIVATE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const KB_TEAM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

export function ctx(
  overrides: Partial<AgentIdentityContext> = {}
): AgentIdentityContext {
  return {
    workspaceId: "ws-1",
    userId: OWNER,
    source: "user",
    role: "member",
    apiKeyWorkspaceId: null,
    credentialSubjectUserId: OWNER,
    ...overrides,
  };
}

export function identity(
  overrides: Partial<AgentIdentity> = {}
): AgentIdentity {
  return {
    id: "id-1",
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

/** Every field the launch payload carries, populated. */
export const AUDITOR = {
  name: "Code Auditor",
  description: "ignored by the launch payload",
  instructions: "Audit the diff.",
  model: "claude-opus-5",
} satisfies Partial<AgentIdentity>;

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

/** `./repository`: every function the service suites reach. */
export function repoMock() {
  return {
    listIdentitiesForWorkspace: vi.fn(),
    findIdentityById: vi.fn(),
    insertIdentity: vi.fn(),
    updateIdentityRow: vi.fn(),
    hardDeleteIdentity: vi.fn(),
    listTeamLinksForIdentities: vi.fn(),
    replaceTeamLinks: vi.fn(),
    listTeamIdsForUser: vi.fn(),
    filterTeamIdsInWorkspace: vi.fn(),
    listKnowledgeLinksForIdentities: vi.fn(),
    replaceKnowledgeLinks: vi.fn(),
    listKnowledgeBaseAccessRows: vi.fn(),
    listKnowledgeBaseTeamGrants: vi.fn(),
    listLiveFoldersForBases: vi.fn(),
    listLiveEntryRows: vi.fn(),
  };
}

/** The grant arm is a DB read (F-604); these suites test the other arms, so the grant set is empty. */
export async function noGrantsMock(importOriginal: () => Promise<typeof GrantReach>) {
  return { ...(await importOriginal()), grantedResourceIds: vi.fn(async () => new Set<string>()) };
}

/** The resolver names nothing elsewhere; unmocked it reaches Supabase and hangs. */
export async function resolveNowhereMock(importOriginal: () => Promise<typeof Resolver>) {
  return {
    ...(await importOriginal()),
    resolveResource: vi.fn(async () => null),
    resolveResourcesByName: vi.fn(async () => []),
  };
}

/** A standard "ws-1": the create gates read the workspace row, and unmocked they hang. */
export function workspaceRepoMock() {
  return {
    findDefaultWorkspaceForUser: vi.fn().mockResolvedValue(null),
    findWorkspaceById: vi.fn().mockResolvedValue({ id: "ws-1", kind: "standard" }),
  };
}

/** Every list read answers empty; an unset sub-base read is `undefined`, a `TypeError` rather than a refusal. */
export function resetReadMocks(mockRepo: MockedObject<typeof Repo>): void {
  mockRepo.listTeamLinksForIdentities.mockResolvedValue([]);
  mockRepo.listTeamIdsForUser.mockResolvedValue([]);
  mockRepo.listKnowledgeLinksForIdentities.mockResolvedValue([]);
  mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([]);
  mockRepo.listKnowledgeBaseTeamGrants.mockResolvedValue([]);
  mockRepo.listLiveFoldersForBases.mockResolvedValue([]);
  mockRepo.listLiveEntryRows.mockResolvedValue([]);
}

/**
 * {@link resetReadMocks} plus the write defaults. Takes the mocked module as an argument because the
 * `vi.mock` factory lives in the caller. `insertIdentity` re-points `findIdentityById` at the inserted
 * row; otherwise a non-owner's create 404s on its own result.
 */
export function resetRepoMocks(mockRepo: MockedObject<typeof Repo>): void {
  resetReadMocks(mockRepo);
  mockRepo.filterTeamIdsInWorkspace.mockImplementation(async (_ws, ids) => ids);
  mockRepo.insertIdentity.mockImplementation(async (args) => {
    const row = identity({ visibility: args.visibility, createdBy: args.createdBy });
    mockRepo.findIdentityById.mockResolvedValue(row);
    return row;
  });
  mockRepo.updateIdentityRow.mockResolvedValue(identity());
  mockRepo.findIdentityById.mockResolvedValue(identity());
}
