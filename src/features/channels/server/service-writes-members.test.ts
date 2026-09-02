/**
 * `removeMember` — WHO MAY REMOVE WHOM, and when the delete does not happen.
 *
 * This file used to be about a SWEEP. `channel_agents` had no FK to
 * `channel_members`, so agent engagement outlived membership, and a departure
 * had to clear every engagement the leaver had created on the way out. Named
 * agents and engagement are gone (rollback §1), the sweep with them, and the
 * cases below are what is left standing on its own: a departure is a membership
 * write, and the three states in which it must NOT write are still states.
 *
 * The rest of the membership lane's rules (the DM's immutable roster, self-join)
 * are pinned in `service-direct.test.ts` and `service-writes.test.ts`.
 *
 * ⚠ AND `updateMyMemberSettings` — the SELF-ONLY write, whose whole guarantee is
 * that the row it lands on is chosen by the authenticated caller and never by
 * the request body. See the second describe block.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");

import * as repo from "./repository";
import { ChannelMemberSelfUpdateSchema } from "../schema";
import { ChannelForbiddenError, ChannelLastOwnerError } from "./errors";
import { removeMember, updateMyMemberSettings } from "./service-writes-members";
import type { ChannelMemberRow, ChannelRow } from "./dto";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const PEER = "22222222-e29b-41d4-a716-446655440000";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  credentialSubjectUserId: USER,
  source: "user",
  role: "member",
};

function channelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: "chan-1",
    workspace_id: WS,
    created_by: USER,
    slug: "room",
    name: "Room",
    topic: "",
    visibility: "private",
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    ...overrides,
  };
}

function memberRow(userId: string, role = "member"): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role,
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    favorited_at: null,
    added_by: USER,
    joined_at: "2026-07-31T00:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
    userId === USER ? memberRow(USER, "owner") : memberRow(userId)
  );
  vi.mocked(repo.countOwners).mockResolvedValue(2);
  vi.mocked(repo.deleteMember).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repo.updateMemberPrefs).mockImplementation(async (_c, userId) =>
    memberRow(userId)
  );
});

describe("removeMember — the delete, and the three states that stop it", () => {
  it("removes the target member from THIS channel", async () => {
    await removeMember(ctx, "room", PEER);

    expect(repo.deleteMember).toHaveBeenCalledWith("chan-1", PEER);
  });

  it("lets a member LEAVE on their own", async () => {
    await removeMember(ctx, "room", USER);

    expect(repo.deleteMember).toHaveBeenCalledWith("chan-1", USER);
  });

  it("is an idempotent no-op when there was no membership to remove", async () => {
    vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
      userId === USER ? memberRow(USER, "owner") : null
    );

    await removeMember(ctx, "room", PEER);

    expect(repo.deleteMember).not.toHaveBeenCalled();
  });

  it("REFUSES to remove the last owner", async () => {
    vi.mocked(repo.findMembership).mockResolvedValue(memberRow(USER, "owner"));
    vi.mocked(repo.countOwners).mockResolvedValue(1);

    await expect(removeMember(ctx, "room", USER)).rejects.toThrow(
      ChannelLastOwnerError
    );
    expect(repo.deleteMember).not.toHaveBeenCalled();
  });

  it("REFUSES a caller who may not remove somebody else", async () => {
    vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
      memberRow(userId)
    );

    await expect(removeMember(ctx, "room", PEER)).rejects.toThrow(
      ChannelForbiddenError
    );
    expect(repo.deleteMember).not.toHaveBeenCalled();
  });
});

/**
 * THE FAVOURITE TOGGLE (2026-08-19) — `channel_members.favorited_at`, written
 * through the per-member preference route the tool profile already used.
 *
 * The property that matters is not "does it write": it is **WHOSE ROW**. A
 * favourite is a personal preference any member may set for themselves and
 * nobody may set for anybody else, and there is no role check anywhere in that
 * sentence — so if the target row could ever come from the request, the write
 * would be an unauthenticated preference edit on a stranger's account.
 */
describe("updateMyMemberSettings — the favourite, and whose row it lands on", () => {
  const asFavorite = { favorite: true };

  it("stamps a timestamp on FAVOURITE and NULLS it on un-favourite", async () => {
    await updateMyMemberSettings(ctx, "room", asFavorite);
    const [, , setPatch] = vi.mocked(repo.updateMemberPrefs).mock.calls[0];
    expect(typeof setPatch.favorited_at).toBe("string");

    await updateMyMemberSettings(ctx, "room", { favorite: false });
    const [, , clearPatch] = vi.mocked(repo.updateMemberPrefs).mock.calls[1];
    // ⚠ `null`, not an omitted key: `favorite: false` must CLEAR the column, and
    // a patch built on truthiness would have dropped the field and left the
    // channel favourited with the UI insisting it was not (INVARIANTS §8).
    expect(clearPatch).toHaveProperty("favorited_at", null);
  });

  it("never lets the caller pick another member's row", async () => {
    // The body a hostile client would send: a plausible member field beside the
    // real one. It must have NO effect on which row is written.
    await updateMyMemberSettings(ctx, "room", {
      ...asFavorite,
      ...({ userId: PEER, user_id: PEER, memberId: PEER } as object),
    });

    expect(repo.updateMemberPrefs).toHaveBeenCalledWith(
      "chan-1",
      USER,
      expect.objectContaining({ favorited_at: expect.any(String) })
    );
    expect(repo.updateMemberPrefs).not.toHaveBeenCalledWith(
      expect.anything(),
      PEER,
      expect.anything()
    );
  });

  it("strips a member field at the SCHEMA, so the service never sees one", () => {
    // ⚠ The other half of the same guarantee, and the half a reader of the
    // service alone cannot check. Zod strips unknown keys, so the parsed patch
    // that reaches the service names nobody — the service's `ctx.userId` is not
    // overriding a value, there is no value to override.
    const parsed = ChannelMemberSelfUpdateSchema.parse({
      favorite: true,
      userId: PEER,
    });
    expect(parsed).toEqual({ favorite: true });
  });

  it("refuses a NON-MEMBER outright rather than writing a row that isn't there", async () => {
    // ⚠ A PUBLIC channel, or the visibility gate refuses first and this case
    // never reaches the membership check it is about. Reading a public channel
    // is allowed; favouriting it without joining is not — there is no row.
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ visibility: "public" })
    );
    vi.mocked(repo.findMembership).mockResolvedValue(null);

    await expect(updateMyMemberSettings(ctx, "room", asFavorite)).rejects.toThrow(
      ChannelForbiddenError
    );
    expect(repo.updateMemberPrefs).not.toHaveBeenCalled();
  });

  it("leaves favorited_at ALONE when the patch is only about the tool profile", async () => {
    await updateMyMemberSettings(ctx, "room", { agentToolProfile: "read_only" });

    const [, , patch] = vi.mocked(repo.updateMemberPrefs).mock.calls[0];
    // An absent key is "do not touch"; `null` would un-favourite the channel as
    // a side effect of tightening an agent's tools.
    expect(patch).not.toHaveProperty("favorited_at");
  });

  it("scrubs the echoed row to the viewer, so the response is the caller's own", async () => {
    const member = await updateMyMemberSettings(ctx, "room", asFavorite);
    expect(member.userId).toBe(USER);
    expect(member.favoritedAt).toBeNull(); // the mocked row's stored value
  });
});
