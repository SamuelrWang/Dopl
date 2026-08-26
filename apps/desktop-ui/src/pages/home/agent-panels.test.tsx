import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import { WORKSPACE_ID, bootBody, installBridge, ok } from "#/test-utils/bridge";
import type { HomeChannelsPayload } from "@/features/home/types";
import { HOME, LINK_WORKSPACE_ID, renderHome } from "./home-test-harness";
import {
  DANA_TEMPLATE,
  OTHER_WS,
  agentRoutes,
  chooseScope,
  openAgents,
  templateCalls as calls,
} from "./agent-test-fixtures";

/**
 * /home → AGENTS, END TO END THROUGH THE REAL PAGE (plan M2, §1–§4).
 *
 * ⚠ MOUNTED THROUGH `HomePage`, NEVER THE PANEL — the same reason
 * `knowledge-panels.test.tsx` gives. Three of the things here are properties of
 * the PAGE: that the pane token moves when the channel does (§4.1's wrong-channel
 * flash), that the home workspace arrives from the boot query this page already
 * mounts, and that a container with no templates still paints. A direct mount
 * would hand the panel static props and pass with every one of those broken.
 *
 * ⚠ THE CHANNEL SURFACE IS STUBBED. The page opens on Chat, so the real
 * channels-v2 surface would mount (and fetch) before a single Agents assertion
 * ran. `vi.mock` is hoisted per file and its factory may not close over imports
 * — hence a local stub rather than one in the harness. It ALSO removes the
 * second thing on this page called "Agents" (the info column's live-session
 * tab, Q6), so the header selector is unambiguous.
 *
 * ⚠ THE FIXTURES AND THE ROUTING TABLE ARE IN `agent-test-fixtures.ts`, shared
 * with `agent-authoring.test.tsx` — one `T_HOME`, because this face's whole
 * hazard is two workspaces being mistaken for each other (F-331) and two copies
 * of the fixtures is how two suites come to disagree about which is which.
 *
 * ⚠ THE NO-CONCAVE SWEEP IS NOT MIRRORED HERE, and it did not need to be. The
 * SPA is a separate vitest project, but the sweep is a `readFileSync` over
 * SOURCE — not an import — and the root project runs with `process.cwd()` at
 * the repo root, so `agent-templates/components/template-editor.test.tsx ›
 * no concave surfaces › HOME_FILES` reads these two files directly. One sweep,
 * one list of forbidden recipes; a mirrored copy is how the two come to forbid
 * different things.
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
  apiRequest.mockImplementation(defaultRoutes);
  installBridge({ apiRequest });
});

/** The template-list calls, split by which workspace they addressed. */
const templateCalls = (workspaceId: string | undefined) =>
  calls(apiRequest, workspaceId);

describe("the three scopes", () => {
  it("splits the container's templates into shared and private-here", async () => {
    renderHome();
    await openAgents();

    // Scope A: the workspace-visible rows, mine and the peer's.
    expect(await screen.findByText("Renewal chaser")).toBeInTheDocument();
    expect(screen.getByText("Priya's intake bot")).toBeInTheDocument();

    // Scope B: mine + private. ⚠ The PEER's private row must not appear — a
    // `createdBy` filter dropped by a typo passes without this.
    expect(screen.getByText("Scratch agent")).toBeInTheDocument();
    expect(screen.queryByText("Priya's drafts bot")).not.toBeInTheDocument();

    // Scope C's template belongs to another workspace and is not fetched yet.
    expect(screen.queryByText("Fundraise analyst")).not.toBeInTheDocument();
  });

  it("marks a template the operator did not write, and leaves their own bare", async () => {
    renderHome();
    await openAgents();
    await screen.findByText("Renewal chaser");

    // ⚠ The marker is a SECURITY signal, so the assertion is that exactly one
    // card carries it and it is the PEER's — not merely that the words are on
    // screen. The name is resolved off the channel's peer, which costs no read.
    const markers = screen.getAllByText("by Priya Shah");
    expect(markers).toHaveLength(1);
    const card = markers[0].parentElement;
    expect(card?.textContent).toContain("Priya's intake bot");
    expect(card?.textContent).not.toContain("Renewal chaser");
  });

  it("drops a `team` row instead of filing it under a section", async () => {
    renderHome();
    await openAgents();
    await screen.findByText("Renewal chaser");

    // ⚠ `team` is a DEAD value in a container (no teams exist there), and the
    // failure mode this pins is the SILENT one: a grouping that swept it into
    // Private or Shared would show the operator a sharing scope that resolves
    // to nobody.
    expect(screen.queryByText("Team ops bot")).not.toBeInTheDocument();
    await chooseScope("across all channels");
    await screen.findByText("Fundraise analyst");
    expect(screen.queryByText("Team ops bot")).not.toBeInTheDocument();
  });

  it("swaps to the home workspace when the scope pill moves", async () => {
    renderHome();
    await openAgents();
    await screen.findByText("Scratch agent");

    // 🔒 SCOPE C IS NOT FETCHED UNTIL THE PILL ASKS. Asserted BEFORE the click,
    // because after it the call exists and nothing distinguishes lazy from
    // eager.
    expect(templateCalls(WORKSPACE_ID)).toHaveLength(0);
    expect(templateCalls(LINK_WORKSPACE_ID).length).toBeGreaterThan(0);

    await chooseScope("across all channels");

    expect(await screen.findByText("Fundraise analyst")).toBeInTheDocument();
    expect(templateCalls(WORKSPACE_ID)).toHaveLength(1);
    // The container's private row is gone; the SHARED section is untouched by
    // the pill — it is a different question and a different section.
    expect(screen.queryByText("Scratch agent")).not.toBeInTheDocument();
    expect(screen.getByText("Renewal chaser")).toBeInTheDocument();
  });

  it("holds the scope pill inert while the scope it named is in flight", async () => {
    // ⚠ The read is held OPEN — the only way to assert anything about the
    // window a second click would land in (INVARIANTS §8 rule 8).
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    apiRequest.mockImplementation(
      async (path: string, opts: BridgeRequestOpts = {}) => {
        if (
          path.split("?")[0] === "/api/agent-templates" &&
          opts.workspaceId === WORKSPACE_ID
        ) {
          await held;
        }
        return defaultRoutes(path, opts);
      }
    );
    renderHome();
    await openAgents();
    await screen.findByText("Scratch agent");

    await chooseScope("across all channels");

    const pill = screen.getByLabelText("Which private agents");
    await waitFor(() => expect(pill.closest("[data-pending]")).not.toBeNull());

    release();
    await screen.findByText("Fundraise analyst");
    expect(pill.closest("[data-pending]")).toBeNull();
  });
});

