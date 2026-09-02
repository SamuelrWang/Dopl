/**
 * Chats write service, repository + retention window mocked.
 * ⚠ Focus: the append echo must not become a retention bypass — an append to
 * an out-of-window chat returns the detail with `messages: []` while the
 * append itself is allowed and `messageCount` stays honest.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatMessageRow } from "./dto";

vi.mock("./repository");
vi.mock("./retention", () => ({ resolveChatsWindow: vi.fn() }));

import * as repo from "./repository";
import type { ChatRowWithCount } from "./repository";
import { resolveChatsWindow } from "./retention";
import { appendMessages, deleteChat } from "./service-writes";
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
  credentialSubjectUserId: USER,
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

    expect(repo.appendMessagesTx).toHaveBeenCalled();
    // Transcript withheld, count stays honest.
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

describe("deleteChat — permanent delete invariants", () => {
  // ⚠ Delete is PERMANENT: no trash, no restore, no purge. `deleteChat`
  // resolves a LIVE chat via `requireOwnChat` and hard-deletes in one step.
  beforeEach(() => {
    vi.mocked(repo.hardDeleteChat).mockResolvedValue(undefined);
  });

  it("refuses an unknown or cross-workspace chat (not found, no delete)", async () => {
    // findChatById is workspace-scoped, so unknown and cross-workspace ids
    // both come back null — one lookup covers both refusals.
    vi.mocked(repo.findChatById).mockResolvedValue(null);

    await expect(deleteChat(ctx, "chat-1")).rejects.toBeInstanceOf(
      ChatNotFoundError
    );
    expect(repo.hardDeleteChat).not.toHaveBeenCalled();
  });

  it("refuses a non-owner", async () => {
    vi.mocked(repo.findChatById).mockResolvedValue(
      chatRow({ owner_id: "someone-else", visibility: "public" })
    );

    await expect(deleteChat(ctx, "chat-1")).rejects.toBeInstanceOf(
      ChatForbiddenError
    );
    expect(repo.hardDeleteChat).not.toHaveBeenCalled();
  });

  it("refuses a workspace-scoped API-key caller even when they own it", async () => {
    // ⚠ Chat is PUBLIC/workspace so `canSeeChat` lets the key past the
    // visibility gate: the refusal must come from the ownership branch's
    // `ctx.apiKeyWorkspaceId` clause. A private chat 404s a step earlier and
    // would test the wrong gate.
    const apiKeyCtx: ChatContext = {
      ...ctx,
      apiKeyWorkspaceId: WS,
      credentialSubjectUserId: null,
    };
    vi.mocked(repo.findChatById).mockResolvedValue(
      chatRow({ visibility: "public" })
    );

    await expect(deleteChat(apiKeyCtx, "chat-1")).rejects.toBeInstanceOf(
      ChatForbiddenError
    );
    expect(repo.hardDeleteChat).not.toHaveBeenCalled();
  });

  it("HARD-deletes the caller's own chat — no tombstone write", async () => {
    vi.mocked(repo.findChatById).mockResolvedValue(chatRow());

    await deleteChat(ctx, "chat-1");

    expect(repo.hardDeleteChat).toHaveBeenCalledWith(WS, "chat-1");
    // ⚠ Nothing may stamp `deleted_at` any more.
    expect(repo).not.toHaveProperty("softDeleteChat");
  });
});
