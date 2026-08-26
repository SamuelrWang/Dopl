/**
 * THE CAP IS SERVER-SIDE — one case per WORKSPACE-level member-ADD path that a
 * `kind='link'` home-channel container must refuse, one proving a standard
 * workspace is untouched by the same code, and one proving the ONE admitted add
 * (the bound claim) deliberately does NOT come through here.
 *
 * ⚠ `LINK_CONTAINER_CLOSED`, renamed from `LINK_CONTAINER_IMMUTABLE` on
 * 2026-08-25: a container's roster DOES change now — it gains its second member
 * on a bound claim — so "immutable" was a false name for a rule that is really
 * "closed to every path but one".
 *
 * ⚠ `authz.ts` is NOT mocked: the guard under test lives there, and mocking it
 * would assert only that these files call a name. The repository is, so `kind`
 * is a fixture rather than a database.
 *
 * ⚠ Every refusal is asserted to land BEFORE `assertCanAddMember` — a guard
 * that fires after the seat gate would answer 402 for a container that could
 * never take a member at any price.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpError } from "@/shared/lib/http-error";
import type { Workspace, WorkspaceKind } from "../types";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("./repository", () => ({
  findMembership: vi.fn(),
  findWorkspaceById: vi.fn(),
}));
vi.mock("@/features/billing/server/entitlements", () => ({
  assertCanAddMember: vi.fn(),
}));
vi.mock("@/features/billing/server/seats", () => ({ syncSeatQuantity: vi.fn() }));
vi.mock("@/features/members/server/activity", () => ({ recordActivity: vi.fn() }));
vi.mock("@/features/teams/server/repository", () => ({
  insertTeamMembers: vi.fn(),
  listInvitationTeamIds: vi.fn(async () => []),
  listTeamsForWorkspace: vi.fn(async () => []),
  replaceInvitationTeams: vi.fn(),
}));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { findMembership, findWorkspaceById } from "./repository";
import { assertCanAddMember } from "@/features/billing/server/entitlements";
import { createInvitation } from "./invitations";
import {
  getOrCreateJoinLink,
  requestJoin,
  resolveJoinRequest,
  rotateJoinLink,
} from "./join-links";

const WS = "11111111-e29b-41d4-a716-446655440000";
const CALLER = "22222222-e29b-41d4-a716-446655440000";
const OUTSIDER = "33333333-e29b-41d4-a716-446655440000";
const TOKEN = "a".repeat(64);

/** Per-table canned answer for the chainable builder below. */
let answers: Record<string, unknown>;

