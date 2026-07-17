/**
 * Unit tests for the chats read service under the retention window.
 * Repository + billing entitlements are mocked (no Supabase). Rules:
 *   - free plan  -> list is queried with the DB cutoff; hiddenCount surfaced
 *   - pro plan   -> no window filter, hiddenCount 0, no cutoff/count queries
 *   - getChat boundary: older-than-cutoff hidden (typed denial), on/after
 *     the cutoff visible; pro loads anything
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceEntitlements } from "@/features/billing/server/entitlements";

vi.mock("./repository");
vi.mock("@/features/billing/server/entitlements", () => ({
  getWorkspaceEntitlements: vi.fn(),
  FREE_CHATS_WINDOW_DAYS: 90,
}));

import type { ChatRowWithCount } from "./repository";
import * as repo from "./repository";
import { getWorkspaceEntitlements } from "@/features/billing/server/entitlements";
import { listChats, getChat } from "./service-reads";
import { ChatOutsideRetentionError } from "./errors";
import type { ChatContext } from "./service-shared";

const WS = "ws-1";
const USER = "user-1";

const ctx: ChatContext = {
  workspaceId: WS,
  userId: USER,
  source: "user",
  role: "member",
  apiKeyWorkspaceId: null,
};

const mockEnt = vi.mocked(getWorkspaceEntitlements);

function ent(chatsWindowDays: number | null): WorkspaceEntitlements {
  return {
    plan: chatsWindowDays === null ? "pro" : "free",
    status: chatsWindowDays === null ? "active" : "free",
    memberCount: 1,
    seatCount: null,
    objectCap: null,
    objectsUsed: 0,
    canCreateObjects: true,
    chatsWindowDays,
  };
}

function row(overrides: Partial<ChatRowWithCount> = {}): ChatRowWithCount {
  return {
    id: "chat-1",
    workspace_id: WS,
    owner_id: USER,
    folder_id: null,
    client_session_id: null,
    title: "Session",
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
    chat_messages: [{ count: 3 }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repo.countOf).mockImplementation((r) => r.chat_messages[0]?.count ?? 0);
  vi.mocked(repo.listMessages).mockResolvedValue([]);
});

describe("listChats — retention window", () => {
  it("free plan passes the DB cutoff to the query and surfaces hiddenCount", async () => {
    mockEnt.mockResolvedValue(ent(90));
    vi.mocked(repo.retentionCutoff).mockResolvedValue("2026-04-17");
    vi.mocked(repo.listVisibleChats).mockResolvedValue([row()]);
    vi.mocked(repo.countHiddenChats).mockResolvedValue(4);

    const result = await listChats(ctx);

    expect(repo.listVisibleChats).toHaveBeenCalledWith(WS, USER, "2026-04-17");
    expect(repo.countHiddenChats).toHaveBeenCalledWith(WS, USER, "2026-04-17");
    expect(result.hiddenCount).toBe(4);
    expect(result.chats).toHaveLength(1);
  });

  it("pro plan applies no window filter, hiddenCount 0, no extra queries", async () => {
    mockEnt.mockResolvedValue(ent(null));
    vi.mocked(repo.listVisibleChats).mockResolvedValue([
      row(),
      row({ id: "chat-2" }),
    ]);

    const result = await listChats(ctx);

    expect(repo.listVisibleChats).toHaveBeenCalledWith(WS, USER, null);
    expect(repo.retentionCutoff).not.toHaveBeenCalled();
    expect(repo.countHiddenChats).not.toHaveBeenCalled();
    expect(result.hiddenCount).toBe(0);
    expect(result.chats).toHaveLength(2);
  });
});

describe("getChat — retention boundary", () => {
  it("free plan hides a chat older than the cutoff (typed denial)", async () => {
    mockEnt.mockResolvedValue(ent(90));
    vi.mocked(repo.retentionCutoff).mockResolvedValue("2026-04-17");
    vi.mocked(repo.findChatById).mockResolvedValue(
      row({ session_date: "2026-01-01" })
    );

    await expect(getChat(ctx, "chat-1")).rejects.toBeInstanceOf(
      ChatOutsideRetentionError
    );
  });

  it("free plan keeps a chat exactly on the cutoff visible (>= boundary)", async () => {
    mockEnt.mockResolvedValue(ent(90));
    vi.mocked(repo.retentionCutoff).mockResolvedValue("2026-04-17");
    vi.mocked(repo.findChatById).mockResolvedValue(
      row({ session_date: "2026-04-17" })
    );

    const detail = await getChat(ctx, "chat-1");
    expect(detail.id).toBe("chat-1");
  });

  it("free plan keeps a chat newer than the cutoff visible", async () => {
    mockEnt.mockResolvedValue(ent(90));
    vi.mocked(repo.retentionCutoff).mockResolvedValue("2026-04-17");
    vi.mocked(repo.findChatById).mockResolvedValue(
      row({ session_date: "2026-07-10" })
    );

    const detail = await getChat(ctx, "chat-1");
    expect(detail.id).toBe("chat-1");
  });

  it("pro plan loads even an ancient chat — no cutoff query", async () => {
    mockEnt.mockResolvedValue(ent(null));
    vi.mocked(repo.findChatById).mockResolvedValue(
      row({ session_date: "2020-01-01" })
    );

    const detail = await getChat(ctx, "chat-1");
    expect(detail.id).toBe("chat-1");
    expect(repo.retentionCutoff).not.toHaveBeenCalled();
  });
});
