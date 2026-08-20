/**
 * Members console write CONFIGS, driven through TanStack's framework-free
 * `MutationObserver` — what `useMutation` runs, minus React. Property under
 * test: the cache changes AT THE MOMENT THE TRANSPORT IS CALLED, before the
 * network is spoken to at all.
 * ⚠ Configs are imported from the hooks they back, never re-declared here — a
 * copy would pass while the shipped config was wrong.
 */

import { describe, expect, it, vi } from "vitest";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { apiQueryKey } from "@/shared/api/query-keys";
import {
  buildApiMutationOptions,
  type ApiMutationRequestFn,
} from "@/shared/hooks/use-api-mutation";
import {
  accessMatrixPath,
  invitationsPath,
  joinRequestsPath,
  membersPath,
  teamsPath,
} from "../client/query-keys";
import type {
  InvitationsCache,
  JoinRequestsCache,
  MembersCache,
  ResourcesCache,
} from "../lib/optimistic-cache";
import { revokeInvitationConfig } from "./use-invitation-writes";
import { resolveJoinRequestConfig } from "./use-join-requests";
import { memberRoleConfig, removeMemberConfig } from "./use-member-writes";
import { setGrantConfig, setResourceScopeConfig } from "./use-access-writes";
import { teamDeleteConfig } from "./use-team-writes";

vi.mock("@/shared/ui/toast", () => ({ toast: () => {} }));

const SLUG = "acme";

/** The exact tuple `useApiQuery` registers — the entry a patch must reach. */
function entry(path: string) {
  return apiQueryKey(path);
}

function client(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** Transport the test settles by hand; records the cache AS THE REQUEST
 *  LEAVES, so the proof carries no timing assumption. */
function deferredRequest(observe?: () => unknown) {
  let settle!: (value: unknown) => void;
  let fail!: (error: unknown) => void;
  const pending = new Promise<unknown>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const calls: Array<[string, unknown]> = [];
  const seen: unknown[] = [];
  const request = ((path: string, opts: unknown) => {
    calls.push([path, opts]);
    seen.push(observe?.());
    return pending;
  }) as unknown as ApiMutationRequestFn;
  return { request, settle, fail, seen, calls };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("revoke invitation — the dead control", () => {
  it("drops the row before the DELETE is even sent", async () => {
    const qc = client();
    const key = entry(invitationsPath(SLUG));
    qc.setQueryData(key, {
      invitations: [{ id: "i-1" }, { id: "i-2" }],
    } as unknown as InvitationsCache);
    const net = deferredRequest(() => qc.getQueryData<InvitationsCache>(key));

    const run = new MutationObserver(
      qc,
      buildApiMutationOptions(qc, net.request, revokeInvitationConfig(SLUG))
    ).mutate({ invitationId: "i-1" });
    await flush();

    expect(
      (net.seen[0] as InvitationsCache).invitations.map((i) => i.id)
    ).toEqual(["i-2"]);
    expect(net.calls[0][0]).toBe(`/api/workspaces/acme/invitations/i-1`);
    expect(net.calls[0][1]).toMatchObject({ method: "DELETE" });

    net.settle(undefined);
    await run;
    // No refetch: the delete is fully computable client-side.
    expect(qc.getQueryData<InvitationsCache>(key)?.invitations).toHaveLength(1);
  });

  it("puts the row back, in place, when the DELETE fails", async () => {
    const qc = client();
    const key = entry(invitationsPath(SLUG));
    const before = { invitations: [{ id: "i-1" }, { id: "i-2" }] };
    qc.setQueryData(key, before as unknown as InvitationsCache);
    const net = deferredRequest();

    const run = new MutationObserver(
      qc,
      buildApiMutationOptions(qc, net.request, revokeInvitationConfig(SLUG))
    )
      .mutate({ invitationId: "i-1" })
      .catch(() => "rejected");
    await flush();
    net.fail(new Error("nope"));
    await run;

    expect(qc.getQueryData(key)).toEqual(before);
  });
});

describe("join-request approve / decline — the double-fireable pair", () => {
  it("drops the row before the PATCH leaves, which is what removes the second click", async () => {
    const qc = client();
    const key = entry(joinRequestsPath(SLUG));
    qc.setQueryData(key, {
      requests: [{ id: "j-1" }, { id: "j-2" }],
    } as unknown as JoinRequestsCache);
    const net = deferredRequest(() => qc.getQueryData<JoinRequestsCache>(key));

    const run = new MutationObserver(
      qc,
      buildApiMutationOptions(
        qc,
        net.request,
        resolveJoinRequestConfig(SLUG, () => {})
      )
    ).mutate({ requestId: "j-1", action: "approve", role: "member" });
    await flush();

    expect((net.seen[0] as JoinRequestsCache).requests.map((r) => r.id)).toEqual(
      ["j-2"]
    );
    net.settle(undefined);
    await run;
  });

  it("invalidates the roster on APPROVE and rings the seat count; a decline does neither", async () => {
    const approveSeats = vi.fn();
    const declineSeats = vi.fn();

    const qcA = client();
    qcA.setQueryData(entry(joinRequestsPath(SLUG)), { requests: [] });
    const invalidateA = vi.spyOn(qcA, "invalidateQueries");
    const okA = deferredRequest();
    const runA = new MutationObserver(
      qcA,
      buildApiMutationOptions(
        qcA,
        okA.request,
        resolveJoinRequestConfig(SLUG, approveSeats)
      )
    ).mutate({ requestId: "j-1", action: "approve", role: "member" });
    okA.settle(undefined);
    await runA;
    expect(invalidateA).toHaveBeenCalledWith({ queryKey: [membersPath(SLUG)] });
    expect(approveSeats).toHaveBeenCalledOnce();

    const qcD = client();
    qcD.setQueryData(entry(joinRequestsPath(SLUG)), { requests: [] });
    const invalidateD = vi.spyOn(qcD, "invalidateQueries");
    const okD = deferredRequest();
    const runD = new MutationObserver(
      qcD,
      buildApiMutationOptions(
        qcD,
        okD.request,
        resolveJoinRequestConfig(SLUG, declineSeats)
      )
    ).mutate({ requestId: "j-1", action: "decline", role: "member" });
    okD.settle(undefined);
    await runD;
    expect(invalidateD).not.toHaveBeenCalled();
    expect(declineSeats).not.toHaveBeenCalled();
  });
});

describe("member role — the stale-value select", () => {
  it("shows the picked role before the PATCH is sent, and invalidates only the access pane", async () => {
    const qc = client();
    const key = entry(membersPath(SLUG));
    qc.setQueryData(key, {
      members: [{ userId: "u-1", role: "member" }],
    } as unknown as MembersCache);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const net = deferredRequest(() => qc.getQueryData<MembersCache>(key));

    const run = new MutationObserver(
      qc,
      buildApiMutationOptions(qc, net.request, memberRoleConfig(SLUG))
    ).mutate({ userId: "u-1", role: "admin" });
    await flush();
    expect((net.seen[0] as MembersCache).members[0].role).toBe("admin");

    net.settle(undefined);
    await run;
    // Roster just computed is NOT re-downloaded; the two server-resolved panes
    // it cannot compute are — access (role sets the ceiling) and activity
    // (the write records a `member.role_changed` row).
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [`/api/workspaces/acme/members/u-1/access`],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [`/api/workspaces/acme/members/u-1/activity`],
    });
  });
});

