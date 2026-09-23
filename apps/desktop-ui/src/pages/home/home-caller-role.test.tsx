import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import { installBridge, ok } from "#/test-utils/bridge";
import { EMPTY_INFO_CARD } from "@/features/channels/info-card";
import type { Role } from "@/features/workspaces/types";
import type { Channel } from "@/features/channels/types";
import { identityRoutes, openIdentities } from "./identity-test-fixtures";
import {
  CHANNEL,
  HOME,
  isAccountChannels,
  openChannelRecord,
  renderHome,
  staleCachedChannel,
} from "./home-test-harness";

/**
 * **F-343 — /home TELLS A MEMBER FROM A GUEST** (Samuel, 2026-09-17: proceed).
 *
 * The account surface carried no caller role: `GET /api/channels?scope=account` did not
 * send one and `knowledge-panels.tsx` hardcoded `role: "owner"` under the comment
 * *"a home container is the caller's own"* — **true of the container the caller
 * CREATED and false of every one they JOINED**, where a bound claim seats them at
 * the link's `granted_role` (default `guest`, ceiling `member`). So every
 * role-shaped affordance on this page was a guess, and two of them were live
 * buttons that 403'd.
 *
 * ⚠ **WHAT THIS SUITE PINS IS THE PICTURE, NEVER THE FENCE.** Every write named
 * below is refused server-side today and still is — `POST /api/knowledge/bases`
 * and `POST /api/agent-identities` at `minRole: "member"`, `mintContainerLink` at
 * `member` plus grant-above-self, `canManageChannel` for the header lines. What
 * changed is that /home stops OFFERING what the server will refuse (INVARIANTS
 * §5's dead-control rule). **A green case here is not evidence a floor may move.**
 *
 * ⚠ **FOUR SURFACES, ONE FIELD, SO ONE FILE.** Add person, the header's
 * click-to-edit, the Knowledge face's shared create and the Agents face's shared
 * create are three panes and two faces, and splitting them by pane would put the
 * same fixture in three suites — which is how three of them come to disagree
 * about what a guest sees.
 *
 * ⚠ MOUNTED THROUGH `HomePage`, never a component: the role arrives on the
 * `/api/channels?scope=account` payload this page reads, so a direct mount would hand each
 * pane a static prop and pass while the projection was broken.
 */

const apiRequest = vi.hoisted(() => vi.fn());

// ⚠ THE SHARED SLOT STUB (`surface-slot-fixtures.tsx`) — it forwards the REAL
// `role` prop into the same `canEdit` expression the surface uses
// (`surface-info-panel.tsx`), so a suite changes the ANSWER by changing the
// fixture rather than by changing the stub. A hand-written stub here would pass
// with the wiring this file exists to pin still missing.
vi.mock("@/features/channels/components/channel-surface-standalone", async () =>
  (await import("./surface-slot-fixtures")).standaloneSurfaceStub()
);

/**
 * THE CHANNEL ROW AS A CLAIMED PEER REALLY HOLDS IT.
 *
 * ⚠ `role: "member"` IS THE CHANNEL ROLE, NOT THE CONTAINER'S — `addMember`
 * seats every claimer at `member` in `channel_members`
 * (`channels/server/service-writes-members.ts`), and only the creator is the
 * channel's `owner`. The harness fixture is the CREATOR's copy, so a case about
 * anybody else has to say so or `canEdit`'s first clause answers for it.
 * ⚠ `isDirect: false` for the reason `home-info-edit.test.tsx` gives: the
 * tab keeps the workspace rule that only a channel whose name is STORED opens.
 */
const PEER_CHANNEL = {
  ...CHANNEL,
  role: "member" as const,
  isDirect: false,
  infoCard: EMPTY_INFO_CARD,
};

/** Serve /home with `channels` as the payload — everything else routes normally.
 *  ⚠ `identityRoutes` rather than `routes`: it answers the identity lists this file
 *  needs for the Agents face and falls through to the harness table for the rest. */
function serve(channels: Channel[]): void {
  apiRequest.mockImplementation(
    (path: string, opts: BridgeRequestOpts = {}): Promise<BridgeResponse> => {
      const bare = path.split("?")[0];
      if (isAccountChannels(path)) {
        return Promise.resolve(ok({ channels, pendingLinks: [] }));
      }
      if (bare === "/api/channels") {
        return Promise.resolve(ok({ channels: [PEER_CHANNEL] }));
      }
      return identityRoutes(path, opts);
    }
  );
}

/** The default channel at one container role, with no invitation out — the
 *  Add-person state (a `linkOut` swaps the section for the Link out panel). */
function atRole(role: Role): Channel[] {
  // ⚠ **THE WORKSPACE ROLE, NOT `Channel.role`** — the CHANNEL role is a second
  // ladder with no `guest` rung, and every control this suite pins is floored on
  // the workspace one (`types-list.ts › myWorkspaceRole`).
  return [{ ...HOME.channels[0], myWorkspaceRole: role, linkOut: null }];
}

/** The Knowledge / Agents face's SHARED section create, reached through its
 *  region: both faces' two buttons carry one label each on purpose, so the
 *  SECTION is the only thing that tells them apart (Samuel, 2026-09-09). */
function sharedCreate(label: string): HTMLElement | null {
  return within(
    screen.getByRole("region", { name: "Shared in this channel" })
  ).queryByRole("button", { name: label });
}

/** Open the Knowledge face through the header's real `SegmentedControl`. */
async function openKnowledge(): Promise<void> {
  await screen.findByRole("tab", { name: "Overview" });
  fireEvent.click(screen.getByText("Knowledge"));
}

