import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import {
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
 * /home → KNOWLEDGE, END TO END THROUGH THE REAL PAGE (plan M3, §5.1–5.3).
 *
 * ⚠ MOUNTED THROUGH `HomePage`, NEVER THE PANEL. Three of the things this file
 * has to prove are properties of the PAGE, not of the component: that the pane
 * token changes when the channel does (§5.1's 150ms wrong-channel flash), that
 * the home workspace arrives from the boot query this page already mounts, and
 * that a channel with no grants still renders. A direct mount would hand the
 * panel static props and pass with every one of those broken.
 *
 * ⚠ THE CHANNEL SURFACE IS STUBBED. The page opens on Chat, so the real
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
  await screen.findByTestId("channel-surface");
  fireEvent.click(screen.getByText("Knowledge"));
}

/** Point the private section at the home workspace. */
async function chooseScope(label: string): Promise<void> {
  fireEvent.click(screen.getByLabelText("Which private knowledge bases"));
  fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(label) }));
}

describe("the three scopes", () => {
  it("splits the container's bases into shared and private-here", async () => {
    renderHome();
    await openKnowledge();

    // Scope A: both grant levels, and the peer's name resolved off `ownerNames`.
    expect(await screen.findByText("Renewals")).toBeInTheDocument();
    expect(screen.getByText("Pricing rules")).toBeInTheDocument();
    expect(screen.getByText(/By Priya Shah/)).toBeInTheDocument();

    // Scope B: mine + private + ungranted. ⚠ The PEER's private base must not
    // appear — a `createdBy` filter dropped by a typo passes without this.
    expect(screen.getByText("Call notes")).toBeInTheDocument();
    expect(screen.queryByText("Priya's drafts")).not.toBeInTheDocument();
    // ⚠ Mine and ungranted, but PUBLIC to the container: it belongs to neither
    // section. Scope B is not "everything the grant map didn't claim".
    expect(screen.queryByText("Team playbook")).not.toBeInTheDocument();

    // Scope C's base belongs to another workspace and is not fetched yet.
    expect(screen.queryByText("Fundraise memos")).not.toBeInTheDocument();
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

  it("swaps to the home workspace when the scope pill moves", async () => {
    renderHome();
    await openKnowledge();
    await screen.findByText("Call notes");

    await chooseScope("across all channels");

    expect(await screen.findByText("Fundraise memos")).toBeInTheDocument();
    // The container's private base is gone; the SHARED section is untouched by
    // the pill — it is a different question and a different section.
    expect(screen.queryByText("Call notes")).not.toBeInTheDocument();
    expect(screen.getByText("Renewals")).toBeInTheDocument();

    // ⚠ The second read is addressed to the HOME workspace over `opts`, not by
    // path: both scopes hit `/api/knowledge/bases`.
    const kb = bridgeCalls(apiRequest).filter((c) =>
      c.path.startsWith("/api/knowledge/bases")
    );
    expect(kb.some((c) => c.opts.workspaceId === WORKSPACE_ID)).toBe(true);
    expect(
      kb.some(
        (c) =>
          c.opts.workspaceId === LINK_WORKSPACE_ID &&
          c.path.includes(`channelId=${HOME.channels[0].channelId}`)
      )
    ).toBe(true);
  });

  it("holds the scope pill inert while the scope it named is in flight", async () => {
    // ⚠ The read is held OPEN — the only way to assert anything about the
    // window a second click would land in (§8 rule 8).
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    apiRequest.mockImplementation(
      async (path: string, opts: BridgeRequestOpts = {}) => {
        if (
          path.split("?")[0] === "/api/knowledge/bases" &&
          opts.workspaceId === WORKSPACE_ID
        ) {
          await held;
        }
        return routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`));
      }
    );
    renderHome();
    await openKnowledge();
    await screen.findByText("Call notes");

    await chooseScope("across all channels");

    const pill = screen.getByLabelText("Which private knowledge bases");
    await waitFor(() =>
      expect(pill.closest("[data-pending]")).not.toBeNull()
    );

    release();
    await screen.findByText("Fundraise memos");
    expect(pill.closest("[data-pending]")).toBeNull();
  });

  it("states each empty scope in its OWN words", async () => {
    apiRequest.mockImplementation(
      (path: string, opts: BridgeRequestOpts = {}) =>
        path.split("?")[0] === "/api/knowledge/bases"
          ? Promise.resolve(ok(empty()))
          : (routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`)))
    );
    renderHome();
    await openKnowledge();

    expect(
      await screen.findByText("Nothing is shared into this channel yet.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("You haven't created a private base in this channel.")
    ).toBeInTheDocument();

    await chooseScope("across all channels");
    expect(
      await screen.findByText("You have no private bases in your workspace.")
    ).toBeInTheDocument();
    // Three sentences, three states — the container's own emptiness still reads
    // differently from the workspace's.
    expect(
      screen.queryByText("You haven't created a private base in this channel.")
    ).not.toBeInTheDocument();
  });
});

describe("the pane token", () => {
  it("crossfades on a channel switch and never swaps data under a frozen token", async () => {
    const second = { ...HOME.channels[0], workspaceId: OTHER_WS, workspaceSegment: "link-dana-bb22", channelId: OTHER_CHANNEL, name: "Dana Ruiz", peer: null, linkOut: null };
    const two: HomeChannelsPayload = {
      channels: [HOME.channels[0], second],
      pendingLinks: [],
    };
    apiRequest.mockImplementation(
      (path: string, opts: BridgeRequestOpts = {}): Promise<BridgeResponse> => {
        const bare = path.split("?")[0];
        if (bare === "/api/home/channels") return Promise.resolve(ok(two));
        if (bare === "/api/knowledge/bases") {
          // The SECOND channel's container answers with its own base and no
          // grants — so a pane rendering the wrong channel is visible as data,
          // not merely as a token.
          return opts.workspaceId === OTHER_WS
            ? Promise.resolve(ok({ ...empty(), bases: [OTHER_BASE] }))
            : knowledgeBases(opts);
        }
        return routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`));
      }
    );

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
});

describe("§8 stale cache", () => {
  it("renders a payload written before channelGrants existed", async () => {
    apiRequest.mockImplementation(
      (path: string, opts: BridgeRequestOpts = {}) => {
        if (path.split("?")[0] === "/api/knowledge/bases") {
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

    // Nothing throws, the pane paints, and "no grants" is what it says — the
    // shared section reads empty while the private one still lists its base.
    // ⚠ Waited on a base, not on the empty sentence: the pane holds its
    // skeleton until the read lands, so an assertion on the empty state alone
    // would pass against a payload that never arrived.
    expect(await screen.findByText("Call notes")).toBeInTheDocument();
    expect(
      screen.getByText("Nothing is shared into this channel yet.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Agent only")).not.toBeInTheDocument();
  });

  it("offers no home scope, and asks for no home bases, when boot has no workspace", async () => {
    apiRequest.mockImplementation(
      (path: string, opts: BridgeRequestOpts = {}) =>
        path === "/api/boot"
          ? Promise.resolve(
              // ⚠ Not onboarded: `POST /api/boot` answers `workspace: null`
              // (plan §0.1), and scope C has nowhere to look.
              ok(bootBody({ workspace: null, segment: null, role: null }))
            )
          : (routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`)))
    );
    renderHome();
    await openKnowledge();
    await screen.findByText("Call notes");

    await chooseScope("across all channels");
    expect(
      await screen.findByText(
        "Finish setting up your workspace to keep bases here."
      )
    ).toBeInTheDocument();
    expect(
      bridgeCalls(apiRequest).filter(
        (c) =>
          c.path.startsWith("/api/knowledge/bases") && c.opts.workspaceId === undefined
      )
    ).toHaveLength(0);
  });
});

describe("creating", () => {
  it("follows the scope dropdown into the workspace it names", async () => {
    renderHome();
    await openKnowledge();
    await screen.findByText("Call notes");

    fireEvent.click(screen.getByRole("button", { name: /New knowledge base/ }));
    fireEvent.change(await screen.findByPlaceholderText("e.g. Product specs"), {
      target: { value: "Handover" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    // RULING 6: "in this channel" is the default scope, so the POST is
    // addressed to the CONTAINER, never to the caller's own workspace.
    await waitFor(() => {
      const post = bridgeCalls(apiRequest).find(
        (c) => c.path === "/api/knowledge/bases" && c.opts.method === "POST"
      );
      expect(post?.opts.workspaceId).toBe(LINK_WORKSPACE_ID);
    });
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

/** A base list with nothing in it — every scope's empty state at once. */
function empty(): KnowledgeBaseList {
  return { ...HOME_BASES, bases: [], ownerNames: {}, channelGrants: {} };
}
