import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { WORKSPACE_ID, bootBody, bridgeCalls, installBridge } from "#/test-utils/bridge";
import { ToastHost } from "@/shared/ui/toast";
import { LINK_WORKSPACE_ID, renderHome } from "./home-test-harness";
import { CHANNEL_ID } from "./home-test-ids";
import {
  CHANNEL_ONLY_BASE,
  TEAMS_PATH,
  T_HOME,
  identityRoutes,
  openIdentities,
  identityCalls,
} from "./identity-test-fixtures";

/**
 * /home → AGENTS → THE AUTHORING FACE (plan M3, §4.5).
 *
 * ⚠ MOUNTED THROUGH `HomePage`, NEVER THE EDITOR — the whole claim of this
 * milestone is about WHICH WORKSPACE a write lands in, and that is decided by
 * props the page threads down (the container off the selected row, the home
 * workspace off `POST /api/boot`). A direct mount would hand the editor a
 * workspace id by hand and pass with every one of those wires cut.
 *
 * 🔴 THE ASSERTIONS ARE ON THE WIRE'S `x-workspace-id`, NOT ONLY ON THE SCREEN.
 * Both scopes POST to the SAME url; the workspace rides `opts`. A suite matching
 * on the path alone would pass while both scopes wrote into one workspace, which
 * is exactly F-331's shape — and the second half of each create test (the row is
 * ABSENT from the other scope's list) is what pins the entry-key cache patch
 * that F-331 resolved.
 *
 * ⚠ THE CHANNEL SURFACE IS STUBBED. The page opens on Chat, so the real
 * channels surface would mount (and fetch) before a single assertion ran. It
 * ALSO removes the second thing on this page called "Agents" (the info column's
 * live-session tab, Q6), so the header selector is unambiguous.
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
  apiRequest.mockImplementation(identityRoutes);
  installBridge({ apiRequest });
});

/** Open a create editor and name an identity, without saving it.
 *  ⚠ TWO BUTTONS SINCE 2026-08-27, AND SINCE 2026-09-09 THEY READ THE SAME
 *  WORDS — "+ Agent identity" in BOTH sections (Samuel). The only thing that
 *  tells them apart is the SECTION they sit in, which is also the only thing
 *  that differs about which workspace the create hits, so this reaches them
 *  through their region. A button-name lookup would now be ambiguous. */
function createButtonIn(section: string): HTMLButtonElement {
  return within(screen.getByRole("region", { name: section })).getByRole(
    "button",
    { name: "Agent Identity" }
  ) as HTMLButtonElement;
}

async function startNewAgent(
  name: string,
  section: string = PERSONAL_SECTION
): Promise<void> {
  fireEvent.click(createButtonIn(section));
  await screen.findByRole("dialog");
  fireEvent.change(
    document.querySelector<HTMLInputElement>("#agent-identity-name")!,
    { target: { value: name } }
  );
}

/** The create call, or `undefined` — POST only, either workspace. */
function createCall() {
  return bridgeCalls(apiRequest).find(
    (c) => c.path.startsWith("/api/agent-identities") && c.opts.method === "POST"
  );
}

/** The two section headings — `agent-identities/lib/visibility.ts`'s labels,
 *  which is what `SectionPanel`'s `aria-labelledby` names the region by. */
const SHARED_BUTTON = "Shared in this channel";
const PERSONAL_SECTION = "Personal";

