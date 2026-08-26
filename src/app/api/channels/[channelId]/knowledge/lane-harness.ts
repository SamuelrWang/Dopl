import { vi } from "vitest";
import { NextRequest } from "next/server";
import type { Role } from "@/features/workspaces/types";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import * as channelRepo from "@/features/channels/server/repository";
import * as kbRepo from "@/features/knowledge/server/repository";
import * as grantRepo from "@/features/knowledge/server/repository-channel-grants";
import type { ChannelResourceGrantRow } from "@/features/knowledge/server/repository-channel-grants";
import type { ChannelMemberRow, ChannelRow } from "@/features/channels/server/dto";
import type { KnowledgeBase, KnowledgeEntry } from "@/features/knowledge/types";

/**
 * SHARED FIXTURES + MOCK WIRING for the guest knowledge lane's two pin files
 * (`grant-lane.test.ts` — the channel and base fences; `grant-lane-entries.test.ts`
 * — the entry-addressed pair). ⚠ NOT a test file: no `.test.` in the name, so
 * vitest does not collect it.
 *
 * ⚠ IT WIRES MOCKS BUT DECLARES NONE. `vi.mock` is hoisted per MODULE, so each
 * test file states its own mock list — that list is part of what each file
 * claims, and hiding it here would let a suite silently stop mocking something
 * and start hitting a real module. What lives here is only the fixture DATA and
 * the `mockImplementation` wiring above it.
 *
 * ⚠ THE FIXTURE BASES ARE ALL `visibility:"private"` AND OWNED BY SOMEBODY ELSE,
 * which is the property both suites rest on: `service-shared.ts › canSeeBase`
 * would refuse every one of them to these callers, so any 200 in either file is
 * the GRANT ROW talking and nothing else.
 */

// ─── ids ────────────────────────────────────────────────────────────
export const WS = "11111111-1111-4111-8111-111111111111";
export const OTHER_WS = "1e1e1e1e-1111-4111-8111-111111111111";
export const CHANNEL = "22222222-2222-4222-8222-222222222222";
export const GUEST = "33333333-3333-4333-8333-333333333333";
export const VIEWER = "44444444-4444-4444-8444-444444444444";

export const KB_READ = "aaaaaaaa-0000-4000-8000-000000000001"; // visible, guest_write false
export const KB_WRITE = "aaaaaaaa-0000-4000-8000-000000000002"; // visible, guest_write true
export const KB_AGENT = "aaaaaaaa-0000-4000-8000-000000000003"; // agent_only
export const KB_NONE = "aaaaaaaa-0000-4000-8000-000000000004"; // no grant row at all
export const KB_DEAD = "aaaaaaaa-0000-4000-8000-000000000005"; // visible grant, base deleted

export const E_READ = "bbbbbbbb-0000-4000-8000-000000000001"; // in KB_READ
export const E_WRITE = "bbbbbbbb-0000-4000-8000-000000000002"; // in KB_WRITE
export const E_NONE = "bbbbbbbb-0000-4000-8000-000000000003"; // in KB_NONE
export const E_FOREIGN = "bbbbbbbb-0000-4000-8000-000000000004"; // another workspace

/** What the mocked `withWorkspaceAuth` injects. Mutable: each test sets the role
 *  it attacks with. ⚠ Read through a DYNAMIC import inside the wrapper mock, so
 *  `vi.mock`'s hoisting cannot observe it in its temporal dead zone. */
export const authState: { current: WorkspaceAuthContext } = {
  current: makeAuth("guest"),
};

export function makeAuth(role: Role, userId = GUEST): WorkspaceAuthContext {
  return {
    userId,
    workspaceId: WS,
    workspaceSlug: "container",
    workspacePublicId: "pub-container",
    role,
    apiKeyWorkspaceId: null,
  };
}

// ─── fixtures ───────────────────────────────────────────────────────

function base(id: string, name: string, deleted = false, workspaceId = WS): KnowledgeBase {
  return {
    id,
    workspaceId,
    name,
    slug: name,
    publicId: `pub-${name}`,
    description: null,
    // ⚠ FALSE on every fixture. The lane's PUT must not consult it, and the
    // agent refusal is what makes that safe — see `assertGrantWritable`.
    agentWriteEnabled: false,
    visibility: "private",
    accessMode: "workspace",
    createdBy: "operator",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    deletedAt: deleted ? "2026-08-02T00:00:00Z" : null,
  };
}

export const BASES: Record<string, KnowledgeBase> = {
  [KB_READ]: base(KB_READ, "read-only-kb"),
  [KB_WRITE]: base(KB_WRITE, "writable-kb"),
  [KB_AGENT]: base(KB_AGENT, "agent-only-kb"),
  [KB_NONE]: base(KB_NONE, "ungranted-kb"),
  [KB_DEAD]: base(KB_DEAD, "deleted-kb", true),
};

function entry(id: string, baseId: string, workspaceId = WS): KnowledgeEntry {
  return {
    id,
    workspaceId,
    knowledgeBaseId: baseId,
    folderId: null,
    title: "A page",
    excerpt: null,
    body: "before",
    entryType: "note",
    position: 0,
    createdBy: "operator",
    lastEditedBy: "operator",
    lastEditedSource: "user",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    deletedAt: null,
  };
}

export const ENTRIES: Record<string, KnowledgeEntry> = {
  [E_READ]: entry(E_READ, KB_READ),
  [E_WRITE]: entry(E_WRITE, KB_WRITE),
  [E_NONE]: entry(E_NONE, KB_NONE),
  [E_FOREIGN]: entry(E_FOREIGN, "aaaaaaaa-0000-4000-8000-00000000000f", OTHER_WS),
};

