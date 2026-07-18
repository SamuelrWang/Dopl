/**
 * Unit tests for the chats write service. Repository + retention window are
 * mocked (no Supabase). Focus: the append echo must not become a retention
 * bypass — appending to a chat outside the free-plan window returns the
 * detail with the transcript withheld (messages: []) while keeping the
 * append itself allowed and `messageCount` honest. Pro / in-window appends
 * echo the full transcript as before.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatMessageRow } from "./dto";

vi.mock("./repository");
vi.mock("./retention", () => ({ resolveChatsWindow: vi.fn() }));

import * as repo from "./repository";
import type { ChatRowWithCount } from "./repository";
import { resolveChatsWindow } from "./retention";
import { appendMessages, purgeChat } from "./service-writes";
import { ChatForbiddenError, ChatNotFoundError } from "./errors";
import type { ChatContext } from "./service-shared";

const WS = "ws-1";
const USER = "user-1";

const ctx: ChatContext = {
  workspaceId: WS,
  userId: USER,
  source: "agent",
  role: "member",
  apiKeyWorkspaceId: null,
};

function chatRow(overrides: Partial<ChatRowWithCount> = {}): ChatRowWithCount {
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
    chat_messages: [{ count: 5 }],
    ...overrides,
  } as ChatRowWithCount;
}

function messageRows(n: number): ChatMessageRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `m-${i}`,
    chat_id: "chat-1",
    workspace_id: WS,
    position: i + 1,
    role: "user",
    summary: `msg ${i}`,
    verbatim: null,
    created_at: "2026-07-10T00:00:00Z",
  })) as ChatMessageRow[];
}

const mockWindow = vi.mocked(resolveChatsWindow);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.appendMessagesTx).mockResolvedValue(5);
  vi.mocked(repo.listMessages).mockResolvedValue(messageRows(5));
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
});

const APPEND = { messages: [{ role: "user" as const, summary: "hi" }] };

describe("appendMessages — retention echo", () => {
  it("withholds the transcript when the chat is outside the free window", async () => {
    vi.mocked(repo.findChatById).mockResolvedValue(
      chatRow({ session_date: "2026-01-01" })
    );
    mockWindow.mockResolvedValue({ windowDays: 90, since: "2026-04-17" });

    const detail = await appendMessages(ctx, "chat-1", APPEND);

    // The append still ran.
    expect(repo.appendMessagesTx).toHaveBeenCalled();
    // Transcript withheld, but the count stays honest.
    expect(detail.messages).toEqual([]);
    expect(detail.messageCount).toBe(5);
  });

  it("echoes the full transcript when the chat is inside the window", async () => {
    vi.mocked(repo.findChatById).mockResolvedValue(
      chatRow({ session_date: "2026-07-10" })
    );
    mockWindow.mockResolvedValue({ windowDays: 90, since: "2026-04-17" });

    const detail = await appendMessages(ctx, "chat-1", APPEND);

    expect(detail.messages).toHaveLength(5);
    expect(detail.messageCount).toBe(5);
  });

  it("echoes the full transcript on Pro (unbounded window)", async () => {
    vi.mocked(repo.findChatById).mockResolvedValue(
      chatRow({ session_date: "2020-01-01" })
    );
    mockWindow.mockResolvedValue({ windowDays: null, since: null });

    const detail = await appendMessages(ctx, "chat-1", APPEND);

    expect(detail.messages).toHaveLength(5);
  });
});

describe("purgeChat — invariants", () => {
  beforeEach(() => {
    vi.mocked(repo.hardDeleteChat).mockResolvedValue(undefined);
  });

  it("refuses when the chat is not in trash (live/absent → not found, no delete)", async () => {
    // findDeletedChatById resolves ONLY `deleted_at IS NOT NULL` rows and is
    // workspace-scoped, so a live row, an unknown id, or a cross-workspace id
    // all come back null — this one lookup covers the live-row + cross-ws
    // refusals at once.
    vi.mocked(repo.findDeletedChatById).mockResolvedValue(null);

    await expect(purgeChat(ctx, "chat-1")).rejects.toBeInstanceOf(
      ChatNotFoundError
    );
    expect(repo.hardDeleteChat).not.toHaveBeenCalled();
  });

  it("refuses a non-owner", async () => {
    // The row is in trash (findDeletedChatById returns it) but owned by
    // someone else — owner-only, like restore.
    vi.mocked(repo.findDeletedChatById).mockResolvedValue(
      chatRow({ owner_id: "someone-else" })
    );

    await expect(purgeChat(ctx, "chat-1")).rejects.toBeInstanceOf(
      ChatForbiddenError
    );
    expect(repo.hardDeleteChat).not.toHaveBeenCalled();
  });

  it("refuses a workspace-scoped API-key caller even when they own it", async () => {
    const apiKeyCtx: ChatContext = { ...ctx, apiKeyWorkspaceId: WS };
    vi.mocked(repo.findDeletedChatById).mockResolvedValue(chatRow());

    await expect(purgeChat(apiKeyCtx, "chat-1")).rejects.toBeInstanceOf(
      ChatForbiddenError
    );
    expect(repo.hardDeleteChat).not.toHaveBeenCalled();
  });

  it("hard-deletes a trashed chat owned by the caller", async () => {
    vi.mocked(repo.findDeletedChatById).mockResolvedValue(chatRow());

    await purgeChat(ctx, "chat-1");

    expect(repo.hardDeleteChat).toHaveBeenCalledWith(WS, "chat-1");
  });
});
