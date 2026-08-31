// @vitest-environment jsdom
/**
 * THE COMPOSER'S LAUNCH PANEL — the Bot icon's whole surface (2026-08-27, Samuel's ruling).
 *
 * ⚠ THE TEMPLATE CHEVRON'S PINS ARE DELETED WITH THE CHEVRON, and that is stated rather than
 * quietly absorbed. Five cases stood here — one-click blank launch, the picker opening from the
 * chevron, the chevron not opening the thread panel, no chevron without the bridge, the chevron
 * disabled mid-launch. **The act they protected did not go away; it moved into the panel**, and
 * every one of them has a replacement below: the blank launch is the Template row's first option,
 * the picker's job is that row, and "three glyphs, three acts" is now two.
 *
 * The properties this file exists for, all of which fail SILENTLY:
 *
 *  - **THE ID THE PANEL SHOWS IS THE ID THE AGENT GETS.** It is pre-assigned before the spawn
 *    (`sessions.mintAgentId`) and carried on the launch. If the desktop drops it, the operator
 *    reads an address that reaches nobody — so the payload assertion is on the VALUE.
 *  - **THE OLD-DESKTOP ARM SHOWS NOTHING RATHER THAN A GUESS.** A build with no `mintAgentId`
 *    cannot honour a pre-assigned id either, and a panel that invented one would be lying about
 *    the one string the operator is meant to quote.
 *  - **SPAWN-IDLE SURVIVES.** The description is METADATA, not a first turn. A launch that sent
 *    one would wake every agent and retire ruling 3 by accident.
 *  - **NAME AND DESCRIPTION ARE WRITTEN AFTER THE SPAWN**, keyed to the address main returned.
 *
 * ⚠ `useThreadWrites` and the template read are MOCKED — this file is about the LAUNCH payload
 * and the identity writes, not about the write layer or the templates endpoint.
 */

import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const send = vi.fn();
const fanOutThreads = vi.fn();

vi.mock("../../hooks/use-thread-writes", () => ({
  useThreadWrites: () => ({
    send: { mutate: send },
    fanOutThreads: { mutate: fanOutThreads },
    pending: false,
  }),
}));

const templateList = vi.hoisted(() => ({ templates: [] as unknown[] }));
vi.mock("@/features/agent-templates/hooks/use-agent-templates", () => ({
  useAgentTemplates: () => ({
    templates: templateList.templates,
    loading: false,
    error: null,
    resolved: true,
    refetch: () => {},
  }),
}));

import { ChannelsV2Composer } from "./composer";
import type { AgentLaunchControls } from "./use-agents-panel";
import { member, CHANNEL_ID, ME, PEER } from "./test-fixtures";

const THIRD = "u-third";
const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang" }),
  member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
  member({ userId: THIRD, displayName: "Ada Lovelace", role: "member" }),
];

/** A real id by `main/agent-id.js`'s charset — a letter, then seven of [a-z0-9]. */
const MINTED = "k3v7d2mq";

const rename = vi.fn();
const describe_ = vi.fn();
const mintAgentId = vi.fn();

/**
 * Stand up just enough bridge for the panel's three probes.
 *
 * ⚠ `apiRequest` IS THE SPA MARKER (`spa-bridge.ts › getSpaBridge`) — without it the whole
 * bridge reads as absent and every probe answers false, which looks exactly like an old desktop.
 */
function stubBridge(over: Record<string, unknown> = {}) {
  (window as { dopl?: unknown }).dopl = {
    apiRequest: () => Promise.resolve({ status: 200, statusText: "OK", hasBody: false }),
    sessions: { mintAgentId, rename, describe: describe_, ...over },
  };
}

beforeEach(() => {
  send.mockClear();
  fanOutThreads.mockClear();
  rename.mockReset().mockResolvedValue({ ok: true });
  describe_.mockReset().mockResolvedValue({ ok: true });
  mintAgentId.mockReset().mockResolvedValue({ ok: true, agentId: MINTED });
  stubBridge();
});
afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
  templateList.templates = [];
});

