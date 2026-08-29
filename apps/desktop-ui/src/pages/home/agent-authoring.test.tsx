import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { WORKSPACE_ID, bootBody, bridgeCalls, installBridge } from "#/test-utils/bridge";
import { LINK_WORKSPACE_ID, renderHome } from "./home-test-harness";
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

  it("🔒 the SHARED create sends NO homeScoped — a container has no shelf", async () => {
    // `resolveTemplateHomeScope` would 403 it, and an explicit `false` would
    // widen the contract the fence has to allow for no reason.
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
 * "USE IN THIS CHANNEL" — the COPY (plan §3, M4, Samuel's ruling Q2).
 *
 * ⚠ THE LOAD-BEARING ASSERTION IS ON THE REQUEST BODY. What the copy CARRIES
 * and what it DROPS is not visible on screen — a container row with no bases
 * and a container row with the home row's bases render identically — so a suite
 * that only looked at the DOM would pass while the write 400d on an
 * unreachable KB id.
 */
describe("use in this channel", () => {
  /** Reach the copy control on the PERSONAL card. */
  async function openCopyConfirm(): Promise<void> {
    renderHome();
    await openAgents();
    await screen.findByText("Fundraise analyst");
    fireEvent.click(screen.getByRole("button", { name: "Use in this channel" }));
    await screen.findByRole("button", { name: "Make a copy" });
  }

  it("🔒 posts a SHARED copy to the CONTAINER, with the knowledge bases dropped", async () => {
    await openCopyConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Make a copy" }));

    await waitFor(() => expect(createCall()).toBeDefined());
    const call = createCall()!;
    // 🔒 THE CONTAINER, not the workspace the row came from.
    expect(call.opts.workspaceId).toBe(LINK_WORKSPACE_ID);
    // 🔒 `workspace`, AND IT WAS `private` UNTIL 2026-08-27 — see
    // `lib/template-draft.test.ts › SHARES into the channel`. The pane's
    // per-channel private section is gone and a container is not navigable, so
    // a private copy would land nowhere visible; the audience change is stated
    // in the confirm dialog instead of hidden.
    // ⚠ `teamIds` and `knowledgeBaseIds` absent, which is what "cleared" means
    // on a create body. The name carries UNCHANGED — no "(copy)" suffix,
    // because templates have no name uniqueness to dodge.
    expect(call.opts.body).toEqual({
      name: "Fundraise analyst",
      visibility: "workspace",
      description: "Reads the data room",
      instructions: "Cite the memo.",
      model: "claude-opus-5",
      fields: [{ key: "round", value: "seed" }],
    });
  });

  it("says the knowledge bases stay behind BEFORE anything is written", async () => {
    await openCopyConfirm();
    // ⚠ The drop is a rule the operator has to know in advance: the copy is not
    // the agent they were using, it is that agent without its reading. One line,
    // and it names the count.
    expect(document.body.textContent).toContain("attached knowledge base stays behind");
    expect(document.body.textContent).toContain("snapshot");
    expect(createCall()).toBeUndefined();
  });

  it("lands the copy in the SHARED section, and NOT in the home shelf (F-331)", async () => {
    await openCopyConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Make a copy" }));

    // The copy appears in SHARED — with both sections on screen there is no
    // scope to switch back to, which is what the old "the pill follows the copy
    // home" step was compensating for.
    const shared = () => screen.getByRole("region", { name: "Shared in this channel" });
    await waitFor(() => expect(shared().textContent).toContain("Fundraise analyst"));

    // 🔒 …AND THE OTHER SHELF IS UNCHANGED, WHICH IS THE HALF THAT KEEPS THIS AN
    // F-331 PIN. Over the one-element PATH prefix the created CONTAINER row
    // would be appended to the warmed HOME entry as well — and since 2026-08-27
    // the home entry is keyed by `{shelf:"home"}`, so a writer that kept
    // passing `undefined` would miss it in the other direction. ⚠ Counted by
    // the COPY CONTROL, not by the name: the copy carries the original's name
    // unchanged, so two identical names is exactly the state a name-count
    // cannot see.
    const personal = screen.getByRole("region", { name: "Personal" });
    expect(
      within(personal).getAllByRole("button", { name: "Use in this channel" })
    ).toHaveLength(1);
  });

  it("still renders the confirm step when the cached row predates `knowledgeBases`", async () => {
    // ⚠ §8's STALE-CACHE RULE, on a payload this pane reads out of a CACHE
    // ENTRY rather than off a fresh response: the row can have been written by
    // an older build of the app. `source.knowledgeBases.length` with no
    // fallback throws inside the render of an already-open dialog, which blanks
    // the surface instead of showing a sentence — the worst place for it.
    apiRequest.mockImplementation((path: string, opts: BridgeRequestOpts = {}) => {
      if (path.split("?")[0] === "/api/agent-templates" && opts.workspaceId === WORKSPACE_ID) {
        const stale = { ...T_HOME } as Partial<typeof T_HOME>;
        delete stale.knowledgeBases;
        return Promise.resolve({
          status: 200,
          statusText: "OK",
          hasBody: true,
          body: { templates: [stale] },
        });
      }
      return agentRoutes(path, opts);
    });
    renderHome();
    await openAgents();
    await screen.findByText("Fundraise analyst");

    fireEvent.click(screen.getByRole("button", { name: "Use in this channel" }));
    // The dialog opens and the snapshot sentence is there; the KB line is
    // correctly absent, because a payload with no field carries no attachments
    // to warn about.
    expect(await screen.findByRole("button", { name: "Make a copy" })).toBeTruthy();
    expect(document.body.textContent).toContain("snapshot");
    expect(document.body.textContent).not.toContain("stays behind");
  });

  it("offers no copy control on a row already IN this channel", async () => {
    renderHome();
    await openAgents();
    await screen.findByText("Renewal chaser");
    // Copying a container row into its own container is a copy of a thing into
    // the place it already is. ⚠ Scoped to the SHARED region: the control lives
    // on every Personal card now, so a document-wide query would find those and
    // prove nothing about this one.
    const shared = screen.getByRole("region", { name: "Shared in this channel" });
    expect(
      within(shared).queryByRole("button", { name: "Use in this channel" })
    ).toBeNull();
  });
});