describe("each section's create writes where its section reads", () => {
  it("the SHARED button writes into THIS CHANNEL'S container, and stays out of the shelf", async () => {
    renderHome();
    await openIdentities();
    // ⚠ BOTH LISTS ARE ON SCREEN AT ONCE NOW, so the "warm the other entry
    // first" dance the pill version needed is free — but the REASON stands and
    // is why this waits for both: a cache entry that holds nothing cannot be
    // patched wrongly (`patchCache` over an absent entry is a no-op), so a
    // create against a COLD other workspace passes with the prefix bug intact.
    await screen.findByText("Renewal chaser");
    await screen.findByText("Fundraise analyst");

    await startNewAgent("Intake triage", SHARED_BUTTON);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createCall()).toBeDefined());
    expect(createCall()!.opts.workspaceId).toBe(LINK_WORKSPACE_ID);
    expect(await screen.findByText("Intake triage")).toBeInTheDocument();

    // 🔒 F-331, NOW WITH A SECOND AXIS. The writes patch the ENTRY key
    // `[path, workspaceId, query]` — over the one-element PATH prefix TanStack
    // would append this row to EVERY variant, so it would read as a
    // home-workspace agent too. ⚠ The `query` element is the SHELF since
    // 2026-08-27; a writer that kept passing `undefined` would miss the entry
    // Personal actually mounts, which is the same defect wearing a new axis.
    expect(screen.queryByText("Intake triage")).toBeInTheDocument();
    const personal = screen.getByRole("region", { name: "Personal" });
    expect(personal.textContent).not.toContain("Intake triage");
  });

  it("the PERSONAL button writes into the caller's OWN workspace, on the home shelf", async () => {
    renderHome();
    await openIdentities();
    await screen.findByText("Renewal chaser");
    await screen.findByText("Fundraise analyst");

    await startNewAgent("Deck reviewer");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createCall()).toBeDefined());
    expect(createCall()!.opts.workspaceId).toBe(WORKSPACE_ID);
    // 🔒 AND IT CARRIES THE SHELF. A create that landed unmarked would write
    // into the workspace shelf this pane no longer reads — a row that vanishes
    // the moment it is made, with no error anywhere.
    expect(createCall()!.opts.body).toMatchObject({ homeScoped: true });
    expect(await screen.findByText("Deck reviewer")).toBeInTheDocument();

    // 🔒 …and the mirror: a home create must not materialise in the CONTAINER's
    // section either.
    const shared = screen.getByRole("region", { name: "Shared in this channel" });
    expect(shared.textContent).not.toContain("Deck reviewer");
  });

  it("🔒 the SHARED create ACKNOWLEDGES the audience the section names (A11)", async () => {
    // 🔒 G16 — the server 400s `CONTAINER_PUBLISH_UNACKNOWLEDGED` without this,
    // so "New shared agent" cannot save at all if the flag is dropped. ⚠ NO NEW
    // DIALOG: `SECTIONS_CONTAINER`'s single option is labelled "Shared in this
    // channel" and the section heading repeats it — that control IS the
    // audience statement (INVARIANTS §5, minimal UI copy).
    renderHome();
    await openIdentities();
    await screen.findByText("Renewal chaser");

    await startNewAgent("Intake triage", SHARED_BUTTON);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createCall()).toBeDefined());
    expect(createCall()!.opts.body).toMatchObject({
      visibility: "workspace",
      acknowledgeShared: true,
    });
  });

  it("🔒 the PERSONAL create sends NO acknowledgement — nothing is published", async () => {
    // ⚠ `undefined`, never `false`. The server examines only an explicit
    // `true`, and a `false` on every private save would suggest to a reader
    // that the other value is examined too — the rule `homeScoped` states.
    renderHome();
    await openIdentities();
    await screen.findByText("Fundraise analyst");

    await startNewAgent("Deck reviewer");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createCall()).toBeDefined());
    expect(createCall()!.opts.body).not.toHaveProperty("acknowledgeShared");
  });

  it("🔒 the SHARED create sends NO homeScoped — a container has no shelf", async () => {
    // `personalWriteWorkspaceId` routes on it and this create is not personal;
    // an explicit `false` would widen the contract for no reason.
    renderHome();
    await openIdentities();
    await screen.findByText("Renewal chaser");

    await startNewAgent("Intake triage", SHARED_BUTTON);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createCall()).toBeDefined());
    expect(createCall()!.opts.body).not.toHaveProperty("homeScoped");
  });

  it("PERSONAL has nowhere to write, and says so with a disabled control, before onboarding", async () => {
    apiRequest.mockImplementation((path: string, opts: BridgeRequestOpts = {}) =>
      path === "/api/boot"
        ? Promise.resolve({
            status: 200,
            statusText: "OK",
            hasBody: true,
            body: bootBody({ workspace: null, segment: null, role: null }),
          })
        : identityRoutes(path, opts)
    );
    renderHome();
    await openIdentities();
    await screen.findByText("Renewal chaser");

    // The SHARED button still writes — the container is the selected row, not
    // boot's answer. Only PERSONAL depends on there being a home workspace.
    // ⚠ BY SECTION, not by name: both buttons read "+ Agent identity" since
    // 2026-09-09, so this is also the test that they are two buttons at all.
    expect(createButtonIn(SHARED_BUTTON).disabled).toBe(false);
    expect(createButtonIn(PERSONAL_SECTION).disabled).toBe(true);
  });
});