function launcher(over: Partial<AgentLaunchControls> = {}): AgentLaunchControls {
  return {
    canLaunch: true,
    launchBusy: false,
    launchError: null,
    // ⚠ ANSWERS AN `agentId`, as a current main does. The panel paints MAIN'S answer, so a stub
    // that returned none would silently exercise the old-desktop arm in every case.
    launchAgent: vi.fn().mockResolvedValue({ ok: true, agentId: MINTED }),
    approveTemplate: vi.fn().mockResolvedValue({ ok: true }),
    ...over,
  };
}

/**
 * ⚠ MOUNTED UNDER `StrictMode`, AND THAT IS THE WHOLE POINT OF THIS HELPER. The defect it pins is
 * an IMPURE STATE UPDATER — a `mintAgentId()` call inside `setOpen(...)` — and React only
 * double-invokes updaters under StrictMode. Testing-library's plain `render` runs it once, so the
 * ordinary `mount` below reports ONE call whether the code is correct or not.
 * **Measured: with the mint moved back inside the updater, `mount` stays green and this fails.**
 */
function mountStrict(over: Partial<React.ComponentProps<typeof ChannelsV2Composer>> = {}) {
  render(
    <StrictMode>
      <ChannelsV2Composer
        channelId={CHANNEL_ID}
        workspaceId="ws-1"
        members={MEMBERS}
        currentUserId={ME}
        gate={{ begin: vi.fn(), end: vi.fn() }}
        {...over}
      />
    </StrictMode>
  );
}

function mount(over: Partial<React.ComponentProps<typeof ChannelsV2Composer>> = {}) {
  render(
    <ChannelsV2Composer
      channelId={CHANNEL_ID}
      workspaceId="ws-1"
      members={MEMBERS}
      currentUserId={ME}
      gate={{ begin: vi.fn(), end: vi.fn() }}
      {...over}
    />
  );
}

const botIcon = () =>
  screen.getByRole("button", { name: "New Agent" }) as HTMLButtonElement;
const panelOpen = () => botIcon().getAttribute("aria-pressed");
const nameField = () => screen.getByLabelText("Agent name") as HTMLInputElement;
const descField = () => screen.getByLabelText("Agent description") as HTMLTextAreaElement;
/** ⚠ THE COMPOSER'S OWN SEND CONTROL, WEARING "Launch" (Samuel, 2026-08-27). The panel has no
 *  button of its own any more — one submit, context-labeled, exactly as the thread panel's
 *  becomes "Create". Addressing it by that accessible name IS the pin. */
const launchButton = () => screen.getByRole("button", { name: "Launch" }) as HTMLButtonElement;

/** Open the panel and wait for the mint to land in the Name field. */
async function openPanel() {
  fireEvent.click(botIcon());
  await waitFor(() => expect(nameField().value).toBe(`#${MINTED}`));
}

// ── 1. THE CONTROL ───────────────────────────────────────────────────────────

describe("the Bot icon opens a panel — it no longer launches on the click", () => {
  it("opens the panel and starts NOTHING", async () => {
    const controls = launcher();
    mount({ newAgent: controls });
    expect(panelOpen()).toBe("false");

    await openPanel();
    expect(panelOpen()).toBe("true");
    // ⚠ THE POINT OF THE WHOLE CHANGE. The click used to spawn a blank agent outright.
    expect(controls.launchAgent).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(fanOutThreads).not.toHaveBeenCalled();
  });

  it("has NO template chevron — one control chooses the identity, and it is the panel", () => {
    mount({ newAgent: launcher() });
    // ⚠ THE DELETED PIN, INVERTED. Re-adding the chevron gives two ways to pick an identity,
    // which is how the Bot icon and the thread panel came to mean one thing in 2026-08-21.
    expect(screen.queryByRole("button", { name: "Launch from template" })).toBeNull();
  });

  it("renders NO Bot icon at all when the bridge cannot launch", () => {
    mount({ newAgent: launcher({ canLaunch: false }) });
    expect(screen.queryByRole("button", { name: "New Agent" })).toBeNull();
    // ⚠ And the thread panel is untouched by that absence — it is a WRITE, not a bridge op,
    // and it works in a plain browser.
    expect(screen.getByRole("button", { name: "New thread" })).toBeTruthy();
  });

  it("renders no Bot icon with no launch controls handed down", () => {
    mount();
    expect(screen.queryByRole("button", { name: "New Agent" })).toBeNull();
  });

  it("disables the Bot icon ONLY while a launch is in flight", () => {
    mount({ newAgent: launcher({ launchBusy: true }) });
    expect(botIcon().disabled).toBe(true);
  });

  it("says a refusal out loud rather than swallowing it", () => {
    mount({ newAgent: launcher({ launchError: "Session limit reached" }) });
    expect(screen.getByRole("alert").textContent).toBe("Session limit reached");
  });
});

