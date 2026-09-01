import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import {
  SEGMENT,
  USER_ID,
  WORKSPACE_ID,
  bootBody,
  bridgeCalls,
  installBridge,
  ok,
} from "#/test-utils/bridge";
import type { HomeChannelsPayload } from "@/features/home/types";
import type { KnowledgeBaseList } from "@/features/knowledge/client/api";
import {
  CONTAINER_BASES,
  HOME,
  HOME_BASES,
  LINK_WORKSPACE_ID,
  knowledgeBases,
  renderHome,
  routes,
} from "./home-test-harness";

/**
 * /home → KNOWLEDGE, END TO END THROUGH THE REAL PAGE.
 *
 * ⚠ TWO SECTIONS, NO PILL (Samuel's ruling 2026-08-27). This file was written
 * against THREE scopes behind a `SelectMenu`; every assertion that drove that
 * pill is gone, and the per-channel private scope it selected is gone with it.
 * The shelf's own suite is `knowledge-panels-shelf.test.tsx`.
 *
 * ⚠ MOUNTED THROUGH `HomePage`, NEVER THE PANEL. Three of the things this file
 * has to prove are properties of the PAGE, not of the component: that the pane
 * token changes when the channel does (§5.1's 150ms wrong-channel flash), that
 * the home workspace arrives from the boot query this page already mounts, and
 * that a channel with no grants still renders. A direct mount would hand the
 * panel static props and pass with every one of those broken.
 *
 * ⚠ THE CHANNEL SURFACE IS STUBBED. The page opens on Channels, so the real
 * channels-v2 surface would mount (and fetch) before a single Knowledge
 * assertion ran. `vi.mock` is hoisted per file and its factory may not close
 * over imports — hence a local stub rather than one in the harness.
 */

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock(
  "@/features/channels/components/channels-v2/channel-surface-standalone",
  () => ({
    StandaloneChannelSurface: () => <div data-testid="channel-surface" />,
  })
);

