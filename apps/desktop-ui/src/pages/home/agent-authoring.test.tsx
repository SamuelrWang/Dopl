import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { WORKSPACE_ID, bootBody, bridgeCalls, installBridge } from "#/test-utils/bridge";
import { LINK_WORKSPACE_ID, renderHome } from "./home-test-harness";
import { CHANNEL_ID } from "./home-test-ids";
import {
  CHANNEL_ONLY_BASE,
  TEAMS_PATH,
  T_HOME,
  agentRoutes,
  openAgents,
  templateCalls,
} from "./agent-test-fixtures";

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
 * channels-v2 surface would mount (and fetch) before a single assertion ran. It
 * ALSO removes the second thing on this page called "Agents" (the info column's
 * live-session tab, Q6), so the header selector is unambiguous.
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
  apiRequest.mockImplementation(agentRoutes);
  installBridge({ apiRequest });
});

/** Open a create editor and name a template, without saving it.
 *  ⚠ TWO BUTTONS SINCE 2026-08-27 — "New shared agent" in the SHARED section
 *  and "New agent" in PERSONAL. The exact name matters: `/New agent/` alone
 *  matches both, and the whole point of the split is which workspace it hits. */
async function startNewAgent(
  name: string,
  button: RegExp = /^New agent$/
): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: button }));
  await screen.findByRole("dialog");
  fireEvent.change(
    document.querySelector<HTMLInputElement>("#agent-template-name")!,
    { target: { value: name } }
  );
}

/** The create call, or `undefined` — POST only, either workspace. */
function createCall() {
  return bridgeCalls(apiRequest).find(
    (c) => c.path.startsWith("/api/agent-templates") && c.opts.method === "POST"
  );
}

const SHARED_BUTTON = /New shared agent/;

describe("each section's create writes where its section reads", () => {
  it("the SHARED button writes into THIS CHANNEL'S container, and stays out of the shelf", async () => {
    renderHome();
    await openAgents();
    // ⚠ BOTH LISTS ARE ON SCREEN AT ONCE NOW, so the "warm the other entry
    // first" dance the pill version needed is free — but the REASON stands and
    // is why this waits for both: a cache entry that holds nothing cannot be
    // patched wrongly (`patchCache` over an absent entry is a no-op), so a
    // create against a COLD other workspace passes with the prefix bug intact.
    await screen.findByText("Renewal chaser");
    await screen.findByText("Fundraise analyst");

    await startNewAgent("Intake triage", SHARED_BUTTON);
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));

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
    await openAgents();
    await screen.findByText("Renewal chaser");
    await screen.findByText("Fundraise analyst");

    await startNewAgent("Deck reviewer");
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));

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
    await openAgents();
    await screen.findByText("Renewal chaser");

    await startNewAgent("Intake triage", SHARED_BUTTON);
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));

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
    await openAgents();
    await screen.findByText("Fundraise analyst");

    await startNewAgent("Deck reviewer");
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));

    await waitFor(() => expect(createCall()).toBeDefined());
    expect(createCall()!.opts.body).not.toHaveProperty("acknowledgeShared");
  });

  it("🔒 the SHARED create sends NO homeScoped — a container has no shelf", async () => {
    // `personalWriteWorkspaceId` routes on it and this create is not personal;
    // an explicit `false` would widen the contract for no reason.
    renderHome();
    await openAgents();
    await screen.findByText("Renewal chaser");

    await startNewAgent("Intake triage", SHARED_BUTTON);
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));

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
        : agentRoutes(path, opts)
    );
    renderHome();
    await openAgents();
    await screen.findByText("Renewal chaser");

    // The SHARED button still writes — the container is the selected row, not
    // boot's answer. Only PERSONAL depends on there being a home workspace.
    expect(
      (screen.getByRole("button", { name: SHARED_BUTTON }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: /^New agent$/ }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });
});

