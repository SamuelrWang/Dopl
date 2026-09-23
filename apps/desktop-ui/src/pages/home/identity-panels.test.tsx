import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import { WORKSPACE_ID, bootBody, installBridge, ok } from "#/test-utils/bridge";
import type { ChannelListPayload } from "@/features/channels/types";
import { SECTION_PRIVATE_EVERYWHERE } from "@/features/agent-identities/lib/visibility";
import {
  HOME,
  LINK_WORKSPACE_ID,
  isAccountChannels,
  renderHome,
} from "./home-test-harness";
import {
  DANA_IDENTITY,
  OTHER_WS,
  identityRoutes,
  openIdentities,
  identityCalls as calls,
} from "./identity-test-fixtures";

/**
 * /home → AGENTS, END TO END THROUGH THE REAL PAGE (plan M2, §1–§4).
 *
 * ⚠ MOUNTED THROUGH `HomePage`, NEVER THE PANEL — the same reason
 * `knowledge-panels.test.tsx` gives. Three of the things here are properties of
 * the PAGE: that the pane token moves when the channel does (§4.1's wrong-channel
 * flash), that the home workspace arrives from the boot query this page already
 * mounts, and that a container with no identities still paints. A direct mount
 * would hand the panel static props and pass with every one of those broken.
 *
 * ⚠ THE CHANNEL SURFACE IS STUBBED. The page opens on Channels, so the real
 * channels surface would mount (and fetch) before a single Agents assertion
 * ran. `vi.mock` is hoisted per file and its factory may not close over imports
 * — hence a local stub rather than one in the harness. It ALSO removes the
 * second thing on this page called "Agents" (the info column's live-session
 * tab, Q6), so the header selector is unambiguous.
 *
 * ⚠ THE FIXTURES AND THE ROUTING TABLE ARE IN `identity-test-fixtures.ts`, shared
 * with `identity-authoring.test.tsx` — one `T_HOME`, because this face's whole
 * hazard is two workspaces being mistaken for each other (F-331) and two copies
 * of the fixtures is how two suites come to disagree about which is which.
 *
 * ⚠ THE NO-CONCAVE SWEEP IS NOT MIRRORED HERE, and it did not need to be. The
 * SPA is a separate vitest project, but the sweep is a `readFileSync` over
 * SOURCE — not an import — and the root project runs with `process.cwd()` at
 * the repo root, so `agent-identities/components/identity-editor.test.tsx ›
 * no concave surfaces › HOME_FILES` reads these two files directly. One sweep,
 * one list of forbidden recipes; a mirrored copy is how the two come to forbid
 * different things.
 */

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock(
  "@/features/channels/components/channel-surface-standalone",
  () => ({
    StandaloneChannelSurface: () => <div data-testid="channel-surface" />,
  })
);

beforeEach(() => {
  apiRequest.mockReset();
  apiRequest.mockImplementation(defaultRoutes);
  installBridge({ apiRequest });
});

/** The identity-list calls, split by which workspace they addressed. */
const identityCalls = (workspaceId: string | undefined) =>
  calls(apiRequest, workspaceId);