beforeEach(() => {
  apiRequest.mockReset();
  apiRequest.mockImplementation(
    (path: string, opts: BridgeRequestOpts = {}) =>
      routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`))
  );
  installBridge({ apiRequest });
});

/** Open the Knowledge face. The selector is the page header's `SegmentedControl`
 *  — the same control the operator clicks, so nothing here bypasses the token. */
async function openKnowledge(): Promise<void> {
  // ⚠ GATES ON THE TAB ROW, NOT ON THE RECORD PANE (2026-09-01) — the page
  // opens on Overview now, which mounts no surface.
  await screen.findByRole("tab", { name: "Overview" });
  fireEvent.click(screen.getByText("Knowledge"));
}

describe("the two sections", () => {
  it("fills SHARED from grants alone, and PERSONAL from the home shelf", async () => {
    renderHome();
    await openKnowledge();

    // SHARED: both grant levels, and the peer's name resolved off `ownerNames`.
    expect(await screen.findByText("Renewals")).toBeInTheDocument();
    expect(screen.getByText("Pricing rules")).toBeInTheDocument();
    expect(screen.getByText(/By Priya Shah/)).toBeInTheDocument();
    // PERSONAL: the home shelf, loaded with no pill to open.
    expect(await screen.findByText("Fundraise memos")).toBeInTheDocument();
  });

  it("🔒 shows NO container base that lacks a grant — the removed private scope", async () => {
    // 🔒 SAMUEL'S RULING, 2026-08-27, AND THIS IS THE CONSEQUENCE HE ACCEPTED.
    // `Call notes` is private, ungranted, the caller's own, and sits in this
    // channel's container — it was the whole of the old scope B. With that scope
    // deleted, **a container base reaches /home only through a channel grant**
    // (INVARIANTS §5A). It must appear in NEITHER section.
    // ⚠ The other two are the fixtures that were never in scope B either, kept
    // so this asserts the RULE and not merely the one row: a PEER's private base
    // (a `createdBy` filter dropped by a typo), and a base that is mine and
    // ungranted but PUBLIC to the container.
    renderHome();
    await openKnowledge();
    await screen.findByText("Renewals");

    expect(screen.queryByText("Call notes")).not.toBeInTheDocument();
    expect(screen.queryByText("Priya's drafts")).not.toBeInTheDocument();
    expect(screen.queryByText("Team playbook")).not.toBeInTheDocument();
  });

  it("badges an agent_only grant and leaves a visible one bare", async () => {
    renderHome();
    await openKnowledge();
    await screen.findByText("Pricing rules");

    // The caption pill lives in the agent_only card's CELL, so the assertion is
    // that exactly one card carries it — not merely that the words are on screen.
    const badges = screen.getAllByText("Agent only");
    expect(badges).toHaveLength(1);
    const cell = badges[0].parentElement;
    expect(cell?.textContent).toContain("Pricing rules");
    expect(cell?.textContent).not.toContain("Renewals");
  });

  it("asks BOTH reads on first paint, each addressed to its own workspace", async () => {
    // ⚠ The workspace rides `opts` and the SHELF rides the path — two axes, and
    // the pane needs both; every read hits `/api/knowledge/bases`.
    // ⚠ NO LONGER LAZY: the home read was gated on the pill until 2026-08-27.
    // Personal is always on screen now, so a deferred read would be a
    // guaranteed second round trip rather than a saving.
    renderHome();
    await openKnowledge();
    await screen.findByText("Fundraise memos");

    const kb = bridgeCalls(apiRequest).filter(
      (c) => c.path.split("?")[0] === "/api/knowledge/bases"
    );
    expect(
      kb.some(
        (c) => c.opts.workspaceId === WORKSPACE_ID && c.path.includes("shelf=home")
      )
    ).toBe(true);
    expect(
      kb.some(
        (c) =>
          c.opts.workspaceId === LINK_WORKSPACE_ID &&
          c.path.includes(`channelId=${HOME.channels[0].channelId}`)
      )
    ).toBe(true);
  });

  it("states each empty section in its OWN words", async () => {
    apiRequest.mockImplementation(
      (path: string, opts: BridgeRequestOpts = {}) =>
        path.split("?")[0] === "/api/knowledge/bases"
          ? Promise.resolve(ok(empty()))
          : (routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`)))
    );
    renderHome();
    await openKnowledge();

    // Two sentences, two states, on screen AT THE SAME TIME — which is the part
    // the pill made impossible to assert.
    expect(
      await screen.findByText("Nothing is shared into this channel yet.")
    ).toBeInTheDocument();
    expect(
      await screen.findByText("You haven't created a private base here yet.")
    ).toBeInTheDocument();
  });
});

describe("the pane token", () => {
  it("crossfades on a channel switch and never swaps data under a frozen token", async () => {
    installTwoChannels();
    const { view } = renderHome();
    await openKnowledge();
    await screen.findByText("Renewals");

    fireEvent.click(screen.getByText("Dana Ruiz"));

    // 🔒 THE PIN. Keyed by the TAB, the token does not move when the channel
    // does: no fade starts, and the pane re-renders instantly with the new
    // channel's data. Both halves are asserted, because either one alone stays
    // green against the other's bug.
    expect(view.container.querySelector(".crossfade[data-out]")).not.toBeNull();
    expect(screen.getByText("Renewals")).toBeInTheDocument();

    // …and once the fade completes the new channel's knowledge is on screen.
    expect(await screen.findByText("Dana's shelf")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Renewals")).not.toBeInTheDocument()
    );
  });

  it("🔒 an OPEN base does not survive a channel switch", async () => {
    // 🔒 THE PANE IS KEYED BY THE ROW (index.tsx), and it was not until
    // 2026-08-26. `paneToken` fixes the CROSSFADE and does not remount, so React
    // reconciled channel B's props onto channel A's instance and the pane's own
    // `useState` survived: `openBase` stayed set, and the base was then mounted
    // against channel B's `workspaceId` — a 404 error pane over a base that
    // exists. `knowledge-tab.tsx` had already solved this on the channel side.
    installTwoChannels();
    renderHome();
    await openKnowledge();

    // Open channel A's SHARED base — since 2026-08-27 that is the only kind of
    // container base this pane offers. The section header disappears with the
    // grid, which is how the detail view announces itself without depending on
    // its chrome.
    fireEvent.click(await screen.findByText("Renewals"));
    await waitFor(() =>
      expect(
        screen.queryByText("Shared in this channel")
      ).not.toBeInTheDocument()
    );

    fireEvent.click(screen.getByText("Dana Ruiz"));

    // 🔒 THE PIN: channel B renders its LIST, not channel A's open base.
    expect(await screen.findByText("Dana's shelf")).toBeInTheDocument();
    expect(screen.getByText("Shared in this channel")).toBeInTheDocument();
    // …and no error pane, which is what the cross-workspace mount produced.
    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
  });
});