describe("what the editor is allowed to ask for", () => {
  it("🔒 offers ONE visibility scope in a container, and asks for no teams", async () => {
    renderHome();
    await openIdentities();
    await screen.findByText("Renewal chaser");
    await startNewAgent("Intake triage", SHARED_BUTTON);

    // ⚠ `team` is a DEAD value in a container (§4A: no teams exist there), so
    // an option for it would be this editor inviting a grant nothing could
    // hold. The shared scope reads "Shared in this channel", NEVER "Public".
    // 🔒 ⚠ `private` WENT ON 2026-08-27, and it is the important half. The pane
    // lost its per-channel private section and a container is not navigable, so
    // a private container identity is reachable from NO surface — the option
    // would create write-only rows. It also means the draft must OPEN on
    // `workspace` (`defaultVisibility`), or the form's selected value is one the
    // control cannot show.
    expect(screen.getByRole("tab", { name: "Shared in this channel" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Private" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Team" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Public" })).toBeNull();

    // 🔒 AND IT NEVER ASKED. Not "the list came back empty" — the container
    // mount has no `useTeams` call at all, which is why it is its own component
    // (`identity-editor.tsx`).
    expect(
      bridgeCalls(apiRequest).filter((c) => c.path.endsWith("/teams"))
    ).toHaveLength(0);
  });

  it("🔒 offers NO Team scope on the PERSONAL shelf, and asks for no teams either", async () => {
    // 🔒 SAMUEL'S RULING, 2026-09-08: *"we should remove the team option, if
    // it's in the home space, because the team thing is for workspaces."*
    // ⚠ **THIS CASE ASSERTED THE OPPOSITE ("offers all THREE in the caller's own
    // workspace, where a team can exist") AND IT WAS WRONG ON THE WIRE THE WHOLE
    // TIME.** This button writes with `shelf: "home"` ⇒ `homeScoped: true`,
    // which routes the row into the caller's `kind='personal'` container — and
    // `agent-identities/server/service-write-gates.ts › resolveIdentityCreateDestination`
    // refuses `team` there. The third pill could only ever produce a 403.
    renderHome();
    await openIdentities();
    await screen.findByText("Fundraise analyst");
    await startNewAgent("Deck reviewer");

    expect(screen.getByRole("tab", { name: "Private" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Public" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Team" })).toBeNull();

    // 🔒 AND THE READ THAT FED IT IS GONE. Not "it came back empty" — the mount
    // has no `useTeams` call at all now, the same claim the container mount has
    // carried since M3 (`identity-editor.tsx`).
    expect(
      bridgeCalls(apiRequest).filter((c) => c.path === TEAMS_PATH)
    ).toHaveLength(0);
  });

  it("attaches the TARGET workspace's knowledge bases, off the PLAIN key", async () => {
    renderHome();
    await openIdentities();
    await screen.findByText("Renewal chaser");
    await startNewAgent("Intake triage", SHARED_BUTTON);

    // The container's own bases, off the PLAIN key (`useKnowledgeBaseList`) —
    // the channel-scoped entry carries `channelGrants` and belongs to the
    // Knowledge pane; the attach picker has no use for it.
    // ⚠ TREE ROWS since 2026-09-08 (`knowledge-scope-picker.tsx`); the chip menu
    // it replaced answered "Attach" + `menuitem`s. ⚠ **AND THE TREE IS IN THE
    // FORM SINCE 2026-09-22 (Samuel)** — there is no "Add knowledge" button left
    // to press, so the rows are on screen with the editor.
    expect(await screen.findByRole("treeitem", { name: "Call notes" })).toBeTruthy();
    expect(screen.queryByRole("treeitem", { name: "Fundraise memos" })).toBeNull();

    // 🔒 PLAIN KEY vs `?channelId=`, AND THIS HALF WAS BLIND UNTIL 2026-08-26.
    // `identity-test-fixtures.ts › identityRoutes` used to strip the query before
    // dispatching, so both entries answered with one body and the two
    // assertions above passed whichever entry the editor read. The fixture is
    // query-aware now and carries a row ONLY the channel-scoped answer has.
    expect(screen.queryByRole("treeitem", { name: CHANNEL_ONLY_BASE })).toBeNull();
    // …and the same claim from the wire, which is where it is unambiguous: not
    // one base read this editor made carried the query at all.
    // ⚠ `opts.method` is "GET", never undefined — `api-client.ts › apiRequest`
    // sends `opts.method ?? "GET"` over the bridge, so a filter on `undefined`
    // matches nothing and passes vacuously.
    const baseReads = bridgeCalls(apiRequest).filter(
      (c) => c.path.startsWith("/api/knowledge/bases") && c.opts.method === "GET"
    );
    expect(baseReads.length).toBeGreaterThan(0);
    expect(baseReads.filter((c) => c.path.includes("channelId="))).toHaveLength(0);
  });
});

describe("editing an existing row", () => {
  it("opens against the workspace the row LIVES in, not the one on screen", async () => {
    renderHome();
    await openIdentities();

    fireEvent.click(await screen.findByText("Fundraise analyst"));
    await screen.findByRole("dialog");
    expect(
      document.querySelector<HTMLInputElement>("#agent-identity-name")!.value
    ).toBe("Fundraise analyst");

    fireEvent.change(
      document.querySelector<HTMLInputElement>("#agent-identity-name")!,
      { target: { value: "Fundraise analyst v2" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // 🔒 A PERSONAL row is a HOME-workspace row. Its PATCH takes the HOME
    // workspace id — reading one list and writing another is the cross-workspace
    // bug the entry key exists to prevent.
    await waitFor(() => {
      const patch = bridgeCalls(apiRequest).find((c) => c.opts.method === "PATCH");
      expect(patch?.opts.workspaceId).toBe(WORKSPACE_ID);
    });
    expect(await screen.findByText("Fundraise analyst v2")).toBeInTheDocument();
  });

  it("opens a SHARED row against the CONTAINER, with Personal on screen beside it", async () => {
    renderHome();
    await openIdentities();
    await screen.findByText("Renewal chaser");
    await screen.findByText("Fundraise analyst");

    // The Shared section's rows are container rows, and always were — this used
    // to be phrased against a scope pill that no longer exists, but the claim is
    // the same: which SECTION a row is in decides its workspace, and the two
    // sections are on screen together.
    fireEvent.click(screen.getByText("Priya's intake bot"));
    await screen.findByRole("dialog");
    // The container mount, so the one-option scope set — proof enough that the
    // Personal section did not decide this.
    expect(screen.getByRole("tab", { name: "Shared in this channel" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Public" })).toBeNull();
  });
});

describe("the writes stay in their own workspace", () => {
  it("never addresses the home workspace while creating in the container", async () => {
    renderHome();
    await openIdentities();
    await screen.findByText("Renewal chaser");
    await startNewAgent("Intake triage", SHARED_BUTTON);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("Intake triage");

    // ⚠ NO **WRITE** REACHED THE HOME WORKSPACE. It used to assert no call of
    // any method, which was only true while the home READ was lazy behind the
    // pill; Personal is always on screen now, so a GET there is expected and a
    // POST/PATCH/DELETE is the actual claim.
    expect(
      identityCalls(apiRequest, WORKSPACE_ID).filter(
        (c) => c.opts.method !== "GET"
      )
    ).toHaveLength(0);
  });
});

/**
 * **LAUNCH, FROM THE CARD** (Samuel, 2026-09-22) — the control that was "Share
 * into this channel" and, before that, the copy.
 *
 * ⚠ **THE BLOCK IT REPLACED PINNED A GRANT BODY AND IS GONE WITH THE CONTROL.**
 * `agent-share.tsx` is deleted; `dopl_agent(op="grant")` still writes a grant and
 * `resource-grants` is still the endpoint, so nothing about the GRANT was
 * withdrawn — what left is the /home card's way of writing one.
 *
 * 🔒 **THE LOAD-BEARING ASSERTION IS ON THE LAUNCH PAYLOAD.** A launch that
 * carried an override, a runtime or a colour would render identically (as a
 * spinner and a toast) and would NOT be the as-is launch he asked for — and the
 * `workspaceId` is the one field that decides whether main can resolve the
 * identity at all (`main/identity-resolve.js` reads `(workspace_id, id)`).
 */
describe("launch from the card", () => {
  const launch = vi.fn();
  const rename = vi.fn();
  const describeOp = vi.fn();

  /** The desktop, with the three ops this lane uses. ⚠ `installBridge` REPLACES
   *  the surface, so `apiRequest` is re-supplied here. */
  function installDesktop(
    outcome: { ok: boolean; agentId?: string; reason?: string; detail?: string } = {
      ok: true,
      agentId: "ag-1",
    }
  ) {
    launch.mockReset().mockResolvedValue(outcome);
    rename.mockReset().mockResolvedValue({ ok: true });
    describeOp.mockReset().mockResolvedValue({ ok: true });
    installBridge({
      apiRequest,
      sessions: { launch, rename, describe: describeOp },
    });
  }

  /** Press Launch on the PERSONAL card. */
  async function pressLaunch(): Promise<void> {
    renderHome();
    await openIdentities();
    await screen.findByText("Fundraise analyst");
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
  }

  it("🔒 launches the identity AS-IS, into the selected channel", async () => {
    installDesktop();
    await pressLaunch();

    await waitFor(() => expect(launch).toHaveBeenCalled());
    // 🔒 EXACT EQUALITY. An extra key here is a per-spawn DECISION the operator
    // never made, and `taskId: null` is a CHANNEL-level agent rather than a
    // missing value.
    expect(launch.mock.calls[0][0]).toEqual({
      channelId: CHANNEL_ID,
      taskId: null,
      // 🔒 THE IDENTITY'S OWN WORKSPACE, never the channel's container: main
      // resolves the row by `(workspace_id, id)`, so the container id would 404
      // every personal identity.
      workspaceId: WORKSPACE_ID,
      channelName: expect.any(String),
      threadTitle: null,
      // ⚠ THE CHANNEL'S OWN FLAG, FORWARDED UNTOUCHED — the harness's row is a
      // direct one, and main reads this to decide how the session addresses the
      // room.
      direct: true,
      identityId: T_HOME.id,
    });
  });

  it("names the new agent after the identity, and says so", async () => {
    installDesktop();
    // ⚠ THE HOST IS MOUNTED BY HAND — `renderHome` renders the PAGE, and the
    // toast host lives at the app root (`app.tsx`), above every route.
    render(<ToastHost />);
    await pressLaunch();

    // ⚠ KEYED BY MAIN'S OWN ADDRESS — neither write can happen until the spawn
    // has answered with one.
    await waitFor(() => expect(rename).toHaveBeenCalledWith("ag-1", T_HOME.name));
    expect(describeOp).toHaveBeenCalledWith("ag-1", "Reads the data room");
    // The popup Samuel asked for, in his own words.
    await screen.findByText(/"Fundraise analyst" launched into/);
  });

  it("🔒 says a refusal ON THE ROW — a control that silently does nothing is the bug", async () => {
    installDesktop({ ok: false, reason: "cap" });
    await pressLaunch();

    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("Session limit");
    expect(rename).not.toHaveBeenCalled();
  });

  it("says main's own `no-model` sentence, not the generic line", async () => {
    installDesktop({
      ok: false,
      reason: "no-model",
      detail: "gpt-x is not offered here. Offered: claude-sonnet-5",
    });
    await pressLaunch();

    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toBe(
      "gpt-x is not offered here. Offered: claude-sonnet-5"
    );
  });

  it("offers no launch control on a SHARED row — that list is the container's", async () => {
    installDesktop();
    renderHome();
    await openIdentities();
    await screen.findByText("Renewal chaser");
    // ⚠ Scoped to the SHARED region: the control lives on every Personal card,
    // so a document-wide query would find those and prove nothing about this one.
    const shared = screen.getByRole("region", { name: "Shared in this channel" });
    expect(within(shared).queryByRole("button", { name: "Launch" })).toBeNull();
  });
});