describe("member removal — F-045's seat refresh", () => {
  it("clears the member from the roster AND their teams, then rings the seat count once", async () => {
    const qc = client();
    const membersKey = entry(membersPath(SLUG));
    const teamsKey = entry(teamsPath(SLUG));
    qc.setQueryData(membersKey, {
      members: [{ userId: "u-1" }, { userId: "u-2" }],
    } as unknown as MembersCache);
    qc.setQueryData(teamsKey, {
      teams: [{ id: "t-1", memberIds: ["u-1", "u-2"], memberCount: 2 }],
    });
    const seats = vi.fn();
    const net = deferredRequest(() => ({
      members: qc.getQueryData(membersKey),
      teams: qc.getQueryData(teamsKey),
    }));

    const run = new MutationObserver(
      qc,
      buildApiMutationOptions(qc, net.request, removeMemberConfig(SLUG, seats))
    ).mutate({ userId: "u-1" });
    await flush();

    const atSend = net.seen[0] as {
      members: MembersCache;
      teams: { teams: Array<{ memberIds: string[]; memberCount: number }> };
    };
    expect(atSend.members.members.map((m) => m.userId)).toEqual(["u-2"]);
    expect(atSend.teams.teams[0]).toMatchObject({
      memberIds: ["u-2"],
      memberCount: 1,
    });
    // A removal that hasn't succeeded has moved no seats.
    expect(seats).not.toHaveBeenCalled();

    net.settle(undefined);
    await run;
    expect(seats).toHaveBeenCalledOnce();
  });

  it("does NOT touch the seat count when the removal fails, and restores both caches", async () => {
    const qc = client();
    const membersKey = entry(membersPath(SLUG));
    const teamsKey = entry(teamsPath(SLUG));
    const members = { members: [{ userId: "u-1" }] };
    const teams = { teams: [{ id: "t-1", memberIds: ["u-1"], memberCount: 1 }] };
    qc.setQueryData(membersKey, members as unknown as MembersCache);
    qc.setQueryData(teamsKey, teams);
    const seats = vi.fn();
    const net = deferredRequest();

    const run = new MutationObserver(
      qc,
      buildApiMutationOptions(qc, net.request, removeMemberConfig(SLUG, seats))
    )
      .mutate({ userId: "u-1" })
      .catch(() => "rejected");
    await flush();
    net.fail(new Error("last owner"));
    await run;

    expect(qc.getQueryData(membersKey)).toEqual(members);
    expect(qc.getQueryData(teamsKey)).toEqual(teams);
    expect(seats).not.toHaveBeenCalled();
  });
});