describe("§8 stale cache", () => {
  /**
   * ⚠ WHAT THIS BLOCK CAN AND CANNOT REACH, stated because the difference is
   * exactly one function. Every read here goes through `client/api.ts ›
   * fetchBaseList`, which NORMALISES the whole payload on the wire
   * (`ownerNames ?? {}`, `baseStats ?? {}`, `starredBaseIds ?? []`,
   * `channelGrants ?? EMPTY_GRANTS`). So a route fixture with a key deleted
   * pins the WIRE fallback — a pre-deploy SERVER — and can never reach the
   * CACHE fallback, because a payload cached by an older BUNDLE never passes
   * through today's `fetchBaseList` at all. **The cache half is pinned where
   * the cache is read**: `knowledge-panel-cards.test.tsx` renders `BaseCell`
   * against the key-deleted object directly. Both halves are needed; neither
   * covers the other.
   */
  it("renders a payload written before channelGrants existed", async () => {
    apiRequest.mockImplementation(
      (path: string, opts: BridgeRequestOpts = {}) => {
        // ⚠ THE CONTAINER READ ONLY. Stubbing every base-list call would hand
        // the container's fixture to the HOME shelf too, and its private rows
        // would render in Personal — a pass built on the wrong workspace's data.
        if (
          path.split("?")[0] === "/api/knowledge/bases" &&
          opts.workspaceId === LINK_WORKSPACE_ID
        ) {
          // The key is DELETED from the fixture, not set to null or {} — a
          // stale entry does not carry it at all.
          const stale: Record<string, unknown> = { ...CONTAINER_BASES };
          delete stale.channelGrants;
          return Promise.resolve(ok(stale));
        }
        return routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`));
      }
    );
    renderHome();
    await openKnowledge();

    // Nothing throws, the pane paints, and "no grants" is what it says.
    // ⚠ WITH NO GRANTS, EVERY SECTION IS EMPTY — and that is the correct
    // rendering since 2026-08-27, not a degraded one: this fixture's bases live
    // in the CONTAINER, and a container base with no grant belongs nowhere on
    // /home. The pin is that the pane says so instead of throwing.
    expect(
      await screen.findByText("Nothing is shared into this channel yet.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Agent only")).not.toBeInTheDocument();
    expect(screen.queryByText("Call notes")).not.toBeInTheDocument();
  });

  it("offers no Personal shelf, and asks for no home bases, when boot has no workspace", async () => {
    apiRequest.mockImplementation(
      (path: string, opts: BridgeRequestOpts = {}) =>
        path === "/api/boot"
          ? Promise.resolve(
              // ⚠ Not onboarded: `POST /api/boot` answers `workspace: null`
              // (plan §0.1), and the shelf has nowhere to look.
              ok(bootBody({ workspace: null, segment: null, role: null }))
            )
          : (routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`)))
    );
    renderHome();
    await openKnowledge();

    expect(
      await screen.findByText(
        "Finish setting up your workspace to keep bases here."
      )
    ).toBeInTheDocument();
    // ⚠ AND NO UNADDRESSED READ. With no home workspace the query is disabled;
    // a read with no `workspaceId` would auto-target on the server and answer
    // some other workspace's shelf.
    expect(
      bridgeCalls(apiRequest).filter(
        (c) =>
          c.path.startsWith("/api/knowledge/bases") && c.opts.workspaceId === undefined
      )
    ).toHaveLength(0);
  });
});