// ── 2. THE PRE-ASSIGNED ID ───────────────────────────────────────────────────

describe("the ID is assigned before the spawn", () => {
  it("mints EXACTLY ONCE per open, and the prefill is THAT id", async () => {
    // ⚠ THE BUG THIS PINS (Samuel, 2026-08-27, from a screenshot reading Name `#k3wpf7c5`
    // over ID `uyxw3rdv`): the mint lived inside the `setOpen` UPDATER. A state updater must be
    // pure — React runs it twice under StrictMode and again on any rebase — so two ids were drawn.
    // The second won `agentId`; the prefill guard was already false and kept the FIRST id's name.
    // ⚠ MUTATION-PROOF: put the mint back inside the updater and the CALL COUNT fails here.
    mountStrict({ newAgent: launcher() });
    await openPanel();
    expect(mintAgentId).toHaveBeenCalledTimes(1);
    // ⚠ AND THE NAME IS THAT id. With two draws these disagreed — the second won `agentId` and
    // the first kept the name — which is exactly what the screenshot showed.
    expect(nameField().value).toBe(`#${MINTED}`);
  });

  it("does not re-mint while the panel stays open", async () => {
    mount({ newAgent: launcher() });
    await openPanel();
    // Typing must not draw a second id — the forwarded one is settled at open.
    fireEvent.change(nameField(), { target: { value: "Research" } });
    expect(mintAgentId).toHaveBeenCalledTimes(1);
  });

  it("shows the id NOWHERE — Name is the only identity field (Samuel, 2026-08-27)", () => {
    // ⚠ THE ID DID NOT GO AWAY, THE ROW DID. It is still minted, still forwarded, still what
    // disambiguates two agents an operator gave the same name — it is simply not a field the
    // operator reads. `queryByLabelText` covers a row that comes back wearing a different label.
    mount({ newAgent: launcher() });
    fireEvent.click(botIcon());
    expect(screen.queryByLabelText(/agent id/i)).toBeNull();
    expect(screen.queryByText(MINTED)).toBeNull();
  });

  it("CARRIES that id on the launch — the panel's id is the agent's id", async () => {
    const controls = launcher();
    mount({ newAgent: controls, openThreadId: "t-1" });
    await openPanel();
    fireEvent.click(launchButton());

    await waitFor(() => expect(controls.launchAgent).toHaveBeenCalled());
    // ⚠ THE FOURTH ARGUMENT, ASSERTED BY VALUE. A dropped forward anywhere in the chain leaves
    // the operator quoting an address that reaches nobody.
    expect(vi.mocked(controls.launchAgent).mock.calls[0][3]).toBe(MINTED);
  });

  it("an OLD DESKTOP pre-assigns none, and prefills nothing — never a guess", async () => {
    // ⚠ THE FALLBACK ARM. No `mintAgentId` op ⇒ this build cannot honour a pre-assigned id
    // either, so nothing is forwarded and the Name field has no id to prefill from. A prefill
    // here would name an agent after an id it was never going to have.
    stubBridge({ mintAgentId: undefined });
    const controls = launcher();
    mount({ newAgent: controls });

    fireEvent.click(botIcon());
    expect(nameField().value).toBe("");

    fireEvent.change(nameField(), { target: { value: "Research" } });
    fireEvent.click(launchButton());
    await waitFor(() => expect(controls.launchAgent).toHaveBeenCalled());
    expect(vi.mocked(controls.launchAgent).mock.calls[0][3]).toBeUndefined();
  });

  it("paints MAIN'S id, not the pre-assigned one, when they disagree", async () => {
    // ⚠ NEVER AN ECHO. A desktop older than the forward accepts the field and mints its own; the
    // reply is the authority and is what the metadata is filed under.
    const controls = launcher({
      launchAgent: vi.fn().mockResolvedValue({ ok: true, agentId: "zzzzzzzz" }),
    });
    mount({ newAgent: controls });
    await openPanel();
    fireEvent.change(nameField(), { target: { value: "Research" } });
    fireEvent.click(launchButton());

    await waitFor(() => expect(rename).toHaveBeenCalled());
    expect(rename.mock.calls[0][0]).toBe("zzzzzzzz");
  });
});

