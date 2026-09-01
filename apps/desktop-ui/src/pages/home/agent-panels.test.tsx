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
 * ⚠ THE CHANNEL SURFACE IS STUBBED. The page opens on Channels, so the real
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

describe("the two sections", () => {
  it("fills SHARED from the container, and PERSONAL from the home shelf", async () => {
    renderHome();
    await openAgents();

    // SHARED: the workspace-visible container rows, mine and the peer's.
    expect(await screen.findByText("Renewal chaser")).toBeInTheDocument();
    expect(screen.getByText("Priya's intake bot")).toBeInTheDocument();
    // PERSONAL: the home shelf, loaded with no pill to open.
    expect(await screen.findByText("Fundraise analyst")).toBeInTheDocument();
  });

  it("🔒 shows NO container template that is not shared — the removed private scope", async () => {
    // 🔒 SAMUEL'S RULING, 2026-08-27, AND THIS IS THE CONSEQUENCE HE ACCEPTED.
    // `Scratch agent` is private, the caller's own, and sits in this channel's
    // container — the whole of the old scope B. With that scope deleted a
    // container template reaches /home only at `visibility: "workspace"`, and
    // the container editor no longer offers any other value, so no NEW row can
    // land here either.
    // ⚠ The peer's private row rides along so this asserts the RULE and not one
    // row: a `createdBy` filter dropped by a typo passes without it.
    renderHome();
    await openAgents();
    await screen.findByText("Renewal chaser");

    expect(screen.queryByText("Scratch agent")).not.toBeInTheDocument();
    expect(screen.queryByText("Priya's drafts bot")).not.toBeInTheDocument();
  });

  it("🔒 shows only the HOME SHELF in Personal, not the rest of that workspace", async () => {
    // 🔒 `Quarterly reporter` is in the SAME workspace as `Fundraise analyst`,
    // also private, also the caller's own — only `?shelf=home` separates them,
    // and the harness answers BOTH shelves when the param is missing
    // (`agent-test-fixtures.ts › agentTemplates`).
    renderHome();
    await openAgents();

    expect(await screen.findByText("Fundraise analyst")).toBeInTheDocument();
    expect(screen.queryByText("Quarterly reporter")).not.toBeInTheDocument();
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
    await screen.findByText("Fundraise analyst");

    // ⚠ `team` is a DEAD value in a container (no teams exist there), and the
    // failure mode this pins is the SILENT one: a grouping that swept it into a
    // section would show the operator a sharing scope that resolves to nobody.
    // Both reads are on screen at once now, so one assertion covers both.
    expect(screen.queryByText("Team ops bot")).not.toBeInTheDocument();
  });

  it("asks BOTH reads on first paint, each addressed to its own workspace", async () => {
    // ⚠ NO LONGER LAZY: the home read was gated on the pill until 2026-08-27.
    // ⚠ The workspace rides `opts` and the SHELF rides the path — two axes, and
    // Personal needs both.
    renderHome();
    await openAgents();
    await screen.findByText("Fundraise analyst");

    const home = templateCalls(WORKSPACE_ID);
    expect(home.length).toBeGreaterThan(0);
    expect(home.every((c) => c.path.includes("shelf=home"))).toBe(true);
    // The container read carries NO shelf — shelves exist only in a standard
    // workspace, so narrowing a container would be a question with one answer.
    const container = templateCalls(LINK_WORKSPACE_ID);
    expect(container.length).toBeGreaterThan(0);
    expect(container.every((c) => !c.path.includes("shelf="))).toBe(true);
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

    // Two sentences, two states, on screen AT THE SAME TIME — which is the part
    // the pill made impossible to assert.
    expect(
      await screen.findByText("No agent is shared into this channel yet.")
    ).toBeInTheDocument();
    expect(
      await screen.findByText("You haven't created an agent here yet.")
    ).toBeInTheDocument();
  });

  it("offers no Personal shelf, and asks for no home templates, when boot has no workspace", async () => {
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

    expect(
      await screen.findByText(
        "Finish setting up your workspace to keep agents there."
      )
    ).toBeInTheDocument();
    // ⚠ AND NO UNADDRESSED READ. With no home workspace the query is disabled;
    // a read with no `workspaceId` would auto-target on the server.
    expect(templateCalls(undefined)).toHaveLength(0);
  });
});

/** Two channels, the second answering with its OWN template — so a pane
 *  rendering the wrong channel is visible as DATA, not merely as a token. */
function twoChannels() {
  const second = {
    ...HOME.channels[0],
    workspaceId: OTHER_WS,
    workspaceSegment: "link-dana-bb22",
    channelId: "chan-2",
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
      if (bare === "/api/agent-templates" && opts.workspaceId === OTHER_WS) {
        return Promise.resolve(ok({ templates: [DANA_TEMPLATE] }));
      }
      return defaultRoutes(path, opts);
    }
  );
}