describe("resource scope — the segmented control that would not move", () => {
  it("moves the thumb before the PUT leaves, and invalidates the teams cache it cannot compute", async () => {
    const qc = client();
    const key = entry(accessMatrixPath(SLUG));
    qc.setQueryData(key, {
      resources: [
        {
          resourceType: "skill",
          resourceId: "s-1",
          name: "Skill",
          accessMode: "workspace",
          createdBy: null,
        },
      ],
    } satisfies ResourcesCache);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const net = deferredRequest(() => qc.getQueryData<ResourcesCache>(key));

    const run = new MutationObserver(
      qc,
      buildApiMutationOptions(qc, net.request, setResourceScopeConfig(SLUG))
    ).mutate({ resourceType: "skill", resourceId: "s-1", accessMode: "teams" });
    await flush();
    expect((net.seen[0] as ResourcesCache).resources[0].accessMode).toBe("teams");

    net.settle(undefined);
    await run;
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [teamsPath(SLUG)] });
  });
});

/**
 * A grant is a PER-MEMBER fact and its pane is server-computed:
 * `member-detail` reads `…/members/<id>/access` and nothing else refreshes it
 * (the pane never unmounts). Changing a team's reach changes that answer for
 * every member, so ⚠ each member's entry must be named individually — a prefix
 * cannot work: TanStack matches keys per ARRAY ELEMENT and these keys are
 * whole paths, so `[…/members]` reaches no `[…/members/<id>/access]` entry.
 */
const accessKey = (userId: string) => [
  `/api/workspaces/${SLUG}/members/${userId}/access`,
];

describe("team grant — the per-member access panes", () => {
  function grantRun(qc: QueryClient) {
    qc.setQueryData(entry(teamsPath(SLUG)), {
      teams: [{ id: "t-1", memberIds: ["u-1", "u-2"], grants: [] }],
    });
    const net = deferredRequest();
    const run = new MutationObserver(
      qc,
      buildApiMutationOptions(qc, net.request, setGrantConfig(SLUG))
    ).mutate({
      teamId: "t-1",
      resourceType: "knowledge_base",
      resourceId: "kb-1",
      level: "read",
      memberIds: ["u-1", "u-2"],
    });
    net.settle(undefined);
    return run;
  }

  it("re-reads every team member's access, and NOT the teams cache it just computed", async () => {
    const qc = client();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    await grantRun(qc);

    expect(invalidate.mock.calls.map(([args]) => args)).toEqual([
      { queryKey: accessKey("u-1") },
      { queryKey: accessKey("u-2") },
    ]);
  });
});

describe("team delete — the grants that go with it", () => {
  it("drops the row and its roster chips before the DELETE leaves, then re-reads each member's access", async () => {
    const qc = client();
    const teamsKey = entry(teamsPath(SLUG));
    const membersKey = entry(membersPath(SLUG));
    qc.setQueryData(teamsKey, {
      teams: [{ id: "t-1", memberIds: ["u-1"] }, { id: "t-2", memberIds: [] }],
    });
    qc.setQueryData(membersKey, {
      members: [{ userId: "u-1", teams: [{ teamId: "t-1", name: "Growth" }] }],
    } as unknown as MembersCache);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const net = deferredRequest(() => ({
      teams: qc.getQueryData(teamsKey),
      members: qc.getQueryData<MembersCache>(membersKey),
    }));

    const run = new MutationObserver(
      qc,
      buildApiMutationOptions(qc, net.request, teamDeleteConfig(SLUG))
    ).mutate({ teamId: "t-1", memberIds: ["u-1"] });
    await flush();

    const atSend = net.seen[0] as {
      teams: { teams: Array<{ id: string }> };
      members: MembersCache;
    };
    expect(atSend.teams.teams.map((t) => t.id)).toEqual(["t-2"]);
    expect(atSend.members.members[0].teams).toEqual([]);
    expect(net.calls[0][1]).toMatchObject({ method: "DELETE" });

    net.settle(undefined);
    await run;
    // Team row is computable here; what the server resolves for the member it
    // granted through is not — access, and the activity row the delete records.
    expect(invalidate.mock.calls.map(([args]) => args)).toEqual([
      { queryKey: accessKey("u-1") },
      { queryKey: [`/api/workspaces/acme/members/u-1/activity`] },
    ]);
  });
});