// ── 3. THE PAYLOAD ───────────────────────────────────────────────────────────

describe("what Launch puts on the wire", () => {
  it("a BLANK agent carries no template and no model override", async () => {
    const controls = launcher();
    mount({ newAgent: controls, openThreadId: "t-1" });
    await openPanel();
    fireEvent.click(launchButton());

    await waitFor(() => expect(controls.launchAgent).toHaveBeenCalled());
    const [threadId, templateId, overrides] = vi.mocked(controls.launchAgent).mock.calls[0];
    expect(threadId).toBe("t-1");
    // ⚠ A blank agent is the Template row's FIRST option and a real configuration — `null`, and
    // `undefined` overrides, is byte-identical to what the one-click Bot icon always sent.
    expect(templateId).toBeNull();
    expect(overrides).toBeUndefined();
  });

  it("a CHANNEL-LEVEL agent passes null, not the empty string", async () => {
    // ⚠ `""` is already a real wire value ("a responder whose thread never became first-class"),
    // so the two must not collapse into one.
    const controls = launcher();
    mount({ newAgent: controls });
    await openPanel();
    fireEvent.click(launchButton());
    await waitFor(() => expect(controls.launchAgent).toHaveBeenCalled());
    expect(vi.mocked(controls.launchAgent).mock.calls[0][0]).toBeNull();
  });

  it("a CHOSEN template rides as its id — the chevron's job, in a row", async () => {
    // ⚠ `createdBy: ME` so the row wears NO authorship marker and its accessible
    // name is the bare template name. A foreign template's name carries "by …"
    // since 2026-08-30 (ledger ASK-21) — that is `composer-launch-marker.test.tsx`'s
    // subject, and pinning it here too would make this case fail for a reason
    // that has nothing to do with what rides the wire.
    templateList.templates = [
      { id: "tpl-9", name: "Code auditor", workspaceId: "ws-1", createdBy: ME },
    ];
    const controls = launcher();
    mount({ newAgent: controls });
    await openPanel();

    fireEvent.click(screen.getByRole("button", { name: "Agent template" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Code auditor" }));
    fireEvent.click(launchButton());

    await waitFor(() => expect(controls.launchAgent).toHaveBeenCalled());
    // ⚠ AN ID, NEVER A SNAPSHOT. Main resolves the CONTENT under the operator's own credential
    // at spawn; renderer-supplied instructions would be renderer-authored prompt text.
    expect(vi.mocked(controls.launchAgent).mock.calls[0][1]).toBe("tpl-9");
  });

  it("a CHOSEN model rides as an override; Default sends none", async () => {
    const controls = launcher();
    mount({ newAgent: controls });
    await openPanel();

    fireEvent.click(screen.getByRole("button", { name: "Agent model" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Opus 5" }));
    fireEvent.click(launchButton());

    await waitFor(() => expect(controls.launchAgent).toHaveBeenCalled());
    const overrides = vi.mocked(controls.launchAgent).mock.calls[0][2];
    expect(overrides?.model).toBeTruthy();
    expect(overrides?.model).not.toBe("");
  });
});

// ── 4. THE IDENTITY WRITES ───────────────────────────────────────────────────

describe("name and description are written AFTER the spawn", () => {
  it("writes both, keyed to the address main returned", async () => {
    const controls = launcher();
    mount({ newAgent: controls });
    await openPanel();
    fireEvent.change(nameField(), { target: { value: "Research" } });
    fireEvent.change(descField(), { target: { value: "Audits the diff." } });
    fireEvent.click(launchButton());

    await waitFor(() => expect(describe_).toHaveBeenCalled());
    expect(rename).toHaveBeenCalledWith(MINTED, "Research");
    expect(describe_).toHaveBeenCalledWith(MINTED, "Audits the diff.");
  });

  it("SPAWN IDLE: the description is metadata, never a first turn", async () => {
    // ⚠ RULING 3. The obvious wrong wiring for a description is `sessions.message`, which would
    // wake every launched agent. Nothing on this lane sends a turn — the desktop half of this
    // property is pinned in `dopl-desktop-app/test/launch-agent-id.test.mjs`.
    const message = vi.fn();
    stubBridge({ message });
    const controls = launcher();
    mount({ newAgent: controls });
    await openPanel();
    fireEvent.change(descField(), { target: { value: "Audits the diff." } });
    fireEvent.click(launchButton());

    await waitFor(() => expect(describe_).toHaveBeenCalled());
    expect(message).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("does NOT re-write the prefilled name as a custom one", async () => {
    // ⚠ `Agent #<id>` IS THE FALLBACK, not a name. Storing it would file a "custom" name
    // identical to the default, so the operator could never get back to a nameless agent.
    const controls = launcher();
    mount({ newAgent: controls });
    await openPanel();
    fireEvent.click(launchButton());

    await waitFor(() => expect(controls.launchAgent).toHaveBeenCalled());
    expect(rename).not.toHaveBeenCalled();
  });

  it("an empty description writes nothing — absent is not the empty string", async () => {
    const controls = launcher();
    mount({ newAgent: controls });
    await openPanel();
    fireEvent.change(nameField(), { target: { value: "Research" } });
    fireEvent.click(launchButton());

    await waitFor(() => expect(rename).toHaveBeenCalled());
    expect(describe_).not.toHaveBeenCalled();
  });

  it("a REFUSED write does not fail the launch, and is not silent either", async () => {
    // ⚠ THE AGENT IS ALREADY RUNNING. Reporting "launch failed" would be a lie about the thing
    // that mattered; swallowing it would lose the operator's words with no trace.
    rename.mockResolvedValue({ ok: false, reason: "bad-name" });
    const controls = launcher();
    mount({ newAgent: controls });
    await openPanel();
    fireEvent.change(nameField(), { target: { value: "Research" } });
    fireEvent.click(launchButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/name or description was not saved/);
    // The panel stays open holding the report rather than closing over it.
    expect(panelOpen()).toBe("true");
  });
});

// ── 5. ONE EDIT SURFACE ──────────────────────────────────────────────────────

describe("the launch panel and the thread panel share one slot", () => {
  it("opening one closes the other — never two forms and two submits", async () => {
    mount({ newAgent: launcher() });
    await openPanel();

    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    expect(panelOpen()).toBe("false");
    expect(
      screen.getByRole("button", { name: "New thread" }).getAttribute("aria-pressed")
    ).toBe("true");

    fireEvent.click(botIcon());
    expect(
      screen.getByRole("button", { name: "New thread" }).getAttribute("aria-pressed")
    ).toBe("false");
  });

  it("takes the chat textarea off screen, and gives the draft back", async () => {
    mount({ newAgent: launcher() });
    const body = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: "morning, all" } });

    await openPanel();
    expect(screen.queryByLabelText("Message")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close new agent" }));
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("morning, all");
  });

  it("is NOT LAUNCHABLE with no name, and says why", async () => {
    // ⚠ DISABLED WITH A REASON survived the move onto the kit's send face — `SendButton` grew a
    // `title` for exactly this (INVARIANTS §8, rule 4).
    stubBridge({ mintAgentId: undefined });
    mount({ newAgent: launcher() });
    fireEvent.click(botIcon());

    expect(launchButton().disabled).toBe(true);
    expect(launchButton().title).toBe("An agent needs a name");
  });

  it("the panel carries NO submit of its own — one control, context-labeled", async () => {
    // ⚠ TWO SUBMITS ON ONE CARD IS TWO ANSWERS to "what does pressing this do". The composer's
    // send button IS the launch control; a second button inside the panel is the regression.
    mount({ newAgent: launcher() });
    await openPanel();
    expect(screen.getAllByRole("button", { name: "Launch" })).toHaveLength(1);
  });

  it("DISCARD appears only once the panel holds something", async () => {
    mount({ newAgent: launcher({ canLaunch: true }) });
    // Closed and empty: nothing to discard.
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
    await openPanel();
    // Open with only the prefilled name — that IS content the operator can clear.
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
  });
});

// ⚠ THE SHARED FIELD KIT'S PINS ARE `panel-field.test.tsx` (2026-08-27) — the underline's node,
// text-only underlining, and the label's auto width. It is `PanelField`, which BOTH panels mount,
// so asserting it from one panel's suite made the other the wrong place to add the next case.