describe("the two sections", () => {
  it("fills SHARED from the container, and PERSONAL from the home shelf", async () => {
    renderHome();
    await openIdentities();

    // SHARED: the workspace-visible container rows, mine and the peer's.
    expect(await screen.findByText("Renewal chaser")).toBeInTheDocument();
    expect(screen.getByText("Priya's intake bot")).toBeInTheDocument();
    // PERSONAL: the home shelf, loaded with no pill to open.
    expect(await screen.findByText("Fundraise analyst")).toBeInTheDocument();
  });

  it("🔒 shows NO container identity that is not shared — the removed private scope", async () => {
    // 🔒 SAMUEL'S RULING, 2026-08-27, AND THIS IS THE CONSEQUENCE HE ACCEPTED.
    // `Scratch agent` is private, the caller's own, and sits in this channel's
    // container — the whole of the old scope B. With that scope deleted a
    // container identity reaches /home only at `visibility: "workspace"`, and
    // the container editor no longer offers any other value, so no NEW row can
    // land here either.
    // ⚠ The peer's private row rides along so this asserts the RULE and not one
    // row: a `createdBy` filter dropped by a typo passes without it.
    renderHome();
    await openIdentities();
    await screen.findByText("Renewal chaser");

    expect(screen.queryByText("Scratch agent")).not.toBeInTheDocument();
    expect(screen.queryByText("Priya's drafts bot")).not.toBeInTheDocument();
  });

  it("🔒 shows only the HOME SHELF in Personal, not the rest of that workspace", async () => {
    // 🔒 `Quarterly reporter` is in the SAME workspace as `Fundraise analyst`,
    // also private, also the caller's own — only `?shelf=home` separates them,
    // and the harness answers BOTH shelves when the param is missing
    // (`identity-test-fixtures.ts › agentIdentities`).
    renderHome();
    await openIdentities();

    expect(await screen.findByText("Fundraise analyst")).toBeInTheDocument();
    expect(screen.queryByText("Quarterly reporter")).not.toBeInTheDocument();
  });

  it("marks an identity the operator did not write, and leaves their own bare", async () => {
    renderHome();
    await openIdentities();
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
    await openIdentities();
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
    await openIdentities();
    await screen.findByText("Fundraise analyst");

    const home = identityCalls(WORKSPACE_ID);
    expect(home.length).toBeGreaterThan(0);
    expect(home.every((c) => c.path.includes("shelf=home"))).toBe(true);
    // The container read carries NO shelf — shelves exist only in a standard
    // workspace, so narrowing a container would be a question with one answer.
    const container = identityCalls(LINK_WORKSPACE_ID);
    expect(container.length).toBeGreaterThan(0);
    expect(container.every((c) => !c.path.includes("shelf="))).toBe(true);
  });
});

describe("empty scopes", () => {
  it("says nothing under an empty shared section, and states an empty Personal shelf", async () => {
    apiRequest.mockImplementation((path: string, opts: BridgeRequestOpts = {}) =>
      path.split("?")[0] === "/api/agent-identities"
        ? Promise.resolve(ok({ identities: [] }))
        : defaultRoutes(path, opts)
    );
    renderHome();
    await openIdentities();

    expect(
      await screen.findByText("You haven't created an agent here yet.")
    ).toBeInTheDocument();
    // Samuel, 2026-09-19: the shared section's empty line and the Personal
    // caption are removed, not reworded.
    expect(screen.queryByText(/shared into this channel yet/)).toBeNull();
    expect(screen.queryByText(/Yours alone/)).toBeNull();
  });

  it("offers no Personal shelf, and asks for no home identities, when boot has no workspace", async () => {
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
    await openIdentities();

    expect(
      await screen.findByText(
        "Finish setting up your home space to keep agents there."
      )
    ).toBeInTheDocument();
    // ⚠ AND NO UNADDRESSED READ. With no home workspace the query is disabled;
    // a read with no `workspaceId` would auto-target on the server.
    expect(identityCalls(undefined)).toHaveLength(0);
  });
});