describe("🔒 the my-access provider — F-330's blast radius, per mount target", () => {
  /**
   * `HomeKnowledgeBaseView` mounts for BOTH targets, and `canEdit` FALLS OPEN
   * with no `MyAccessProvider` (`use-knowledge-v2-trees.ts › canEdit` maps a
   * `null` resolve to `true`, F-330). F-330 shipped saying that was
   * unreachable-to-harm from "the two hosts that exist today" and argued it from
   * link CONTAINERS — where it holds. **The HOME-workspace mount is the second
   * host and it is a real standard workspace that can be teams-mode**, handed
   * the WHOLE base list rather than the private subset the pane offered. So the
   * home target resolves `my-access` and the container target does not.
   *
   * ⚠ MUTATION-VERIFIED: setting `homeTarget.accessSegment` to `null` (or
   * dropping the provider) turns the first assertion red.
   */
  const myAccessCalls = () =>
    bridgeCalls(apiRequest).filter((c) => c.path.endsWith("/my-access"));

  it("🔒 the HOME-workspace mount resolves my-access against its own segment", async () => {
    renderHome();
    await openKnowledge();

    fireEvent.click(await screen.findByText("Fundraise memos"));

    await waitFor(() => expect(myAccessCalls().length).toBeGreaterThan(0));
    expect(myAccessCalls()[0].path).toContain(SEGMENT);
  });

  it("the CONTAINER mount asks for nothing — a container has no teams to resolve", async () => {
    // ⚠ Asserted as an ABSENCE after the base is on screen, so it cannot pass
    // by the read simply not having happened yet.
    renderHome();
    await openKnowledge();

    fireEvent.click(await screen.findByText("Renewals"));
    await waitFor(() =>
      expect(
        screen.queryByText("Shared in this channel")
      ).not.toBeInTheDocument()
    );

    expect(myAccessCalls()).toHaveLength(0);
  });
});