describe("empty scopes", () => {
  it("states each one in its OWN words", async () => {
    apiRequest.mockImplementation((path: string, opts: BridgeRequestOpts = {}) =>
      path.split("?")[0] === "/api/agent-templates"
        ? Promise.resolve(ok({ templates: [] }))
        : defaultRoutes(path, opts)
    );
    renderHome();
    await openAgents();

    expect(
      await screen.findByText("No agent is shared into this channel yet.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("You haven't created an agent in this channel.")
    ).toBeInTheDocument();

    await chooseScope("across all channels");
    expect(
      await screen.findByText("You have no private agents in your own workspace.")
    ).toBeInTheDocument();
    // Three sentences, three states — the container's own emptiness still reads
    // differently from the workspace's.
    expect(
      screen.queryByText("You haven't created an agent in this channel.")
    ).not.toBeInTheDocument();
  });

  it("offers no home scope, and asks for no home templates, when boot has no workspace", async () => {
    apiRequest.mockImplementation((path: string, opts: BridgeRequestOpts = {}) =>
      path === "/api/boot"
        ? Promise.resolve(
            // ⚠ Not onboarded: `POST /api/boot` answers `workspace: null` and
            // scope C has nowhere to look. UNAVAILABLE, not EMPTY.
            ok(bootBody({ workspace: null, segment: null, role: null }))
          )
        : defaultRoutes(path, opts)
    );
    renderHome();
    await openAgents();
    await screen.findByText("Scratch agent");

    await chooseScope("across all channels");
    expect(
      await screen.findByText(
        "Finish setting up your workspace to keep agents there."
      )
    ).toBeInTheDocument();
    expect(templateCalls(undefined)).toHaveLength(0);
  });
});

describe("the pane token", () => {
  it("crossfades on a channel switch and never swaps data under a frozen token", async () => {
    const second = {
      ...HOME.channels[0],
      workspaceId: OTHER_WS,
      workspaceSegment: "link-dana-bb22",
      channelId: "chan-2",
      name: "Dana Ruiz",
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
        if (bare === "/api/agent-templates" && opts.workspaceId === OTHER_WS) {
          // The SECOND channel's container answers with its own template — so a
          // pane rendering the wrong channel is visible as DATA, not merely as
          // a token.
          return Promise.resolve(ok({ templates: [DANA_TEMPLATE] }));
        }
        return defaultRoutes(path, opts);
      }
    );

    const { view } = renderHome();
    await openAgents();
    await screen.findByText("Renewal chaser");

    fireEvent.click(screen.getByText("Dana Ruiz"));

    // 🔒 THE PIN, BOTH HALVES — either one alone stays green against the
    // other's bug. Keyed by the bare TAB the token does not move when the
    // channel does: no fade starts, and the pane re-renders instantly with the
    // new channel's templates under a token asserting nothing changed.
    expect(view.container.querySelector(".crossfade[data-out]")).not.toBeNull();
    expect(screen.getByText("Renewal chaser")).toBeInTheDocument();

    // …and once the fade completes the new channel's templates are on screen.
    // ⚠ `findBy`, not `getBy`: `Crossfade` keeps the outgoing subtree mounted
    // for its 150ms, so the incoming one is not in the DOM yet.
    expect(await screen.findByText("Dana's assistant")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Renewal chaser")).not.toBeInTheDocument()
    );
  });
});

describe("what this pane deliberately leaves out", () => {
  it("offers no launch control — the Chat face's picker is the one launch surface", async () => {
    renderHome();
    await openAgents();
    await screen.findByText("Renewal chaser");

    // ⚠ SCOPED TO THE PANELS, not to the document: /home's own empty states say
    // "launch an agent into it" and the header has its own controls, so a
    // page-wide sweep would be measuring the wrong surface.
    // ⚠ WORD-BOUNDARY regexes — "Renewal" contains "ewa", "Runbooks" contains
    // "run"; a loose /run/i would fail on a template NAME and prove nothing.
    const panels = screen.getAllByRole("region");
    expect(panels.length).toBe(2);
    for (const panel of panels) {
      expect(panel.textContent).not.toMatch(/\blaunch\b/i);
      expect(panel.textContent).not.toMatch(/\brun\b/i);
      expect(within(panel).queryByRole("button", { name: /launch|run|start/i })).toBeNull();
    }
  });
});

const defaultRoutes = agentRoutes;
