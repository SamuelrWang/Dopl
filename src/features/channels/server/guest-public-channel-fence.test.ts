/**
 * 🔒 THE GUEST DOES NOT INHERIT THE `visibility='public'` ARM (2026-08-26).
 *
 * THE HOLE THIS CLOSES, and it was reachable. `loadVisibleChannel` threw only
 * when `visibility !== "public" && membership === null`, and `listChannels` ORs
 * `visibility.eq.public` into its predicate — so "public" meant *any workspace
 * member*, a statement about a TENANCY. A guest has none: they were admitted to
 * ONE channel by a single-use link. And nothing stops a PUBLIC channel existing
 * inside a `kind='link'` container — `createChannel` never reads
 * `workspace.kind`, `POST /api/channels` is `member`+ (the container's owner
 * clears it), `dopl_channel(op="open")` exposes `visibility`, and no DB
 * constraint exists. Seven of the fourteen guest-floored routes compose
 * `loadVisibleChannel`, so an operator opening a second, public channel silently
 * handed the guest its header, transcript, thread list, roster and a long-poll.
 *
 * THREE HALVES OF ONE RULE, all pinned here because they must not drift apart:
 *   1. `service-shared.ts › loadVisibleChannel` — the single-ref read.
 *   2. `repository-visibility.ts › visibleChannelsOr` — the LIST read.
 *   3. `service-reads.ts › revalidateAwaitAccess` — the long-poll's re-check,
 *      which asks the same question one tick later and must give the same answer.
 * The DATABASE states the same rule a fourth time
 * (`20260826120000_guest_channel_realtime_rls.sql`'s guest arm requires
 * `is_channel_member` and drops the public disjunct).
 *
 * ⚠ MUTATION-VERIFY: reverting `mayReadPublicChannels` to `true`, or dropping
 * the `includePublic` argument at either call site, turns the guest cases red
 * while every viewer case stays green — which is the shape of the claim.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository", () => ({
  findChannelById: vi.fn(),
  findChannelBySlug: vi.fn(),
  findMembership: vi.fn(),
  findChannelAccess: vi.fn(),
  hasMembership: vi.fn(),
}));

import {
  loadVisibleChannel,
  mayReadPublicChannels,
  type ChannelContext,
} from "./service-shared";
import { visibleChannelsOr } from "./repository-visibility";
import { revalidateAwaitAccess } from "./service-reads";
import { ChannelNotFoundError } from "./errors";
import * as repo from "./repository";
import type { Role } from "@/features/workspaces/types";
import type { ChannelRow } from "./dto";

const WS = "33333333-3333-4333-8333-333333333333";
const USER = "22222222-2222-4222-8222-222222222222";
const PUBLIC_CHANNEL = "44444444-4444-4444-8444-444444444444";

const mocked = vi.mocked(repo);

function ctx(role: Role | null): ChannelContext {
  return { workspaceId: WS, userId: USER, source: "user", role };
}

/** A PUBLIC channel in the workspace the caller has no `channel_members` row in. */
function publicRow(): ChannelRow {
  return {
    id: PUBLIC_CHANNEL,
    workspace_id: WS,
    visibility: "public",
    deleted_at: null,
  } as ChannelRow;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.findChannelById.mockResolvedValue(publicRow());
  // The whole point: NO channel membership.
  mocked.findMembership.mockResolvedValue(null);
});

describe("mayReadPublicChannels — the predicate itself", () => {
  it.each(["viewer", "member", "admin", "owner"] as const)(
    "%s keeps the public arm (nothing changed for anybody above the floor)",
    (role) => {
      expect(mayReadPublicChannels(ctx(role))).toBe(true);
    }
  );

  it("guest does NOT", () => {
    expect(mayReadPublicChannels(ctx("guest"))).toBe(false);
  });

  it("a NULL role fails closed", () => {
    // Never reached through a route (`withWorkspaceAuth` always resolves one)
    // and never through an internal builder (all pass `role: "owner"`), so the
    // unexpected case must not be the wider one.
    expect(mayReadPublicChannels(ctx(null))).toBe(false);
  });
});