describe("the pane token", () => {
  it("crossfades on a channel switch and never swaps data under a frozen token", async () => {
    twoChannels();

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

  /**
   * 🔒 THE TOKEN IS NOT THE KEY, AND THIS IS WHY THE PIN ABOVE WAS NOT ENOUGH
   * (F-338). That test asserts on rendered DATA and stayed green through the
   * whole bug: `Crossfade` renders `{children(shownToken)}` with NO key, and
   * every `agents:<rowId>` token returns `<HomeAgentPanels>` at the SAME
   * position — so React reconciled ONE INSTANCE across the switch. Data is a
   * prop and props move; the panel's own `useState` did not.
   *
   * ⚠ THESE ASSERT ON THE INSTANCE, NOT ON WHAT IS PAINTED. There is no way to
   * read a component's identity from the DOM, and there does not need to be:
   * state can only survive a switch if the instance did, so a reset `scope` and
   * a torn-down dialog ARE the identity claim. What made it a HIGH rather than
   * a cosmetic bug is what the survivors point at — `ContainerTemplateEditor`
   * and `CopyToChannelDialog` take the target workspace as a PROP, so a dialog
   * held open across the switch silently retargets at the NEW container and its
   * write SUCCEEDS there: no 404, no rollback, the wrong relationship.
   */
  it("TEARS THE PANE DOWN on a channel switch — no held state retargets", async () => {
    twoChannels();
    renderHome();
    await openAgents();
    await screen.findByText("Renewal chaser");

    // ⚠ ONE PIECE OF HELD STATE SINCE 2026-08-27, NOT TWO. The scope pill was
    // the second, and it is gone — which makes the copy dialog the whole of
    // this pin, and the sharper half anyway: it is the one that holds a
    // WORKSPACE ID.
    await screen.findByText("Fundraise analyst");
    fireEvent.click(screen.getByRole("button", { name: "Use in this channel" }));
    await screen.findByRole("button", { name: "Make a copy" });

    fireEvent.click(screen.getByText("Dana Ruiz"));
    await screen.findByText("Dana's assistant");

    // The dialog went with the pane it belonged to. Held across the switch it
    // would still be open — now addressing Dana's container, where its write
    // would SUCCEED.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Make a copy" })).toBeNull()
    );
  });
});

describe("a failed PERSONAL read", () => {
  /** The home workspace's template list refuses; everything else answers. */
  function refuseHomeTemplates() {
    apiRequest.mockImplementation((path: string, opts: BridgeRequestOpts = {}) =>
      path.split("?")[0] === "/api/agent-templates" && opts.workspaceId === WORKSPACE_ID
        ? Promise.resolve({
            status: 403,
            statusText: "Forbidden",
            hasBody: true,
            body: { error: { code: "FORBIDDEN", message: "You can't read that." } },
          })
        : defaultRoutes(path, opts)
    );
  }

  it("says so — a settled answer is never rendered as pending", async () => {
    // 🔒 THE TRAP THIS PINS (F-339). `resolved` is `data !== undefined`, so a
    // failed read is unresolved FOREVER — read as "pending", the section
    // painted a bare spacer with no sentence at all.
    // ⚠ THE PILL HALF OF THIS PIN IS GONE WITH THE PILL (2026-08-27). It also
    // asserted that a settled failure never left `pendingRow(true)` =
    // `pointer-events-none` on the control that escapes the scope. There is no
    // such control now — which removes the trap rather than fixing it — but the
    // SENTENCE half is the part that was about telling the truth, and it stays.
    refuseHomeTemplates();
    renderHome();
    await openAgents();
    await screen.findByText("Renewal chaser");

    // The answer is SAID. M0's own argument is that a 403 here is an ORDINARY
    // answer; an ordinary answer that renders as blank is a lie by omission.
    expect(await screen.findByText("You can't read that.")).toBeInTheDocument();
    // It is not the pending state and it is not the empty sentence.
    expect(
      screen.queryByText("You haven't created an agent here yet.")
    ).not.toBeInTheDocument();
  });

  it("offers the retry, and the retry re-asks", async () => {
    refuseHomeTemplates();
    renderHome();
    await openAgents();
    await screen.findByText("You can't read that.");

    const before = templateCalls(WORKSPACE_ID).length;
    apiRequest.mockImplementation(defaultRoutes);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Fundraise analyst")).toBeInTheDocument();
    expect(templateCalls(WORKSPACE_ID).length).toBeGreaterThan(before);
  });

  it("leaves the CONTAINER's own section standing — one section failed, not the pane", async () => {
    // A whole-pane `PageError` for a Personal failure would take away the
    // SHARED section too, which is a working half of the pane thrown away for a
    // failure in the other half.
    refuseHomeTemplates();
    renderHome();
    await openAgents();
    await screen.findByText("You can't read that.");

    expect(screen.getByText("Renewal chaser")).toBeInTheDocument();
    expect(screen.getByText("Priya's intake bot")).toBeInTheDocument();
  });
});

describe("what this pane deliberately leaves out", () => {
  it("offers no launch control — the Channels face's picker is the one launch surface", async () => {
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
