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
 * constraint exists. ELEVEN of the fourteen guest-floored channel routes compose
 * `loadVisibleChannel` (measured 2026-08-26 — the three that do not are
 * `channels/route.ts` GET, `channels/await/route.ts` GET and
 * `channels/presence/route.ts` POST, none of which takes a channel ref;
 * re-derive by walking each route in `guest-route-floor.test.ts ›
 * GUEST_ALLOWED` to the service function it calls). So an operator opening a
 * second, public channel silently handed the guest its header, transcript,
 * thread list, roster and a long-poll.
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
 * ⚠ THE LIST HALF WAS AN UNPINNED PIN UNTIL 2026-08-26, AND THIS HEADER SAID
 * OTHERWISE. Only the PURE helper `visibleChannelsOr` was driven; neither of the
 * two `includePublic` CALL SITES was, and the sole `listChannels` test
 * (`service-reads.test.ts`) runs at role `member` and never inspects the opts.
 * **Deleting `includePublic: mayReadPublicChannels(ctx)` from
 * `service-reads.ts › listChannels` left the whole suite green** — i.e. a
 * guest's `GET /api/channels` re-included public container channels, and
 * `toChannelDto` carries `lasts` (the last message) plus member/online counts:
 * a transcript preview of a room they were never added to. Both call sites are
 * now DRIVEN below.
 *
 * ⚠ MUTATION-VERIFY, MEASURED 2026-08-26 — 3 reverts, 3 failures, 0 vacuous:
 *   - `mayReadPublicChannels` → `true`                       : 6 red
 *   - drop `includePublic:` in `service-reads.ts ›listChannels`: 6 red
 *   - drop `opts` in `repository.ts › listChannels`'s
 *     `visibleChannelsOr(opts.memberChannelIds, opts)`        : 2 red
 * ⚠ Note the SECOND one reddens the viewer cases too, and that is correct rather
 * than sloppy: an ABSENT argument is not `false`, it is the repository's wide
 * default, so "the opts object still carries the key" is part of the claim.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository", () => ({
  findChannelById: vi.fn(),
  findChannelBySlug: vi.fn(),
  findMembership: vi.fn(),
  findChannelAccess: vi.fn(),
  hasMembership: vi.fn(),
  // The LIST half's collaborators — `listChannels` is DRIVEN below.
  listMyMemberships: vi.fn(),
  listChannels: vi.fn(),
  memberCounts: vi.fn(),
  fetchProfiles: vi.fn(),
}));
vi.mock("./repository-messages");
vi.mock("./repository-collab");
vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import {
  loadVisibleChannel,
  mayReadPublicChannels,
  type ChannelContext,
} from "./service-shared";
import { visibleChannelsOr } from "./repository-visibility";
import { listChannels, revalidateAwaitAccess } from "./service-reads";
import { ChannelNotFoundError } from "./errors";
import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as collab from "./repository-collab";
import { supabaseAdmin } from "@/shared/supabase/admin";
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

describe("listChannels — CALL SITE 1, the service, driven for real", () => {
  // ⚠ NOT a pin on `visibleChannelsOr`; that helper is pure and was already
  // covered. This drives `service-reads.ts › listChannels` and reads the opts
  // the repository was actually handed — the argument whose deletion left the
  // entire suite green.
  beforeEach(() => {
    vi.mocked(repo.listMyMemberships).mockResolvedValue([]);
    vi.mocked(repo.listChannels).mockResolvedValue([]);
    vi.mocked(repo.memberCounts).mockResolvedValue(new Map());
    vi.mocked(repoMessages.lastMessages).mockResolvedValue(new Map());
    vi.mocked(collab.channelMemberUserIds).mockResolvedValue(new Map());
    vi.mocked(collab.presenceForWorkspace).mockResolvedValue(new Map());
  });

  it("hands the repository includePublic:FALSE for a guest", async () => {
    await listChannels(ctx("guest"), false);
    expect(vi.mocked(repo.listChannels).mock.calls[0]?.[1]).toMatchObject({
      includePublic: false,
    });
  });

  it.each(["viewer", "member", "admin", "owner"] as const)(
    "hands it includePublic:TRUE for a %s (unchanged)",
    async (role) => {
      await listChannels(ctx(role), false);
      expect(vi.mocked(repo.listChannels).mock.calls[0]?.[1]).toMatchObject({
        includePublic: true,
      });
    }
  );

  it("states the argument EXPLICITLY — absent is not the same as false", async () => {
    // The repository's own default is `true` (§5's rule for everybody above the
    // floor), so an argument that stops being passed reads as the WIDE answer.
    // Assert presence, not just value.
    await listChannels(ctx("guest"), false);
    const opts = vi.mocked(repo.listChannels).mock.calls[0]?.[1] as unknown as
      | Record<string, unknown>
      | undefined;
    expect(opts !== undefined && "includePublic" in opts).toBe(true);
  });
});

describe("repository.listChannels — CALL SITE 2, the opts pass-through", () => {
  /** Chainable, thenable Supabase-builder stub (the sibling repository suites'
   *  shape), so the real `.from().select().eq().is().or().order()` chain runs. */
  function makeAdmin() {
    const calls: Array<{ op: string; args: unknown[] }> = [];
    const builder: Record<string, unknown> = {};
    const rec = (op: string, args: unknown[]) => {
      calls.push({ op, args });
      return builder;
    };
    for (const op of ["from", "select", "eq", "is", "or", "order"]) {
      builder[op] = (...args: unknown[]) => rec(op, args);
    }
    builder.then = (
      resolve: (v: { data: unknown[]; error: null }) => unknown
    ) => resolve({ data: [], error: null });
    return { calls, client: builder };
  }

  async function realListChannels(includePublic: boolean, ids: string[]) {
    const { calls, client } = makeAdmin();
    vi.mocked(supabaseAdmin).mockReturnValue(client as never);
    const real = await vi.importActual<typeof import("./repository")>(
      "./repository"
    );
    await real.listChannels(WS, {
      memberChannelIds: ids,
      includeArchived: false,
      includePublic,
    });
    return calls.find((c) => c.op === "or")?.args[0] ?? null;
  }

  it("a guest's predicate is MEMBERSHIP ONLY — the public term never reaches PostgREST", async () => {
    expect(await realListChannels(false, ["a"])).toBe("id.in.(a)");
  });

  it("everybody else keeps the public term (unchanged)", async () => {
    expect(await realListChannels(true, ["a"])).toBe(
      "visibility.eq.public,id.in.(a)"
    );
  });

  it("a guest with NO memberships never runs a query at all", async () => {
    // `visibleChannelsOr` answers `null` and the repository returns [] — a
    // no-term `or()` would be a PostgREST syntax error, i.e. a 500 on the
    // plain channel list rather than an empty one.
    expect(await realListChannels(false, [])).toBeNull();
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
