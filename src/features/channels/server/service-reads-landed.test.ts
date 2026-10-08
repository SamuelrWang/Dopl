/**
 * `ownMessageLanded` — the composer's check on a send a reload interrupted (2026-10-08): only the
 * CALLER's own row counts, and only after the full read check on the channel.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-collab");
vi.mock("./repository-tasks");
vi.mock("./repository-artifacts");
vi.mock("@/features/workspaces/server/repository");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import { ownMessageLanded } from "./service-reads";
import { ChannelNotFoundError } from "./errors";
import type { ChannelContext } from "./service-shared";
import type { ChannelMemberRow, ChannelMessageRow, ChannelRow } from "./dto";

const WS = "ws-1";
const USER = "user-1";
const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  credentialSubjectUserId: USER,
  source: "user",
  role: "member",
};

const channel: ChannelRow = {
  id: "chan-1",
  workspace_id: WS,
  created_by: USER,
  slug: "general",
  name: "General",
  topic: "",
  visibility: "private",
  is_direct: false,
  direct_key: null,
  archived_at: null,
  deleted_at: null,
  created_at: "2026-07-20T00:00:00Z",
  updated_at: "2026-07-20T00:00:00Z",
};

const membership: ChannelMemberRow = {
  channel_id: "chan-1",
  user_id: USER,
  workspace_id: WS,
  role: "member",
  last_read_at: null,
  notify_scope: "all",
  agent_tool_profile: "full",
  favorited_at: null,
  added_by: USER,
  joined_at: "2026-07-20T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channel);
  vi.mocked(repo.findMembership).mockResolvedValue(membership);
});

describe("ownMessageLanded", () => {
  it("is true when MY row with that key is stored, and asks by author", async () => {
    vi.mocked(repoMessages.findOwnMessageByClientId).mockResolvedValue({ id: "m" } as ChannelMessageRow);
    await expect(ownMessageLanded(ctx, "general", "cm-1")).resolves.toBe(true);
    expect(repoMessages.findOwnMessageByClientId).toHaveBeenCalledWith("chan-1", USER, "cm-1");
  });

  it("is false when no such row of mine exists", async () => {
    vi.mocked(repoMessages.findOwnMessageByClientId).mockResolvedValue(null);
    await expect(ownMessageLanded(ctx, "general", "cm-1")).resolves.toBe(false);
  });

  it("refuses a private channel I cannot read, before looking anything up", async () => {
    vi.mocked(repo.findMembership).mockResolvedValue(null);
    await expect(ownMessageLanded(ctx, "general", "cm-1")).rejects.toBeInstanceOf(ChannelNotFoundError);
    expect(repoMessages.findOwnMessageByClientId).not.toHaveBeenCalled();
  });
});
