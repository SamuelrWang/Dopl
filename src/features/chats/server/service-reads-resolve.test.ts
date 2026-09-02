/**
 * 🔒 **`getChat` — A CHAT FOLLOWS ITS OWN ID (B2), AND THE RETENTION WINDOW
 * FOLLOWS IT TOO.**
 *
 * ⚠ **THE FENCE ITSELF IS NOT RE-TESTED HERE.** Shared credentials, the `viewer`
 * floor, the container lock and the two-arm `.or()` are asserted un-mocked in
 * `shared/tenancy/resolve-resource.test.ts`; the follow is asserted in
 * `shared/tenancy/read-resource.test.ts`. This file owns the one thing neither
 * can state: the window is a BILLING PLAN, so it belongs to the container the id
 * named and not to the caller's.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceEntitlements } from "@/features/billing/server/entitlements";

vi.mock("./repository");
vi.mock("@/features/billing/server/entitlements", () => ({
  getWorkspaceEntitlements: vi.fn(),
  FREE_CHATS_WINDOW_DAYS: 90,
}));
vi.mock("@/shared/tenancy/resolve-resource", () => ({
  resolveResource: vi.fn(async () => null),
}));

import type { ChatRowWithCount } from "./repository";
import * as repo from "./repository";
import * as tenancy from "@/shared/tenancy/resolve-resource";
import type { ResolvedResource } from "@/shared/tenancy/resolve-resource";
import { getWorkspaceEntitlements } from "@/features/billing/server/entitlements";
import { getChat, readChatDetail } from "./service-reads";
import { ChatNotFoundError } from "./errors";
import type { ChatContext } from "./service-shared";

const ME = "user-me";
const OTHER = "user-other";
const HERE = "ws-here";
const THERE = "ws-there";
const ID = "44444444-4444-4444-4444-444444444444";

const ctx: ChatContext = {
  workspaceId: HERE,
  userId: ME,
  source: "user",
  role: "member",
  apiKeyWorkspaceId: null,
  apiKeyWorkspaceLockKind: null,
};

function ent(chatsWindowDays: number | null): WorkspaceEntitlements {
  return {
    plan: chatsWindowDays === null ? "team" : "free",
    status: chatsWindowDays === null ? "active" : "free",
    memberCount: 1,
    seatCount: null,
    objectCap: null,
    objectsUsed: 0,
    canCreateObjects: true,
    chatsWindowDays,
  };
}

function row(over: Partial<ChatRowWithCount> = {}): ChatRowWithCount {
  return {
    id: ID,
    workspace_id: THERE,
    owner_id: ME,
    folder_id: null,
    client_session_id: null,
    title: "Tuesday session",
    overview: "",
    source: "claude-code",
    project: null,
    format: "summarized",
    session_date: "2026-07-10",
    visibility: "private",
    access_mode: "workspace",
    pinned: false,
    deliverables: [],
    learnings: [],
    exported_at: "2026-07-10T00:00:00Z",
    created_at: "2026-07-10T00:00:00Z",
    updated_at: "2026-07-10T00:00:00Z",
    deleted_at: null,
    chat_messages: [{ count: 3 }],
    ...over,
  };
}

/** A by-id read that answers in `THERE` and nowhere else. ⚠ `findChatById` IS
 *  WORKSPACE-KEYED, so the first load must miss or there is nothing to follow. */
function livesInThere(over: Partial<ChatRowWithCount> = {}) {
  vi.mocked(repo.findChatById).mockImplementation(async (workspaceId) =>
    workspaceId === THERE ? row(over) : null
  );
}

function resolvedIn(containerId: string): ResolvedResource {
  return {
    type: "chat",
    id: ID,
    name: "Tuesday session",
    containerId,
    containerName: "Acme",
    containerKind: "standard",
    homeScoped: false,
    containerRole: "admin",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tenancy.resolveResource).mockResolvedValue(null);
  vi.mocked(getWorkspaceEntitlements).mockResolvedValue(ent(null));
  vi.mocked(repo.listMessages).mockResolvedValue([]);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repo.countOf).mockReturnValue(3);
});

describe("🔒 the id names its own container", () => {
  it("reads the caller's own chat out of ANOTHER container of theirs", async () => {
    livesInThere();
    vi.mocked(tenancy.resolveResource).mockResolvedValue(resolvedIn(THERE));
    await expect(getChat(ctx, ID)).resolves.toMatchObject({ id: ID });
  });

  it("🔒 measures the window against THAT container's plan, not the caller's", async () => {
    // 🔒 MUTATION CHECK, and the reason the two reads are no longer parallel.
    // The window is a BILLING PLAN. Asking the CALLER's container would let a
    // free container's old chat through on a paid caller's window — and hide a
    // paid container's chat from a caller sitting in a free one.
    livesInThere();
    vi.mocked(tenancy.resolveResource).mockResolvedValue(resolvedIn(THERE));
    await getChat(ctx, ID);
    expect(getWorkspaceEntitlements).toHaveBeenCalledWith(THERE);
    expect(getWorkspaceEntitlements).not.toHaveBeenCalledWith(HERE);
  });

  it("🔒 RESOLUTION IS NOT AUTHORISATION — the matrix still refuses", async () => {
    livesInThere({ owner_id: OTHER });
    vi.mocked(tenancy.resolveResource).mockResolvedValue(resolvedIn(THERE));
    await expect(getChat(ctx, ID)).rejects.toBeInstanceOf(ChatNotFoundError);
  });

  it("404s an id that is nameable nowhere", async () => {
    vi.mocked(repo.findChatById).mockResolvedValue(null);
    await expect(getChat(ctx, ID)).rejects.toBeInstanceOf(ChatNotFoundError);
  });
});

describe("🔒 the WRITE echo did not move", () => {
  it("readChatDetail still refuses a chat outside this container", async () => {
    // ⚠ MUTATION CHECK: every mutation in `service-writes.ts` returns through
    // it, so the tenancy it reads in must stay the one the write landed in.
    livesInThere();
    vi.mocked(tenancy.resolveResource).mockResolvedValue(resolvedIn(THERE));
    await expect(readChatDetail(ctx, ID)).rejects.toBeInstanceOf(
      ChatNotFoundError
    );
    expect(tenancy.resolveResource).not.toHaveBeenCalled();
  });
});