/** Two channels, the second answering with its OWN identity — so a pane
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
  const two: ChannelListPayload = {
    channels: [HOME.channels[0], second],
    pendingLinks: [],
  };
  apiRequest.mockImplementation(
    (path: string, opts: BridgeRequestOpts = {}): Promise<BridgeResponse> => {
      const bare = path.split("?")[0];
      if (isAccountChannels(path)) return Promise.resolve(ok(two));
      if (bare === "/api/agent-identities" && opts.workspaceId === OTHER_WS) {
        return Promise.resolve(ok({ identities: [DANA_IDENTITY] }));
      }
      return defaultRoutes(path, opts);
    }
  );
}

describe("the pane token", () => {
  it("crossfades on a channel switch and never swaps data under a frozen token", async () => {
    twoChannels();

    const { view } = renderHome();
    await openIdentities();
    await screen.findByText("Renewal chaser");

    fireEvent.click(screen.getByText("Dana Ruiz"));

    // ⚠ **A PICK LEAVES THIS FACE SINCE 2026-09-13** (Samuel: a click in the
    // picker goes to that channel's page from wherever you are — INVARIANTS §5),
    // so re-pointing this pane is a pick PLUS a return to Agents. Only the way
    // the switch is DRIVEN changed; both halves of the pin are the originals.
    expect(view.container.querySelector(".crossfade[data-out]")).not.toBeNull();
    expect(screen.getByText("Renewal chaser")).toBeInTheDocument();

    await openIdentities();

    // …and the new channel's identities are what the pane comes back with.
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
   * every `agents:<rowId>` token returns `<HomeIdentityPanels>` at the SAME
   * position — so React reconciled ONE INSTANCE across the switch. Data is a
   * prop and props move; the panel's own `useState` did not.
   *
   * ⚠ THESE ASSERT ON THE INSTANCE, NOT ON WHAT IS PAINTED. There is no way to
   * read a component's identity from the DOM, and there does not need to be:
   * state can only survive a switch if the instance did, so a reset `scope` and
   * a torn-down dialog ARE the identity claim. What made it a HIGH rather than
   * a cosmetic bug is what the survivors point at — `ContainerIdentityEditor`
   * and the share dialog take their target as a PROP, so one held open across
   * the switch silently retargets at the NEW room and its write SUCCEEDS there:
   * no 404, no rollback, the wrong relationship. ⚠ **THE HELD DIALOG IS THE CARD'S
   * KNOWLEDGE POPUP SINCE 2026-09-22** (`identity-card-knowledge.tsx`), where it
   * was the share dialog and, before that, the copy — the defect is IDENTICAL
   * in shape each time, which is why this case keeps moving with it rather than
   * being deleted.
   */
  it("TEARS THE PANE DOWN on a channel switch — no held state retargets", async () => {
    twoChannels();
    renderHome();
    await openIdentities();
    await screen.findByText("Renewal chaser");

    // ⚠ ONE PIECE OF HELD STATE SINCE 2026-08-27, NOT TWO. The scope pill was
    // the second, and it is gone — which makes the CARD DIALOG the whole of
    // this pin, and the sharper half anyway: it is the one that holds the row it
    // will write against. ⚠ **IT IS THE KNOWLEDGE POPUP SINCE 2026-09-22**,
    // where it was the share dialog; the defect is identical in shape, which is
    // why this case moved with it rather than being deleted.
    await screen.findByText("Fundraise analyst");
    fireEvent.click(screen.getByRole("button", { name: /add knowledge/i }));
    await screen.findByRole("button", { name: "Save" });

    fireEvent.click(screen.getByText("Dana Ruiz"));
    // ⚠ THE PICK RAISES THE CHANNEL FACE NOW (2026-09-13), so come back — and
    // the ROW KEY is still what this pins, because `selected` moves with NO
    // click whenever the selected row leaves `visible` (`home-panes.tsx`).
    await openIdentities();
    await screen.findByText("Dana's assistant");

    // The dialog went with the pane it belonged to. Held across the switch it
    // would still be open — now addressing the OTHER room's pane, where its
    // write would land on a row this operator was no longer looking at.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull()
    );
  });
});

describe("a failed PERSONAL read", () => {
  /** The home workspace's identity list refuses; everything else answers. */
  function refuseHomeIdentities() {
    apiRequest.mockImplementation((path: string, opts: BridgeRequestOpts = {}) =>
      path.split("?")[0] === "/api/agent-identities" && opts.workspaceId === WORKSPACE_ID
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
    refuseHomeIdentities();
    renderHome();
    await openIdentities();
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
    refuseHomeIdentities();
    renderHome();
    await openIdentities();
    await screen.findByText("You can't read that.");

    const before = identityCalls(WORKSPACE_ID).length;
    apiRequest.mockImplementation(defaultRoutes);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Fundraise analyst")).toBeInTheDocument();
    expect(identityCalls(WORKSPACE_ID).length).toBeGreaterThan(before);
  });

  it("leaves the CONTAINER's own section standing — one section failed, not the pane", async () => {
    // A whole-pane `PageError` for a Personal failure would take away the
    // SHARED section too, which is a working half of the pane thrown away for a
    // failure in the other half.
    refuseHomeIdentities();
    renderHome();
    await openIdentities();
    await screen.findByText("You can't read that.");

    expect(screen.getByText("Renewal chaser")).toBeInTheDocument();
    expect(screen.getByText("Priya's intake bot")).toBeInTheDocument();
  });
});

/**
 * 🔒 **NO CHANNELS AT ALL — EVERY ACCOUNT'S FIRST DAY (2026-09-10, the new-user
 * flow).**
 *
 * The pane used to return the "pick one on the left" empty state INSTEAD of
 * itself, so the whole face was one sentence beside an empty list: the caller's
 * own Personal identities — a HOME-workspace read that needs no channel — were off
 * screen, and so was the button that makes one. `channel === null` is a fact about
 * the CONTAINER, so it takes section A and nothing else.
 *
 * ⚠ The empty CHANNELS payload is the point: `selected` falls back to
 * `visible[0]`, so with no rows there is no channel, which is the same `null` a
 * legacy unbound link produces. One code path, reached the way a real new account
 * reaches it.
 */