function grantRow(
  baseId: string,
  level: "agent_only" | "visible",
  guestWrite: boolean
): ChannelResourceGrantRow {
  return {
    channel_id: CHANNEL,
    resource_type: "knowledge_base",
    resource_id: baseId,
    workspace_id: WS,
    level,
    guest_write: guestWrite,
    created_by: "operator",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
  };
}

/** The grant TABLE, as the operator set it. `KB_NONE` is ABSENT — absence is the
 *  third state, never a stored `'none'`. */
export const GRANTS: ChannelResourceGrantRow[] = [
  grantRow(KB_READ, "visible", false),
  grantRow(KB_WRITE, "visible", true),
  grantRow(KB_AGENT, "agent_only", false),
  grantRow(KB_DEAD, "visible", false),
];

export function channelRow(visibility: "public" | "private"): ChannelRow {
  return {
    id: CHANNEL,
    workspace_id: WS,
    visibility,
    deleted_at: null,
  } as ChannelRow;
}

export function membershipRow(): ChannelMemberRow {
  return {
    channel_id: CHANNEL,
    user_id: GUEST,
    workspace_id: WS,
    role: "member",
  } as ChannelMemberRow;
}

// ─── request builders ───────────────────────────────────────────────

const URL_BASE = `http://localhost/api/channels/${CHANNEL}/knowledge`;

export const basesReq = () =>
  [
    new NextRequest(`${URL_BASE}/bases`),
    { params: Promise.resolve({ channelId: CHANNEL }) },
  ] as const;

export const treeReq = (baseId: string) =>
  [
    new NextRequest(`${URL_BASE}/bases/${baseId}/tree`),
    { params: Promise.resolve({ channelId: CHANNEL, baseId }) },
  ] as const;

export const entryReq = (entryId: string) =>
  [
    new NextRequest(`${URL_BASE}/entries/${entryId}`),
    { params: Promise.resolve({ channelId: CHANNEL, entryId }) },
  ] as const;

export const entryPutReq = (entryId: string, body: unknown) =>
  [
    new NextRequest(`${URL_BASE}/entries/${entryId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ channelId: CHANNEL, entryId }) },
  ] as const;

// ─── mock wiring ────────────────────────────────────────────────────

/**
 * Default world: a PRIVATE channel the caller IS a member of, the grant table
 * above, and repository reads served from the fixtures. Individual tests narrow.
 *
 * ⚠ The grant repo is driven through the SERVICE's own arguments (workspace,
 * channel, level) rather than returning a canned array, so a service that stops
 * passing one of them fails here rather than passing on a mock's indifference.
 */
export function wireLaneMocks(): void {
  authState.current = makeAuth("guest");

  vi.mocked(channelRepo.findChannelById).mockResolvedValue(channelRow("private"));
  vi.mocked(channelRepo.findMembership).mockResolvedValue(membershipRow());

  vi.mocked(grantRepo.listChannelGrantsAtLevel).mockImplementation(
    async (_db, workspaceId, channelId, level) =>
      GRANTS.filter(
        (g) =>
          g.workspace_id === workspaceId &&
          g.channel_id === channelId &&
          g.level === level
      )
  );
  vi.mocked(grantRepo.findChannelKnowledgeGrant).mockImplementation(
    async (_db, workspaceId, channelId, baseId) =>
      GRANTS.find(
        (g) =>
          g.workspace_id === workspaceId &&
          g.channel_id === channelId &&
          g.resource_id === baseId
      ) ?? null
  );

  vi.mocked(kbRepo.findBaseById).mockImplementation(
    async (id, includeDeleted = false) => {
      const b = BASES[id];
      if (!b) return null;
      if (!includeDeleted && b.deletedAt !== null) return null;
      return b;
    }
  );
  vi.mocked(kbRepo.listBasesByIds).mockImplementation(async (workspaceId, ids) =>
    ids.flatMap((id) => {
      const b = BASES[id];
      return b && b.workspaceId === workspaceId ? [b] : [];
    })
  );
  vi.mocked(kbRepo.listFoldersForBase).mockResolvedValue([]);
  vi.mocked(kbRepo.listEntriesForBase).mockResolvedValue([]);
  vi.mocked(kbRepo.findEntryById).mockImplementation(
    async (id) => ENTRIES[id] ?? null
  );
  // `null` = the storage meter is unreadable, so the plan gate fails OPEN (its
  // documented posture). Nothing in either suite is about the cap.
  vi.mocked(kbRepo.getBaseStorageBytes).mockResolvedValue(null);
  vi.mocked(kbRepo.updateEntryRow).mockImplementation(
    (async (id: string, patch: Record<string, unknown>) => ({
      ...ENTRIES[id]!,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      lastEditedBy: patch.lastEditedBy,
      lastEditedSource: patch.lastEditedSource,
      updatedAt: "2026-08-26T00:00:00Z",
    })) as unknown as typeof kbRepo.updateEntryRow
  );
}

// ─── response helpers ───────────────────────────────────────────────

export async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/**
 * The response body with the caller's own echoed id blanked, so two refusals can
 * be compared for "the same answer" without the INPUT distinguishing them. The
 * echoed id is the one thing two 404s are allowed to differ by; anything else
 * that differs is the oracle.
 */
export async function withoutId(res: Response, id: string): Promise<unknown> {
  return JSON.parse(JSON.stringify(await body(res)).split(id).join("<id>"));
}
