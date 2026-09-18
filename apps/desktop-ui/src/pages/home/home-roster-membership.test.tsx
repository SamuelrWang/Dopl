import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import { USER_ID, installBridge, noContent, ok } from "#/test-utils/bridge";
import type { Channel, ChannelMember } from "@/features/channels/types";
import type { Role } from "@/features/workspaces/types";
import {
  HOME,
  LINK_SEGMENT,
  MEMBERS,
  isAccountChannels,
  openChannelRecord,
  renderHome,
  routes,
  staleCachedChannel,
} from "./home-test-harness";

/**
 * **R-09 — REMOVE AND LEAVE ON /home's CONTAINER ROSTER** (Samuel, 2026-09-17:
 * *"add remove + leave"*).
 *
 * ⚠ **THE RULING WAS COSTED AS UI-ONLY AND THAT PREMISE WAS FALSE (F-725).**
 * `membership-admin.ts › removeMember` opens with `requireWorkspaceRole(…,
 * "admin")` and then denies `isSelf` below owner, and a link container's owner
 * is its LAST owner — so before this wave nobody could leave a container from
 * anywhere. The server half is `› leaveWorkspace`; this suite is its picture.
 *
 * ⚠ **THE GATES ARE PICTURES, NEVER FENCES** (INVARIANTS §5). Every case below
 * is refused server-side too; a green row here is not evidence a floor may move.
 *
 * ⚠ MOUNTED THROUGH `HomePage`, never the component: the caller's role arrives
 * on the `?scope=account` channel row (`myWorkspaceRole`), so a direct mount
 * would pass a static prop and stay green with the projection broken.
 */

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock("@/features/channels/components/channel-surface-standalone", async () =>
  (await import("./surface-slot-fixtures")).standaloneSurfaceStub()
);

/** The container at one caller role, with no invitation out. */
function atRole(role: Role): Channel[] {
  return [{ ...HOME.channels[0], myWorkspaceRole: role, linkOut: null }];
}

/** ⚠ THE PERSONAL CONTAINER IS A ROSTER OF ONE, AND THAT IS ALL IT TAKES: the
 *  single row is the viewer's (no Remove — never self) and the viewer is its
 *  owner (no Leave — the last owner cannot go). No third rule, and the server
 *  refuses it besides (`leaveWorkspace › assertWorkspacePermanentById`, R-35). */
const SOLO_ROSTER: { members: ChannelMember[] } = {
  members: [MEMBERS.members[0]],
};

function serve(
  channels: Channel[],
  roster: { members: ChannelMember[] } = MEMBERS
): void {
  apiRequest.mockImplementation(
    (path: string, opts: BridgeRequestOpts = {}): Promise<BridgeResponse> => {
      const bare = path.split("?")[0];
      if (isAccountChannels(path)) {
        return Promise.resolve(ok({ channels, pendingLinks: [] }));
      }
      if (bare.endsWith("/members") && bare.startsWith("/api/channels/")) {
        return Promise.resolve(ok(roster));
      }
      if (bare.startsWith(`/api/workspaces/${LINK_SEGMENT}/members/`)) {
        return Promise.resolve(noContent());
      }
      return routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`));
    }
  );
}

const remove = () => screen.queryByRole("button", { name: "Remove" });
const leave = () => screen.queryByRole("button", { name: "Leave" });

async function openRoster(): Promise<void> {
  await openChannelRecord();
  await screen.findByTestId("channel-members");
}

beforeEach(() => {
  apiRequest.mockReset();
  installBridge({ apiRequest });
});

describe("who gets which control", () => {
  it("shows an OWNER Remove on the peer's row and no Leave on their own", async () => {
    serve(atRole("owner"));
    renderHome();
    await openRoster();

    expect(remove()).toBeTruthy();
    // 🔒 An owner is the LAST owner of a link container, so `leaveWorkspace`
    // answers `WORKSPACE_LAST_OWNER`. Offering it would be a dead control.
    expect(leave()).toBeNull();
  });

  it("shows a MEMBER Leave on their own row and nothing on the peer's", async () => {
    // ⚠ ONE POLICY, SHARED WITH THE MEMBERS CONSOLE — `member-policy.ts ›
    // canShowMemberControls` answers "not-admin" here, which is exactly what
    // `removeMember`'s first line answers.
    serve(atRole("member"));
    renderHome();
    await openRoster();

    expect(await screen.findByRole("button", { name: "Leave" })).toBeTruthy();
    expect(remove()).toBeNull();
  });

  it("shows a GUEST neither", async () => {
    // ⚠ Remove is admin+; Leave is hidden on R2/R3's reasoning — a guest's
    // claim link was spent at claim, so the exit is one-way — and the DELETE
    // route's resolver floor 404s them before `leaveWorkspace` is reached.
    serve(atRole("guest"));
    renderHome();
    await openRoster();

    expect(remove()).toBeNull();
    expect(leave()).toBeNull();
    // ⚠ THE ROSTER ITSELF IS NOT GATED — a guest may see who is here.
    expect(screen.getByTestId("channel-members")).toBeTruthy();
  });

  it("shows NEITHER in a personal container", async () => {
    serve(atRole("owner"), SOLO_ROSTER);
    renderHome();
    await openRoster();

    expect(remove()).toBeNull();
    expect(leave()).toBeNull();
  });

  /** 🔒 §8 STALE CACHE — the fixture DELETES the key, and `EMPTY_WORKSPACE_ROLE`
   *  (rank 0) takes both controls off for one paint rather than offering a
   *  membership DELETE nobody read a permission for. */
  it("FAILS CLOSED on a payload cached before `myWorkspaceRole` existed", async () => {
    serve([{ ...staleCachedChannel("myWorkspaceRole"), linkOut: null }]);
    renderHome();
    await openRoster();

    expect(remove()).toBeNull();
    expect(leave()).toBeNull();
  });
});

describe("the write", () => {
  it("confirms first, then DELETEs the container membership", async () => {
    serve(atRole("owner"));
    renderHome();
    await openRoster();

    // ⚠ NOT ONE-CLICK: both acts are membership DELETEs, and the roster's ×
    // precedent is what a confirmation exists to keep out of this file.
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog", { name: /Remove Priya Shah/ });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Remove" }).find((b) => dialog.contains(b))!
    );

    await vi.waitFor(() => {
      expect(
        apiRequest.mock.calls.some(
          ([path, opts]: [string, BridgeRequestOpts?]) =>
            path === `/api/workspaces/${LINK_SEGMENT}/members/user-2` &&
            opts?.method === "DELETE"
        )
      ).toBe(true);
    });
  });

  it("a member's Leave targets their OWN row — the route reads self as a leave", async () => {
    serve(atRole("member"));
    renderHome();
    await openRoster();

    fireEvent.click(await screen.findByRole("button", { name: "Leave" }));
    const dialog = await screen.findByRole("dialog", { name: /Leave/ });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Leave" }).find((b) => dialog.contains(b))!
    );

    await vi.waitFor(() => {
      expect(
        apiRequest.mock.calls.some(
          ([path, opts]: [string, BridgeRequestOpts?]) =>
            path === `/api/workspaces/${LINK_SEGMENT}/members/${USER_ID}` &&
            opts?.method === "DELETE"
        )
      ).toBe(true);
    });
  });
});