const addPerson = () => screen.queryByRole("button", { name: "Add person" });
const nameEditor = () =>
  screen.queryByRole("button", { name: "Edit Channel name" });

beforeEach(() => {
  apiRequest.mockReset();
  installBridge({ apiRequest });
});

describe("the Info tab's two role-shaped controls", () => {
  it("shows a GUEST neither Add person nor the header editor", async () => {
    // 🔒 A guest is somebody ANOTHER person let in. `mintContainerLink` refuses
    // below `member` with `LINK_MINT_FORBIDDEN` — *"the floor now carries the
    // whole case on its own"* since the two-member cap came off — and
    // `canManageChannel` refuses the rename. Both clicks were 403s.
    serve(atRole("guest"));
    renderHome();
    await openChannelRecord();
    await screen.findByTestId("channel-members");

    expect(addPerson()).toBeNull();
    expect(nameEditor()).toBeNull();
    // ⚠ THE ROSTER ITSELF IS NOT GATED. A guest belongs in this channel and may
    // see who else is in it; what they may not do is change it.
    expect(screen.getByTestId("channel-members")).toBeTruthy();
  });

  it("shows a MEMBER Add person, and STILL no header editor — the server's own pair", async () => {
    // ⚠ TWO DIFFERENT FLOORS, AND THAT IS THE POINT OF CARRYING A ROLE RATHER
    // THAN A BOOLEAN: minting a link is `member`+, renaming the channel is
    // channel-owner OR workspace-admin+ (`service-shared.ts › canManageChannel`).
    // A `canManage`-shaped flag on the payload could not have said both.
    serve(atRole("member"));
    renderHome();
    await openChannelRecord();

    expect(await screen.findByRole("button", { name: "Add person" })).toBeTruthy();
    expect(nameEditor()).toBeNull();
  });

  it("shows an OWNER both", async () => {
    serve(atRole("owner"));
    renderHome();
    await openChannelRecord();

    expect(await screen.findByRole("button", { name: "Add person" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Edit Channel name" })).toBeTruthy();
  });

  /**
   * 🔒 **§8 STALE CACHE — THE FIXTURE HAS THE KEY DELETED, not `null` and not
   * `{}`** (INVARIANTS §8: a stale entry does not carry the key at all, and both
   * of those spellings pass a `??` that a missing key would also pass while
   * proving nothing about the shape that ships).
   *
   * ⚠ **THE DIRECTION IS THE RULING, AND F-343 FILED IT AS CONTESTED.**
   * `?? EMPTY_ROLE` is rank 0, so an entry written by the previous bundle renders
   * DISPLAY-ONLY for one paint — a member briefly loses two buttons and gets them
   * back on the next read. The other direction keeps today's buttons and has this
   * surface assert a permission nobody read, which is the defect itself.
   */
  it("FAILS CLOSED on a payload cached before the field existed", async () => {
    serve([{ ...staleCachedChannel("myWorkspaceRole"), linkOut: null }]);
    renderHome();
    await openChannelRecord();
    await screen.findByTestId("channel-members");

    expect(addPerson()).toBeNull();
    expect(nameEditor()).toBeNull();
  });
});

describe("the Knowledge face's shared create (F-343 consequence 1)", () => {
  it("is GONE for a guest — `POST /api/knowledge/bases` is member+", async () => {
    serve(atRole("guest"));
    renderHome();
    await openKnowledge();
    await screen.findByRole("region", { name: "Shared in this channel" });

    expect(sharedCreate("Knowledge base")).toBeNull();
    // ⚠ PERSONAL IS UNTOUCHED: it writes to the caller's OWN home workspace, at
    // boot's real membership role, and a guest in somebody's channel is not a
    // guest on their own shelf. Gating it on the container's role would take a
    // capability away over an unrelated fact.
    expect(
      within(screen.getByRole("region", { name: "Personal" })).getByRole("button", {
        name: "Knowledge base",
      })
    ).toBeTruthy();
  });

  it("is THERE for a member", async () => {
    serve(atRole("member"));
    renderHome();
    await openKnowledge();
    await screen.findByRole("region", { name: "Shared in this channel" });

    expect(sharedCreate("Knowledge base")).toBeTruthy();
  });

  it("FAILS CLOSED on a stale cached payload", async () => {
    serve([{ ...staleCachedChannel("myWorkspaceRole"), linkOut: null }]);
    renderHome();
    await openKnowledge();
    await screen.findByRole("region", { name: "Shared in this channel" });

    expect(sharedCreate("Knowledge base")).toBeNull();
  });
});

describe("the Agents face's shared create (F-343 consequence 1b)", () => {
  it("is GONE for a guest — `POST /api/agent-identities` is member+", async () => {
    serve(atRole("guest"));
    renderHome();
    await openIdentities();
    await screen.findByRole("region", { name: "Shared in this channel" });

    expect(sharedCreate("Agent Identity")).toBeNull();
  });

  it("is THERE for a member", async () => {
    serve(atRole("member"));
    renderHome();
    await openIdentities();
    await screen.findByRole("region", { name: "Shared in this channel" });

    expect(sharedCreate("Agent Identity")).toBeTruthy();
  });

  it("FAILS CLOSED on a stale cached payload", async () => {
    serve([{ ...staleCachedChannel("myWorkspaceRole"), linkOut: null }]);
    renderHome();
    await openIdentities();
    await screen.findByRole("region", { name: "Shared in this channel" });

    expect(sharedCreate("Agent Identity")).toBeNull();
  });
});