function primeSupabase() {
  const builder: Record<string, unknown> = {};
  let table = "";
  const rec = () => builder;
  const answer = async () => ({ data: answers[table] ?? null, error: null });
  Object.assign(builder, {
    from: (t: string) => {
      table = t;
      return builder;
    },
    select: rec,
    insert: rec,
    upsert: rec,
    update: rec,
    eq: rec,
    is: rec,
    gt: rec,
    order: rec,
    maybeSingle: answer,
    single: answer,
    then: (resolve: (r: unknown) => void) => {
      void answer().then(resolve);
    },
    auth: { admin: { getUserById: async () => ({ data: null }) } },
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
}

function workspace(kind?: WorkspaceKind): Workspace {
  return {
    id: WS,
    ownerId: CALLER,
    name: "Ada & Grace",
    slug: "ada-grace",
    publicId: "pub-1",
    description: null,
    iconUrl: null,
    ...(kind ? { kind } : {}),
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

/**
 * CALLER is an active owner; anybody else has no row. The role gate is not what
 * these cases are about — but `requestJoin` short-circuits on an active
 * membership, so the two answers have to differ by user.
 */
function primeWorkspace(kind?: WorkspaceKind) {
  vi.mocked(findWorkspaceById).mockResolvedValue(workspace(kind));
  vi.mocked(findMembership).mockImplementation(async (_ws, userId) =>
    userId === CALLER
      ? {
          workspaceId: WS,
          userId: CALLER,
          role: "owner",
          status: "active",
          joinedAt: "2026-01-01T00:00:00Z",
          invitedBy: null,
          invitedAt: null,
          lastSeenAt: null,
        }
      : null
  );
}

async function refusal(run: () => Promise<unknown>): Promise<HttpError> {
  const err = (await run().then(
    () => null,
    (e: unknown) => e
  )) as HttpError | null;
  if (!err) throw new Error("expected a refusal, got a result");
  return err;
}

beforeEach(() => {
  vi.clearAllMocks();
  answers = {};
  primeSupabase();
});

describe("member-add paths refuse a kind='link' container", () => {
  const paths: Array<[string, () => Promise<unknown>]> = [
    ["createInvitation", () =>
      createInvitation({
        workspaceId: WS,
        invitedBy: CALLER,
        email: "third@example.com",
        role: "member",
      })],
    ["getOrCreateJoinLink", () => getOrCreateJoinLink(WS, CALLER)],
    ["rotateJoinLink", () => rotateJoinLink(WS, CALLER)],
    ["requestJoin", () => requestJoin(TOKEN, OUTSIDER)],
    ["resolveJoinRequest", () =>
      resolveJoinRequest(WS, CALLER, "req-1", { kind: "approve", role: "member" })],
  ];

  it.each(paths)("%s → 403 LINK_CONTAINER_CLOSED", async (_name, run) => {
    primeWorkspace("link");
    // `requestJoin` enters through the link row, not the workspace id.
    answers["workspace_join_links"] = { workspace_id: WS, created_by: null };

    const err = await refusal(run);
    expect(err.status).toBe(403);
    expect(err.code).toBe("LINK_CONTAINER_CLOSED");
    // Before the seat gate: a container is refused on principle, not on price.
    expect(assertCanAddMember).not.toHaveBeenCalled();
  });

});

describe("the BOUND CLAIM is the one admitted add, and it bypasses this guard", () => {
  /**
   * ⚠ THE ASSERTION IS AN ABSENCE, and it is the point of the whole rename.
   * `claimBoundLink` writes the member row itself, having proved possession of a
   * single-use token bound to that exact container — so it must NOT call
   * `assertMemberAddable*`, which would refuse the one add the product exists
   * to perform. A future "tidy-up" that routes every member write through the
   * shared guard would silently brick Add-person, and this reads the SOURCE
   * because a mock could not tell the difference.
   */
  const CLAIM_SRC = readFileSync(
    join(import.meta.dirname, "..", "..", "home", "server", "service-claim-bound.ts"),
    "utf8"
  );

  it("does not route through assertMemberAddable / assertMemberAddableById", () => {
    expect(CLAIM_SRC).not.toMatch(/assertMemberAddable/);
    // It really is the module that adds the member — otherwise the absence above
    // would be measuring a file that does nothing.
    expect(CLAIM_SRC).toMatch(/insertContainerMember/);
  });

  it("leans on the DATABASE for the cap instead", () => {
    // The guard it skips is a service-layer refusal; the fence it cannot skip is
    // the trigger, so the module has to handle that RAISE.
    expect(CLAIM_SRC).toMatch(/LINK_CONTAINER_FULL/);
  });
});

describe("standard workspaces are unaffected", () => {
  it("kind='standard' and an ABSENT kind both pass the guard", async () => {
    for (const kind of ["standard", undefined] as const) {
      vi.clearAllMocks();
      answers = {};
      primeSupabase();
      primeWorkspace(kind);
      answers["workspace_join_links"] = { token: "existing-token" };

      await expect(getOrCreateJoinLink(WS, CALLER)).resolves.toEqual({
        token: "existing-token",
      });
    }
  });

  it("createInvitation reaches the seat gate on a standard workspace", async () => {
    primeWorkspace("standard");
    answers["workspace_invitations"] = {
      id: "inv-1",
      workspace_id: WS,
      email: "third@example.com",
      invited_role: "member",
      invited_by: CALLER,
      token: "inv-token",
      expires_at: "2099-01-01T00:00:00Z",
      accepted_at: null,
      accepted_by: null,
      revoked_at: null,
      created_at: "2026-01-01T00:00:00Z",
    };

    const invitation = await createInvitation({
      workspaceId: WS,
      invitedBy: CALLER,
      email: "third@example.com",
      role: "member",
    });
    expect(invitation.id).toBe("inv-1");
    expect(assertCanAddMember).toHaveBeenCalledWith(WS);
  });

  it("rotateJoinLink still mints on a standard workspace", async () => {
    primeWorkspace("standard");
    const { token } = await rotateJoinLink(WS, CALLER);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("requestJoin reaches the seat gate on a standard workspace", async () => {
    primeWorkspace("standard");
    answers["workspace_join_links"] = { workspace_id: WS, created_by: null };

    // A NON-member: an active one routes straight in without an add.
    await expect(requestJoin(TOKEN, OUTSIDER)).resolves.toMatchObject({
      outcome: "requested",
    });
    expect(assertCanAddMember).toHaveBeenCalledWith(WS);
  });

  it("resolveJoinRequest gets past the guard to its own 404", async () => {
    primeWorkspace("standard");
    const err = await refusal(() =>
      resolveJoinRequest(WS, CALLER, "req-1", { kind: "approve", role: "member" })
    );
    expect(err.code).toBe("JOIN_REQUEST_NOT_FOUND");
  });
});