describe("🔒 with no channels, PERSONAL still renders", () => {
  beforeEach(() => {
    // ⚠ NOT `withHome`: that helper falls back to the HARNESS's routes, which do
    // not answer `/api/agent-identities` at all — the Personal read would reject
    // and this whole block would be measuring a failed fetch.
    apiRequest.mockImplementation(
      (path: string, opts: BridgeRequestOpts = {}): Promise<BridgeResponse> =>
        isAccountChannels(path)
          ? Promise.resolve(ok({ channels: [], pendingLinks: [] }))
          : defaultRoutes(path, opts)
    );
  });

  it("lists the caller's own home-shelf identities", async () => {
    renderHome();
    await openIdentities();

    expect(await screen.findByText("Fundraise analyst")).toBeInTheDocument();
  });

  it("🔒 offers the Personal create button — the face is not read-only", async () => {
    // The whole point of the fix: a new account must be able to MAKE its first
    // agent. A pane that only listed would still be a dead end.
    renderHome();
    await openIdentities();
    await screen.findByText("Fundraise analyst");

    const personal = screen.getByRole("region", {
      name: SECTION_PRIVATE_EVERYWHERE.label,
    });
    const create = within(personal).getByRole("button", {
      name: /Agent Identity/,
    });
    expect(create).toBeEnabled();
  });

  it("says the sentence about the CHANNEL section, and only there", async () => {
    renderHome();
    await openIdentities();
    await screen.findByText("Fundraise analyst");

    expect(await screen.findByText(/pick one on the left/)).toBeInTheDocument();
    // 🔒 ONE SECTION LEFT, NOT TWO AND NOT ZERO. The shared section is replaced
    // by the sentence; Personal is a region as before.
    expect(screen.getAllByRole("region").length).toBe(1);
  });

  it("⚠ never asks for a container's identities, and never paints the skeleton", async () => {
    // 🔒 THE SKELETON HALF IS THE REGRESSION THIS GUARDS. The container read is
    // DISABLED with no workspace, so `resolved` stays false forever — a pane that
    // waited on it would show "Loading identities" until the user left the tab.
    renderHome();
    await openIdentities();
    await screen.findByText("Fundraise analyst");

    expect(identityCalls(LINK_WORKSPACE_ID)).toHaveLength(0);
    expect(screen.queryByText("Loading identities")).not.toBeInTheDocument();
  });

  it("⚠ offers NO card action — there is no channel to launch into", async () => {
    // The launch takes `channel.id`; a button whose only outcome is a crash is
    // worse than a missing one. ⚠ THE KNOWLEDGE BOX GOES WITH IT: the two are
    // ONE control slot (`identity-section.tsx › IdentityCard`).
    renderHome();
    await openIdentities();
    await screen.findByText("Fundraise analyst");

    expect(screen.queryByRole("button", { name: "Launch" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /add knowledge/i })
    ).not.toBeInTheDocument();
  });
});

describe("what this pane deliberately leaves out", () => {
  it("launches as-is from the PERSONAL card, and keeps every launch CHOICE in the popup", async () => {
    // 🔒 **THE RULING MOVED, THE BOUNDARY DID NOT (Samuel, 2026-09-22).** This
    // pane used to carry no launch at all; the personal card launches now, and
    // what is still kept out is the launch FORM — a second place to pick a
    // model, a runtime or a colour is how the two come to disagree.
    // ⚠ SCOPED TO THE PANELS, never the document: /home's own empty states say
    // "launch an agent into it".
    renderHome();
    await openIdentities();
    await screen.findByText("Fundraise analyst");

    const personal = screen.getByRole("region", {
      name: SECTION_PRIVATE_EVERYWHERE.label,
    });
    const shared = screen.getByRole("region", { name: "Shared in this channel" });
    expect(within(personal).getAllByRole("button", { name: "Launch" }).length).toBeGreaterThan(0);
    // The container's rows resolve in ANOTHER workspace, and his ruling names
    // the personal card.
    expect(within(shared).queryByRole("button", { name: "Launch" })).toBeNull();
    for (const row of ["Agent model", "Agent runtime", "Agent instructions"]) {
      expect(screen.queryByLabelText(row)).toBeNull();
    }
  });
});

const defaultRoutes = identityRoutes;
