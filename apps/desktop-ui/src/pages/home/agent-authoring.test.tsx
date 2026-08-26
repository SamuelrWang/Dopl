import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { WORKSPACE_ID, bootBody, bridgeCalls, installBridge } from "#/test-utils/bridge";
import { LINK_WORKSPACE_ID, renderHome } from "./home-test-harness";
import {
  TEAMS_PATH,
  agentRoutes,
  chooseScope,
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

/** Open the create editor and name a template, without saving it. */
async function startNewAgent(name: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /New agent/ }));
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

describe("create follows the scope pill", () => {
  it("writes into THIS CHANNEL'S container, and the row stays out of the other scope", async () => {
    renderHome();
    await openAgents();
    await screen.findByText("Scratch agent");

    // ⚠ THE HOME LIST IS WARMED FIRST, AND THAT IS THE WHOLE TEST. A cache
    // entry that holds nothing cannot be patched wrongly — `patchCache` over an
    // absent entry is a no-op — so a create against a COLD other workspace
    // passes this suite with the prefix bug still in place. Warm it, come back,
    // then write.
    await chooseScope("across all channels");
    await screen.findByText("Fundraise analyst");
    await chooseScope("in this channel");
    await screen.findByText("Scratch agent");

    await startNewAgent("Intake triage");
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));

    // The write went to the CONTAINER, and the row is on screen under the
    // channel's own private section.
    await waitFor(() => expect(createCall()).toBeDefined());
    expect(createCall()!.opts.workspaceId).toBe(LINK_WORKSPACE_ID);
    expect(await screen.findByText("Intake triage")).toBeInTheDocument();

    // 🔒 F-331. The writes patch the ENTRY key `[path, workspaceId, undefined]`,
    // not the one-element PATH prefix — over the prefix TanStack would have
    // appended this row to EVERY workspace variant of the list, so it would
    // read as a home-workspace agent too until a cold refetch.
    await chooseScope("across all channels");
    expect(await screen.findByText("Fundraise analyst")).toBeInTheDocument();
    expect(screen.queryByText("Intake triage")).not.toBeInTheDocument();
  });

  it("writes into the caller's OWN workspace once the pill says so", async () => {
    renderHome();
    await openAgents();
    await screen.findByText("Scratch agent");
    await chooseScope("across all channels");
    await screen.findByText("Fundraise analyst");

    await startNewAgent("Deck reviewer");
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));

    await waitFor(() => expect(createCall()).toBeDefined());
    expect(createCall()!.opts.workspaceId).toBe(WORKSPACE_ID);
    expect(await screen.findByText("Deck reviewer")).toBeInTheDocument();

    // 🔒 …and the mirror of the pin above: a home-workspace create must not
    // materialise in the CONTAINER's list either.
    await chooseScope("in this channel");
    expect(await screen.findByText("Scratch agent")).toBeInTheDocument();
    expect(screen.queryByText("Deck reviewer")).not.toBeInTheDocument();
  });

  it("has nowhere to write, and says so with a disabled control, before onboarding", async () => {
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
    await screen.findByText("Scratch agent");

    // In the container it still writes — the container is the selected row, not
    // boot's answer.
    expect(
      (screen.getByRole("button", { name: /New agent/ }) as HTMLButtonElement).disabled
    ).toBe(false);
    await chooseScope("across all channels");
    expect(
      (screen.getByRole("button", { name: /New agent/ }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
});

describe("what the editor is allowed to ask for", () => {
  it("offers TWO visibility scopes in a container, and asks for no teams", async () => {
    renderHome();
    await openAgents();
    await screen.findByText("Scratch agent");
    await startNewAgent("Intake triage");

    // ⚠ `team` is a DEAD value in a container (§4A: no teams exist there), so a
    // third option would be this editor inviting a grant nothing could hold.
    // The shared scope reads "Shared in this channel", NEVER "Public".
    expect(screen.getByRole("tab", { name: "Shared in this channel" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Private" })).toBeTruthy();
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
    await screen.findByText("Scratch agent");
    await chooseScope("across all channels");
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

  it("attaches the TARGET workspace's knowledge bases, not the other one's", async () => {
    renderHome();
    await openAgents();
    await screen.findByText("Scratch agent");
    await startNewAgent("Intake triage");

    // The container's own bases, off the PLAIN key (`useKnowledgeBaseList`) —
    // the channel-scoped entry carries `channelGrants` and belongs to the
    // Knowledge pane; the attach picker has no use for it.
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    expect(await screen.findByRole("menuitem", { name: "Call notes" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Fundraise memos" })).toBeNull();
  });
});

describe("editing an existing row", () => {
  it("opens against the workspace the row LIVES in, not the one on screen", async () => {
    renderHome();
    await openAgents();
    await screen.findByText("Scratch agent");
    await chooseScope("across all channels");

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

    // 🔒 A scope-C row is a HOME-workspace row. Its PATCH takes the HOME
    // workspace id — reading one list and writing another is the cross-workspace
    // bug the entry key exists to prevent.
    await waitFor(() => {
      const patch = bridgeCalls(apiRequest).find((c) => c.opts.method === "PATCH");
      expect(patch?.opts.workspaceId).toBe(WORKSPACE_ID);
    });
    expect(await screen.findByText("Fundraise analyst v2")).toBeInTheDocument();
  });

  it("opens a SHARED row against the container even while the pill points elsewhere", async () => {
    renderHome();
    await openAgents();
    await screen.findByText("Renewal chaser");
    await chooseScope("across all channels");
    await screen.findByText("Fundraise analyst");

    // Section A never moves with the pill: it is a different question, and its
    // rows are container rows whatever the private section is showing.
    fireEvent.click(screen.getByText("Priya's intake bot"));
    await screen.findByRole("dialog");
    // The container mount, so the two-option scope set — proof enough that the
    // pill did not decide this.
    expect(screen.getByRole("tab", { name: "Shared in this channel" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Public" })).toBeNull();
  });
});

describe("the writes stay in their own workspace", () => {
  it("never addresses the home workspace while creating in the container", async () => {
    renderHome();
    await openAgents();
    await screen.findByText("Scratch agent");
    await startNewAgent("Intake triage");
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));
    await screen.findByText("Intake triage");

    // Not one call of any method reached the home workspace: the pill was never
    // moved, so scope C was never fetched and never written.
    expect(templateCalls(apiRequest, WORKSPACE_ID)).toHaveLength(0);
  });
});