describe("what the editor is allowed to ask for", () => {
  it("🔒 offers ONE visibility scope in a container, and asks for no teams", async () => {
    renderHome();
    await openAgents();
    await screen.findByText("Renewal chaser");
    await startNewAgent("Intake triage", SHARED_BUTTON);

    // ⚠ `team` is a DEAD value in a container (§4A: no teams exist there), so
    // an option for it would be this editor inviting a grant nothing could
    // hold. The shared scope reads "Shared in this channel", NEVER "Public".
    // 🔒 ⚠ `private` WENT ON 2026-08-27, and it is the important half. The pane
    // lost its per-channel private section and a container is not navigable, so
    // a private container template is reachable from NO surface — the option
    // would create write-only rows. It also means the draft must OPEN on
    // `workspace` (`defaultVisibility`), or the form's selected value is one the
    // control cannot show.
    expect(screen.getByRole("tab", { name: "Shared in this channel" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Private" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Team" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Public" })).toBeNull();

    // 🔒 AND IT NEVER ASKED. Not "the list came back empty" — the container
    // mount has no `useTeams` call at all, which is why it is its own component
    // (`agent-editor.tsx`).
    expect(
      bridgeCalls(apiRequest).filter((c) => c.path.endsWith("/teams"))
    ).toHaveLength(0);
  });

  it("offers all THREE in the caller's own workspace, where a team can exist", async () => {
    renderHome();
    await openAgents();
    await screen.findByText("Fundraise analyst");
    await startNewAgent("Deck reviewer");

    expect(screen.getByRole("tab", { name: "Private" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Team" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Public" })).toBeTruthy();
    // The Team scope is only honest if the teams behind it were fetched — the
    // Save button is disabled for a team template that names none.
    await waitFor(() =>
      expect(bridgeCalls(apiRequest).filter((c) => c.path === TEAMS_PATH).length)
        .toBeGreaterThan(0)
    );
  });

  it("attaches the TARGET workspace's knowledge bases, off the PLAIN key", async () => {
    renderHome();
    await openAgents();
    await screen.findByText("Renewal chaser");
    await startNewAgent("Intake triage", SHARED_BUTTON);

    // The container's own bases, off the PLAIN key (`useKnowledgeBaseList`) —
    // the channel-scoped entry carries `channelGrants` and belongs to the
    // Knowledge pane; the attach picker has no use for it.
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    expect(await screen.findByRole("menuitem", { name: "Call notes" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Fundraise memos" })).toBeNull();

    // 🔒 PLAIN KEY vs `?channelId=`, AND THIS HALF WAS BLIND UNTIL 2026-08-26.
    // `agent-test-fixtures.ts › agentRoutes` used to strip the query before
    // dispatching, so both entries answered with one body and the two
    // assertions above passed whichever entry the editor read. The fixture is
    // query-aware now and carries a row ONLY the channel-scoped answer has.
    expect(screen.queryByRole("menuitem", { name: CHANNEL_ONLY_BASE })).toBeNull();
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
    await openAgents();

    fireEvent.click(await screen.findByText("Fundraise analyst"));
    await screen.findByRole("dialog");
    expect(
      document.querySelector<HTMLInputElement>("#agent-template-name")!.value
    ).toBe("Fundraise analyst");

    fireEvent.change(
      document.querySelector<HTMLInputElement>("#agent-template-name")!,
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
    await openAgents();
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
    await openAgents();
    await screen.findByText("Renewal chaser");
    await startNewAgent("Intake triage", SHARED_BUTTON);
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));
    await screen.findByText("Intake triage");

    // ⚠ NO **WRITE** REACHED THE HOME WORKSPACE. It used to assert no call of
    // any method, which was only true while the home READ was lazy behind the
    // pill; Personal is always on screen now, so a GET there is expected and a
    // POST/PATCH/DELETE is the actual claim.
    expect(
      templateCalls(apiRequest, WORKSPACE_ID).filter(
        (c) => c.opts.method !== "GET"
      )
    ).toHaveLength(0);
  });
});

/**
 * "SHARE INTO THIS CHANNEL" — the GRANT (Samuel's ruling B11, 2026-09-02, wave B
 * slice B15: *grants replace copies*).
 *
 * ⚠ **THIS BLOCK WAS SIX CASES ABOUT A COPY AND IS NOW FOUR ABOUT A GRANT.**
 * The three that went were about what a COPY carried and dropped — the exact
 * create body, the "attached knowledge base stays behind" line, and the
 * stale-cache guard on `source.knowledgeBases.length` that the KB line needed.
 * A grant lends the ONE row: nothing is composed, nothing is dropped, and the
 * cached row's `knowledgeBases` is never read, so all three were assertions
 * about a mechanism rather than about a promise.
 *
 * ⚠ **THE LOAD-BEARING ASSERTION IS STILL ON THE REQUEST BODY**, and for the
 * same reason: a grant into the CHANNEL and a grant into the CONTAINER render
 * identically (as nothing), and only one of them puts the agent in front of the
 * people in the room.
 */
describe("share into this channel", () => {
  /** Reach the share control on the PERSONAL card. */
  async function openShareConfirm(): Promise<void> {
    renderHome();
    await openAgents();
    await screen.findByText("Fundraise analyst");
    fireEvent.click(
      screen.getByRole("button", { name: "Share into this channel" })
    );
    await screen.findByRole("button", { name: "Share" });
  }

  /** The grant call, or `undefined`. */
  function grantCall() {
    return bridgeCalls(apiRequest).find(
      (c) => c.path === "/api/resource-grants"
    );
  }

  it("🔒 grants the template into the CHANNEL, at the narrower channel level", async () => {
    await openShareConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => expect(grantCall()).toBeDefined());
    const call = grantCall()!;
    expect(call.opts.method).toBe("PUT");
    // 🔒 EXACT EQUALITY. `scopeType: "channel"` is the whole difference between
    // putting the agent in front of the people in the room and filing it against
    // a tenancy nobody reads; `level: "visible"` is the narrower of the two
    // channel words, where `agent_only` names no human audience at all.
    expect(call.opts.body).toEqual({
      resourceType: "agent_template",
      resourceId: T_HOME.id,
      scopeType: "channel",
      scopeId: CHANNEL_ID,
      level: "visible",
    });
  });

  it("🔒 writes NOTHING until the confirm — the dialog alone is not consent", async () => {
    // 🔒 THE SHAPE OF THE CONSENT STEP, CARRIED OVER FROM THE COPY (A11/G16).
    // The audience sentence is what the operator is pressing through, and it
    // must be on screen before anything reaches the wire.
    await openShareConfirm();
    expect(document.body.textContent).toContain("everyone here will see it");
    expect(grantCall()).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(grantCall()).toBeDefined());
  });

  it("🔒 CREATES NO TEMPLATE — the row is lent, not copied", async () => {
    // ⚠ THE ASSERTION THE WHOLE RULING TURNS ON, and it is the one a DOM-level
    // test cannot make: the old control POSTed a second `agent_templates` row.
    await openShareConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(grantCall()).toBeDefined());
    expect(createCall()).toBeUndefined();
    // …and the operator is told the thing that follows from that.
    expect(document.body.textContent).toContain("It stays yours");
  });

  it("offers no share control on a row already IN this channel", async () => {
    renderHome();
    await openAgents();
    await screen.findByText("Renewal chaser");
    // ⚠ Scoped to the SHARED region: the control lives on every Personal card,
    // so a document-wide query would find those and prove nothing about this one.
    const shared = screen.getByRole("region", { name: "Shared in this channel" });
    expect(
      within(shared).queryByRole("button", { name: "Share into this channel" })
    ).toBeNull();
  });
});
