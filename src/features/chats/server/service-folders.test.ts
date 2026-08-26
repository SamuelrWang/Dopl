/**
 * Folder re-scoping: write shape + authorization gate.
 * ⚠ A folder's grant set propagates to every filed chat. Per-chat
 * delete+insert is 2N serial round-trips on one click, unbounded in N (a
 * 200-chat folder timed the gateway out). These pin the collapsed form — one
 * set-delete, one array upsert — so the loop can't come back.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("@/features/teams/server/repository");

import * as repo from "./repository";
import {
  deleteGrantsForResource,
  deleteGrantsForResources,
  insertReadGrantsForResources,
  insertReadGrantsIfMissing,
  listGrantsForResources,
  listTeamIdsForUser,
} from "@/features/teams/server/repository";
import type { ChatFolderRow } from "./dto";
import type { ChatContext } from "./service-shared";
import { ChatForbiddenError, ChatFolderNotFoundError } from "./errors";
import { updateFolderForUser } from "./service-folders";

const WS = "ws-1";
const USER = "user-1";
const FOLDER = "folder-1";

function ctx(role: ChatContext["role"] = "member"): ChatContext {
  return {
    workspaceId: WS,
    userId: USER,
    source: "user",
    role,
    apiKeyWorkspaceId: null,
    apiKeyWorkspaceLockKind: null,
  };
}

function folderRow(over: Partial<ChatFolderRow> = {}): ChatFolderRow {
  return {
    id: FOLDER,
    workspace_id: WS,
    user_id: USER,
    name: "Client work",
    visibility: "private",
    access_mode: "workspace",
    ...over,
  } as ChatFolderRow;
}

/** N chats filed in the folder — the blast radius. */
function chatIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `chat-${i}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findFolderById).mockResolvedValue(folderRow());
  vi.mocked(repo.updateFolder).mockResolvedValue(
    folderRow({ visibility: "public", access_mode: "teams" })
  );
  vi.mocked(repo.listChatIdsInFolder).mockResolvedValue(chatIds(200));
  vi.mocked(repo.updateChatsScopeInFolder).mockResolvedValue(undefined);
  vi.mocked(listGrantsForResources).mockResolvedValue([]);
  vi.mocked(listTeamIdsForUser).mockResolvedValue(["team-a", "team-b"]);
  vi.mocked(deleteGrantsForResource).mockResolvedValue(undefined);
  vi.mocked(deleteGrantsForResources).mockResolvedValue(undefined);
  vi.mocked(insertReadGrantsIfMissing).mockResolvedValue(undefined);
  vi.mocked(insertReadGrantsForResources).mockResolvedValue(undefined);
});

describe("updateFolderForUser — grant propagation is set-at-a-time", () => {
  it("replaces 200 chats' grants without a per-chat round-trip", async () => {
    const ids = chatIds(200);

    await updateFolderForUser(ctx("admin"), FOLDER, {
      visibility: "public",
      accessMode: "teams",
      teamIds: ["team-a"],
    });

    expect(deleteGrantsForResources).toHaveBeenCalledWith(WS, "chat", ids);
    expect(insertReadGrantsForResources).toHaveBeenCalledWith(WS, "chat", ids, [
      "team-a",
    ]);
    // ONE call each, not N. Single-resource helpers are used only for the
    // folder's own grant row.
    expect(deleteGrantsForResources).toHaveBeenCalledTimes(1);
    expect(insertReadGrantsForResources).toHaveBeenCalledTimes(1);
    expect(deleteGrantsForResource).toHaveBeenCalledTimes(1);
    expect(deleteGrantsForResource).toHaveBeenCalledWith(WS, "chat_folder", FOLDER);
    expect(insertReadGrantsIfMissing).toHaveBeenCalledTimes(1);
    expect(insertReadGrantsIfMissing).toHaveBeenCalledWith(
      WS,
      "chat_folder",
      FOLDER,
      ["team-a"]
    );
  });

  it("clears every chat's grants when the folder leaves team scope", async () => {
    vi.mocked(repo.updateFolder).mockResolvedValue(
      folderRow({ visibility: "public", access_mode: "workspace" })
    );

    await updateFolderForUser(ctx("admin"), FOLDER, {
      visibility: "public",
      accessMode: "workspace",
    });

    expect(deleteGrantsForResources).toHaveBeenCalledWith(WS, "chat", chatIds(200));
    // No grant set to write — the delete stands alone.
    expect(insertReadGrantsForResources).not.toHaveBeenCalled();
  });

  it("touches no grant at all when the patch doesn't change scope", async () => {
    await updateFolderForUser(ctx("admin"), FOLDER, { name: "Renamed" });

    expect(repo.listChatIdsInFolder).not.toHaveBeenCalled();
    expect(deleteGrantsForResources).not.toHaveBeenCalled();
    expect(insertReadGrantsForResources).not.toHaveBeenCalled();
  });

  it("still issues the delete for an empty folder (no-op, one call)", async () => {
    vi.mocked(repo.listChatIdsInFolder).mockResolvedValue([]);

    await updateFolderForUser(ctx("admin"), FOLDER, {
      visibility: "public",
      accessMode: "teams",
      teamIds: ["team-a"],
    });

    expect(deleteGrantsForResources).toHaveBeenCalledWith(WS, "chat", []);
    expect(insertReadGrantsForResources).toHaveBeenCalledWith(WS, "chat", [], [
      "team-a",
    ]);
  });
});

describe("updateFolderForUser — authorization is unchanged by the batching", () => {
  it("refuses a non-admin granting a team they don't belong to", async () => {
    await expect(
      updateFolderForUser(ctx("member"), FOLDER, {
        visibility: "public",
        accessMode: "teams",
        teamIds: ["team-z"],
      })
    ).rejects.toBeInstanceOf(ChatForbiddenError);

    // ⚠ Refusal happens BEFORE any write.
    expect(repo.updateFolder).not.toHaveBeenCalled();
    expect(deleteGrantsForResources).not.toHaveBeenCalled();
  });

  it("lets a non-admin keep a team that is already granted", async () => {
    vi.mocked(listTeamIdsForUser).mockResolvedValue([]);
    vi.mocked(listGrantsForResources).mockResolvedValue([
      { teamId: "team-z", resourceId: FOLDER },
    ] as never);

    await updateFolderForUser(ctx("member"), FOLDER, {
      visibility: "public",
      accessMode: "teams",
      teamIds: ["team-z"],
    });

    expect(insertReadGrantsForResources).toHaveBeenCalledWith(
      WS,
      "chat",
      chatIds(200),
      ["team-z"]
    );
  });

  it("404s an unknown folder before any grant work", async () => {
    vi.mocked(repo.findFolderById).mockResolvedValue(null);

    await expect(
      updateFolderForUser(ctx("admin"), FOLDER, { visibility: "public" })
    ).rejects.toBeInstanceOf(ChatFolderNotFoundError);
    expect(deleteGrantsForResources).not.toHaveBeenCalled();
  });
});