describe("creating", () => {
  /** Type a name into the open dialog and submit it. */
  async function submitCreate(name: string): Promise<void> {
    fireEvent.change(await screen.findByPlaceholderText("e.g. Product specs"), {
      target: { value: name },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
  }

  const lastPost = () =>
    bridgeCalls(apiRequest).find(
      (c) =>
        c.path.split("?")[0] === "/api/knowledge/bases" && c.opts.method === "POST"
    );

  it("the PERSONAL button writes to the home workspace, on the home shelf", async () => {
    renderHome();
    await openKnowledge();
    await screen.findByText("Fundraise memos");

    fireEvent.click(screen.getByRole("button", { name: /New knowledge base/ }));
    await submitCreate("Handover");

    await waitFor(() => {
      const post = lastPost();
      expect(post?.opts.workspaceId).toBe(WORKSPACE_ID);
      // 🔒 BOTH HALVES. A create that landed unmarked would write into the
      // workspace shelf this pane no longer reads — a base that vanishes the
      // moment it is made — and it would look like it worked.
      expect(post?.opts.body).toMatchObject({ homeScoped: true });
      expect(post?.opts.body).not.toHaveProperty("shareToChannelId");
    });
  });

  it("🔒 the SHARED button writes to the CONTAINER and shares in one call", async () => {
    // 🔒 SAMUEL'S RULING, 2026-08-27. The base and the grant are ONE request —
    // the server rolls the base back if the grant fails — because a container
    // base that landed ungranted is invisible on this very surface.
    renderHome();
    await openKnowledge();
    await screen.findByText("Renewals");

    fireEvent.click(screen.getByRole("button", { name: /New shared base/ }));
    await submitCreate("Handover");

    await waitFor(() => {
      const post = lastPost();
      expect(post?.opts.workspaceId).toBe(LINK_WORKSPACE_ID);
      expect(post?.opts.body).toMatchObject({
        shareToChannelId: HOME.channels[0].channelId,
        // ⚠ `private` ON THE WORKSPACE AXIS. The GRANT carries the audience;
        // private + a `visible` grant is exactly "readable in this channel and
        // nowhere else". A `public` container base would also be readable by
        // the peer with no grant at all, which is a different promise.
        visibility: "private",
      });
      expect(post?.opts.body).not.toHaveProperty("homeScoped");
    });
  });

  it("asks the audience question ONCE — NEITHER /home dialog has a scope picker", async () => {
    // ⚠ THE BUTTON IS THE ANSWER, on BOTH branches (Samuel, 2026-08-27). The
    // shared one has a grant that carries the audience; the personal one is the
    // caller's own shelf. A workspace-visibility radio under either would offer
    // a second, contradicting answer — and two of its three options (public,
    // team) name audiences a home surface does not have.
    // ⚠ THIS TEST ASSERTED THE OPPOSITE FOR THE PERSONAL BRANCH until that
    // ruling; the workspace Knowledge page is where the picker still lives, and
    // `create-base-dialog.tsx › Props.audienceFixed` is the scoping.
    renderHome();
    await openKnowledge();
    await screen.findByText("Renewals");

    fireEvent.click(screen.getByRole("button", { name: /New shared base/ }));
    await screen.findByPlaceholderText("e.g. Product specs");
    expect(screen.queryByText("Who can access")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: /New knowledge base/ }));
    await screen.findByPlaceholderText("e.g. Product specs");
    expect(screen.queryByText("Who can access")).not.toBeInTheDocument();
  });
});

const OTHER_WS = "ws-link-2";
const OTHER_CHANNEL = "chan-2";

const OTHER_BASE = {
  ...CONTAINER_BASES.bases[0],
  id: "kb-other-1",
  name: "Dana's shelf",
  workspaceId: OTHER_WS,
  visibility: "private" as const,
  createdBy: USER_ID,
};

/**
 * A second channel in its own container, whose base is GRANTED onto it — so a
 * pane rendering the wrong channel is visible as DATA, not merely as a token.
 * ⚠ The grant is load-bearing since 2026-08-27: an ungranted container base
 * renders nowhere, so without it this fixture would prove nothing.
 */
function installTwoChannels(): void {
  const second = {
    ...HOME.channels[0],
    workspaceId: OTHER_WS,
    workspaceSegment: "link-dana-bb22",
    channelId: OTHER_CHANNEL,
    name: "Dana Ruiz",
    peers: [],
    peer: null,
    linkOut: null,
  };
  const two: HomeChannelsPayload = {
    channels: [HOME.channels[0], second],
    pendingLinks: [],
  };
  apiRequest.mockImplementation(
    (path: string, opts: BridgeRequestOpts = {}): Promise<BridgeResponse> => {
      const bare = path.split("?")[0];
      if (bare === "/api/home/channels") return Promise.resolve(ok(two));
      if (bare === "/api/knowledge/bases") {
        return opts.workspaceId === OTHER_WS
          ? Promise.resolve(
              ok({
                ...empty(),
                bases: [OTHER_BASE],
                channelGrants: {
                  [OTHER_BASE.id]: { level: "visible", guestWrite: false },
                },
              })
            )
          : knowledgeBases(opts, path);
      }
      return routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`));
    }
  );
}

/** A base list with nothing in it — every section's empty state at once. */
function empty(): KnowledgeBaseList {
  return { ...HOME_BASES, bases: [], ownerNames: {}, channelGrants: {} };
}
