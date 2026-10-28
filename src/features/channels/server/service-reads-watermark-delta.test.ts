/**
 * **THE READ WATERMARK AND THE FORWARD `since` READ** (2026-10-11).
 *
 * The switch-in delta (option A, `lib/transcript-delta.ts`) sends a forward
 * `since=` read, and that read satisfied the watermark condition: no thread, no
 * `before`, rows returned. So every switch-back that merged even ONE row wrote
 * `channel_members.last_read_at` — a PUBLISHED realtime table, i.e. a doorbell
 * every subscribed tab answers with `refetchAll` → `refetchMessages()` → the
 * full line-budgeted page read option A exists to avoid. The delta traded one
 * full read for one full read, and the trailing refetch can also walk `page.min`
 * forward and trip `isContiguous`, dropping the scrollback the reader had loaded.
 *
 * ⚠ **ITS OWN FILE**: `service-reads.test.ts` is at the 500-line cap (INVARIANTS
 * §1) and its watermark block is about the F-072 LOOP GUARD — content-derived and
 * monotonic — while this one is about WHICH READS ARE A HUMAN VIEWING THE
 * CHANNEL. Same mocks, by the same `vi.mock` list.
 *
 * ⚠ **AND IT PINS BOTH DIRECTIONS.** Skipping the bump for a `since` read is
 * worth nothing if the ordinary page read stops writing it too — that one IS the
 * reader opening the channel.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-collab");
vi.mock("./repository-threads");
vi.mock("@/features/workspaces/server/repository");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as collab from "./repository-collab";
import * as workspaceRepo from "@/features/workspaces/server/repository";
import { readMessages } from "./service-reads";
import type { ChannelContext } from "./service-shared";
import type { ChannelMemberRow, ChannelMessageRow, ChannelRow } from "./dto";

const WS = "ws-1";
const USER = "user-1";
const OTHER = "user-2";
const CHANNEL = "chan-1";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  credentialSubjectUserId: USER,
  source: "user",
  role: "member",
};

function channelRow(): ChannelRow {
  return {
    id: CHANNEL,
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
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  };
}

function memberRow(): ChannelMemberRow {
  return {
    channel_id: CHANNEL,
    user_id: USER,
    workspace_id: WS,
    role: "owner",
    // Behind the rows below, so the monotonic guard would let the write through.
    last_read_at: "2026-10-10T12:00:00.000Z",
    notify_scope: "none",
    agent_tool_profile: "full",
    favorited_at: null,
    added_by: USER,
    joined_at: "2026-10-01T00:00:00Z",
  };
}

/** A peer's message, newer than the watermark — the row a delta brings back. */
function messageRow(seq: number): ChannelMessageRow {
  return {
    id: `msg-${seq}`,
    seq,
    channel_id: CHANNEL,
    workspace_id: WS,
    author_user_id: OTHER,
    author_kind: "user",
    kind: "message",
    body: "hi",
    metadata: {},
    client_msg_id: null,
    created_at: "2026-10-10T13:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockResolvedValue(memberRow());
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(collab.presenceForWorkspace).mockResolvedValue(new Map());
  vi.mocked(workspaceRepo.listMemberRolesByUserIds).mockResolvedValue(new Map());
  vi.mocked(repoMessages.listMessages).mockResolvedValue([messageRow(51)]);
});

describe("readMessages — a forward `since` read is not a view", () => {
  // ⚠ THIS CASE PINS A KNOWN SHORTFALL, ON PURPOSE, AND IT IS THE INTERESTING ONE.
  //
  // A `since`-only delta DOES still move the watermark, which rings the reader's own realtime
  // doorbell and pulls a full line-budgeted page read behind the delta that was sent to avoid
  // one. So option A's net is one fewer full read on a switch-back, not none. Gating the write
  // on `query.since === undefined` closes that — and was written, measured and then REVERTED,
  // because `repository-members.ts › updateLastRead` is reached from `service-reads.ts` and
  // NOWHERE ELSE in the tree: gating it means a warm switch-back never clears the sidebar's
  // unread mark until the next full read. A visibly wrong unread count is worse than an extra
  // read, so the shortfall stays and the badge keeps working.
  //
  // The fix that gets both is client-side — let this write stand and have the subscriber ignore
  // the watermark event it caused itself. When that lands, this case INVERTS to
  // `not.toHaveBeenCalled()` and the comment above it should go with it.
  it("still moves the watermark on a `since`-only read — the shortfall, kept deliberately", async () => {
    const messages = await readMessages(ctx, "general", { limit: 60, since: 50 });

    expect(messages).toHaveLength(1);
    expect(repo.updateLastRead).toHaveBeenCalledTimes(1);
  });

  it("still advances it on the ORDINARY page read — the reader opening the channel", async () => {
    // ⚠ THE OTHER DIRECTION. Skipping the bump everywhere would leave the unread
    // badge lit forever, which is a different bug with the same shape.
    await readMessages(ctx, "general", { limit: 60 });

    expect(repo.updateLastRead).toHaveBeenCalledTimes(1);
    expect(repo.updateLastRead).toHaveBeenCalledWith(
      CHANNEL,
      USER,
      "2026-10-10T13:00:00.000Z"
    );
  });

  it("moves none on a `since` + `before` WINDOW either", async () => {
    await readMessages(ctx, "general", { limit: 60, since: 50, before: 99 });

    expect(repo.updateLastRead).not.toHaveBeenCalled();
  });
});