describe("loadVisibleChannel — the single-ref read", () => {
  it("admits a VIEWER to a public channel they never joined (unchanged)", async () => {
    const { channel, membership } = await loadVisibleChannel(
      ctx("viewer"),
      PUBLIC_CHANNEL
    );
    expect(channel.id).toBe(PUBLIC_CHANNEL);
    // `membership: null` is the public-arm signature every write then refuses on.
    expect(membership).toBeNull();
  });

  it("REFUSES a guest the same channel", async () => {
    await expect(
      loadVisibleChannel(ctx("guest"), PUBLIC_CHANNEL)
    ).rejects.toThrow(ChannelNotFoundError);
  });

  it("still admits a guest to a channel they ARE a member of", async () => {
    // The fence is the public ARM, not the guest. Their own channel is reached
    // through membership exactly as before.
    mocked.findMembership.mockResolvedValue({
      channel_id: PUBLIC_CHANNEL,
      user_id: USER,
      workspace_id: WS,
      role: "member",
    } as never);
    const { channel } = await loadVisibleChannel(ctx("guest"), PUBLIC_CHANNEL);
    expect(channel.id).toBe(PUBLIC_CHANNEL);
  });

  it("refuses with NOT-FOUND, never FORBIDDEN — no existence oracle", async () => {
    // A 403 would tell the guest the channel is there; the answer has to be the
    // one a private channel already gives a non-member.
    await expect(
      loadVisibleChannel(ctx("guest"), PUBLIC_CHANNEL)
    ).rejects.toMatchObject({ constructor: ChannelNotFoundError });
  });
});

describe("visibleChannelsOr — the LIST read", () => {
  it("keeps the public term by default", () => {
    expect(visibleChannelsOr([])).toBe("visibility.eq.public");
    expect(visibleChannelsOr(["a"])).toBe("visibility.eq.public,id.in.(a)");
  });

  it("drops it for a guest, leaving membership alone", () => {
    expect(visibleChannelsOr(["a"], { includePublic: false })).toBe("id.in.(a)");
  });

  it("answers NULL for a guest with no memberships, rather than an empty predicate", () => {
    // ⚠ `or()` / `in.()` with no terms is a PostgREST SYNTAX ERROR — a 500 on
    // the plain channel list. `null` is "this caller may see nothing", which the
    // callers turn into an empty list without running a query.
    expect(visibleChannelsOr([], { includePublic: false })).toBeNull();
  });
});

describe("revalidateAwaitAccess — the long-poll re-check gives the SAME answer", () => {
  beforeEach(() => {
    mocked.findChannelAccess.mockResolvedValue({
      id: PUBLIC_CHANNEL,
      visibility: "public",
    } as never);
    mocked.hasMembership.mockResolvedValue(false);
  });

  it("keeps holding for a viewer on a public channel (unchanged)", async () => {
    await expect(
      revalidateAwaitAccess(ctx("viewer"), PUBLIC_CHANNEL)
    ).resolves.toBeUndefined();
    // The public arm short-circuits, so no membership probe is paid.
    expect(mocked.hasMembership).not.toHaveBeenCalled();
  });

  it("ENDS the hold for a guest who is not a member", async () => {
    // Without this the entry gate would refuse a channel the hold kept
    // streaming — the two have to agree or the fence has a back door.
    await expect(
      revalidateAwaitAccess(ctx("guest"), PUBLIC_CHANNEL)
    ).rejects.toThrow(ChannelNotFoundError);
    expect(mocked.hasMembership).toHaveBeenCalled();
  });

  it("keeps holding for a guest who IS a member", async () => {
    mocked.hasMembership.mockResolvedValue(true);
    await expect(
      revalidateAwaitAccess(ctx("guest"), PUBLIC_CHANNEL)
    ).resolves.toBeUndefined();
  });
});
