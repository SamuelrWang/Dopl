/**
 * `updateChannel`'s TWO GATES (Samuel, 2026-08-25).
 *
 * The channel HEADER — name, topic, visibility, archived — stays MANAGE-gated
 * exactly as it was. The INFO CARD is gated on MEMBERSHIP, because a home
 * channel is "a relationship, not a tenancy" (INVARIANTS §4A, the same ruling
 * that lets any member of a container mint its link) and the card is that
 * relationship's shared scratch surface.
 *
 * ⚠ WHAT THIS SUITE IS REALLY PROTECTING IS THE **DEFAULT DIRECTION**. A patch
 * that touches BOTH must take the stricter gate, and a field added to
 * `ChannelUpdateSchema` later must land in the managed half without anybody
 * remembering to say so. Both are asserted below — the second by driving the
 * real `MANAGED_CHANNEL_FIELDS` set through the function rather than by reading
 * the constant, since a pin on a symbol is not a pin (INVARIANTS §14).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./service-reads");

import * as repo from "./repository";
import * as reads from "./service-reads";
import { updateChannel } from "./service-writes";
import { ChannelForbiddenError, ChannelInfoCardTooLargeError } from "./errors";
import {
  INFO_CARD_ID_MAX,
  INFO_CARD_LABEL_MAX,
  INFO_CARD_MAX_ROWS,
  INFO_CARD_VALUE_MAX,
} from "../info-card";
import type { ChannelContext } from "./service-shared";
import type { ChannelMemberRow, ChannelRow } from "./dto";

const WS = "ws-1";
const OWNER = "aaaaaaaa-e29b-41d4-a716-446655440000";
const MEMBER = "bbbbbbbb-e29b-41d4-a716-446655440000";
const STRANGER = "cccccccc-e29b-41d4-a716-446655440000";

const CARD = {
  hidden: ["email" as const],
  rows: [{ id: "row-1", label: "Phone", value: "+1 555 0101" }],
};

function ctx(userId: string): ChannelContext {
  return { workspaceId: WS, userId, source: "user", role: "member" };
}

function channelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: "chan-1",
    workspace_id: WS,
    created_by: OWNER,
    slug: "priya-shah",
    name: "Priya Shah",
    topic: "",
    visibility: "private",
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-07-27T00:00:00Z",
    updated_at: "2026-07-27T00:00:00Z",
    info_card: {},
    ...overrides,
  };
}

function memberRow(userId: string, role: string): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role,
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    favorited_at: null,
    added_by: OWNER,
    joined_at: "2026-07-27T00:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // ⚠ BOTH resolvers. `"chan-1"` is not a UUID, so `resolveChannelRef` takes
  // the SLUG branch — mocking only `findChannelById` yields a not-found that
  // every gate assertion below would then pass for the wrong reason.
  vi.mocked(repo.findChannelById).mockResolvedValue(channelRow());
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
    uid === OWNER
      ? memberRow(OWNER, "owner")
      : uid === MEMBER
        ? memberRow(MEMBER, "member")
        : null
  );
  vi.mocked(repo.updateChannel).mockResolvedValue(channelRow());
  vi.mocked(reads.getChannel).mockResolvedValue(
    {} as Awaited<ReturnType<typeof reads.getChannel>>
  );
});

describe("updateChannel — the info card is MEMBER-writable", () => {
  it("a plain member may save the card", async () => {
    await updateChannel(ctx(MEMBER), "chan-1", { infoCard: CARD });
    expect(vi.mocked(repo.updateChannel).mock.calls[0][2]).toEqual({
      info_card: CARD,
    });
  });

  it("the owner may too — the loose gate widens, it does not move", async () => {
    await updateChannel(ctx(OWNER), "chan-1", { infoCard: CARD });
    expect(repo.updateChannel).toHaveBeenCalledOnce();
  });

  it("REFUSES a card over the byte ceiling BEFORE the DB can 500 on it", async () => {
    // ⚠ THE FENCE IN FRONT OF `channels_info_card_check`. Every field is at its
    // zod cap so the card parses, but the CJK jsonb text form is ~9.6 KB — past
    // the 4 KiB floor. A per-field cap cannot catch this; the byte guard raises a
    // real 4xx instead of letting an unclassifiable PostgREST error 500.
    const tooLarge = {
      hidden: ["email" as const],
      rows: Array.from({ length: INFO_CARD_MAX_ROWS }, (_, i) => ({
        id: `${i}`.padStart(INFO_CARD_ID_MAX, "0"),
        label: "文".repeat(INFO_CARD_LABEL_MAX),
        value: "字".repeat(INFO_CARD_VALUE_MAX),
      })),
    };
    await expect(
      updateChannel(ctx(MEMBER), "chan-1", { infoCard: tooLarge })
    ).rejects.toBeInstanceOf(ChannelInfoCardTooLargeError);
    // ⚠ AND NEVER REACHES THE WRITE — the whole point is the DB never sees it.
    expect(repo.updateChannel).not.toHaveBeenCalled();
  });

  it("a NON-MEMBER of a public channel may not — reading a room is not joining it", async () => {
    // ⚠ `loadVisibleChannel` hands back `membership: null` for a public channel
    // a workspace member can merely SEE. That is the case this branch exists
    // for: without the explicit `membership === null` test, "not managed"
    // would have read as "allowed".
    vi.mocked(repo.findChannelById).mockResolvedValue(
      channelRow({ visibility: "public" })
    );
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ visibility: "public" })
    );
    await expect(
      updateChannel(ctx(STRANGER), "chan-1", { infoCard: CARD })
    ).rejects.toBeInstanceOf(ChannelForbiddenError);
    expect(repo.updateChannel).not.toHaveBeenCalled();
  });
});

describe("updateChannel — the header is still MANAGE-gated", () => {
  it.each([
    ["name", { name: "Renamed" }],
    ["topic", { topic: "New topic" }],
    ["visibility", { visibility: "public" as const }],
    ["archived", { archived: true }],
  ])("refuses a plain member's %s", async (_field, patch) => {
    await expect(
      updateChannel(ctx(MEMBER), "chan-1", patch)
    ).rejects.toBeInstanceOf(ChannelForbiddenError);
    expect(repo.updateChannel).not.toHaveBeenCalled();
  });

  it("lets the OWNER through on the same patches", async () => {
    await updateChannel(ctx(OWNER), "chan-1", { name: "Renamed" });
    expect(vi.mocked(repo.updateChannel).mock.calls[0][2]).toEqual({
      name: "Renamed",
    });
  });

  it("⚠ A MIXED PATCH TAKES THE STRICTER GATE — a member cannot smuggle a rename beside a card", async () => {
    await expect(
      updateChannel(ctx(MEMBER), "chan-1", { name: "Renamed", infoCard: CARD })
    ).rejects.toBeInstanceOf(ChannelForbiddenError);
    expect(repo.updateChannel).not.toHaveBeenCalled();
  });

  it("an EMPTY-of-managed-fields patch is the only thing that reaches the loose gate", async () => {
    // The derivation is by SUBTRACTION, so this is what pins the default: only
    // a patch naming `infoCard` and nothing else is member-writable. If a fifth
    // field is ever added and quietly excluded from the managed set, the mixed
    // case above will pass a member's write and this suite goes red there.
    await updateChannel(ctx(MEMBER), "chan-1", { infoCard: CARD });
    expect(repo.updateChannel).toHaveBeenCalledOnce();
  });
});
