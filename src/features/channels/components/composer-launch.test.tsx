// @vitest-environment jsdom
/**
 * THE COMPOSER'S LAUNCH PANEL — the Bot icon's whole surface (2026-08-27, Samuel's ruling).
 *
 * ⚠ THE TEMPLATE CHEVRON'S PINS WENT WITH THE CHEVRON; the act they protected moved into the
 * FORM, and each has a replacement below. ⚠ AND THE FORM IS A CENTERED POPUP SINCE 2026-09-08
 * (`launch-agent-dialog.tsx`) — the Bot icon and the launch lane are unchanged; the submit and
 * the two exits now live in the dialog.
 *
 * The properties this file exists for, all of which fail SILENTLY:
 *
 *  - **THE ID THE FORM SHOWS IS THE ID THE AGENT GETS** — pre-assigned before the spawn
 *    (`sessions.mintAgentId`) and carried on the launch, so the payload assertion is on the VALUE.
 *  - **THE OLD-DESKTOP ARM SHOWS NOTHING RATHER THAN A GUESS.** A build with no `mintAgentId`
 *    cannot honour a pre-assigned id either, and an invented one would lie about the one string
 *    the operator is meant to quote.
 *  - **SPAWN-IDLE SURVIVES.** The description is METADATA, not a first turn; a launch that sent
 *    one would wake every agent and retire ruling 3 by accident.
 *  - **NAME AND DESCRIPTION ARE WRITTEN AFTER THE SPAWN**, keyed to the address main returned.
 *
 * ⚠ `useThreadWrites` and the template read are MOCKED — this file is about the LAUNCH payload
 * and the identity writes, not the write layer or the templates endpoint. */

import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const send = vi.fn();
const fanOutThreads = vi.fn();

vi.mock("../hooks/use-thread-writes", () => ({
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

import { ChannelsComposer } from "./composer";
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

/** ⚠ `StrictMode` IS THE WHOLE POINT OF THIS HELPER. The defect it pins is an IMPURE STATE
 *  UPDATER — `mintAgentId()` inside `setOpen(...)` — and React double-invokes updaters only
 *  under StrictMode, so the plain `mount` below reports ONE call either way. **Measured: with
 *  the mint back inside the updater, `mount` stays green and this fails.** */
function mountStrict(over: Partial<React.ComponentProps<typeof ChannelsComposer>> = {}) {
  render(
    <StrictMode>
      <ChannelsComposer
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

function mount(over: Partial<React.ComponentProps<typeof ChannelsComposer>> = {}) {
  render(
    <ChannelsComposer
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
/** ⚠ THE DIALOG'S OWN SUBMIT SINCE 2026-09-08 — it was the COMPOSER's send control wearing
 *  "Launch". There is still exactly one on screen, so the accessible name is still the pin. */
const launchButton = () => screen.getByRole("button", { name: "Launch" }) as HTMLButtonElement;

/** ⚠ `waitFor` covers TWO async steps since 2026-09-08: the mint AND `ModalShell`'s rAF. */
async function openPanel() {
  fireEvent.click(botIcon());
  // ⚠ THE MINT NO LONGER SHOWS IN THE NAME FIELD (2026-09-15): the signal is the CALL, then the rAF mount the prefill assertion used to wait out for free.
  await waitFor(() => expect(mintAgentId).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole("button", { name: "Launch" })).toBeTruthy());
}

/** On a build that pre-assigns NO id there is no prefill to wait on — the wait is the dialog. */
async function openPanelBare() {
  fireEvent.click(botIcon());
  await waitFor(() => expect(nameField()).toBeTruthy());
}

/** ⚠ `tab`, not `menuitem`: Template/Model/Runtime are `SegmentedControl` rows now, not
 *  dropdowns (Samuel: *"instead of a dropdown, I think it should be a selector"*). */
const pill = (name: string | RegExp) => screen.getByRole("tab", { name });

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
  it("mints EXACTLY ONCE per open, and the field stays blank", async () => {
    // ⚠ THE BUG THIS PINS (Samuel, 2026-08-27, from a screenshot reading Name `#k3wpf7c5` over
    // ID `uyxw3rdv`): the mint lived inside the `setOpen` UPDATER, which React runs twice under
    // StrictMode, so two ids were drawn — the second won `agentId`, the first kept the name.
    // ⚠ MUTATION-PROOF: put the mint back inside the updater and the CALL COUNT fails here.
    mountStrict({ newAgent: launcher() });
    await openPanel();
    expect(mintAgentId).toHaveBeenCalledTimes(1);
    // ⚠ **THE NAME HALF OF THE 2026-08-27 CASE IS RETIRED (2026-09-15)** — no name to compare against. The CALL COUNT caught the bug; the blank assertion keeps a prefill out.
    expect(nameField().value).toBe("");
  });

  it("does not re-mint while the panel stays open", async () => {
    mount({ newAgent: launcher() });
    await openPanel();
    // Typing must not draw a second id — the forwarded one is settled at open.
    fireEvent.change(nameField(), { target: { value: "Research" } });
    expect(mintAgentId).toHaveBeenCalledTimes(1);
  });

  it("shows the id NOWHERE — Name is the only identity field (Samuel, 2026-08-27)", async () => {
    // ⚠ THE ID DID NOT GO AWAY, THE ROW DID — still minted, still forwarded, simply not a field
    // the operator reads. `queryByLabelText` covers a row returning under a different label.
    mount({ newAgent: launcher() });
    // ⚠ AWAITED, NOT FIRED-AND-QUERIED: `ModalShell` mounts on a rAF, so a synchronous query
    // after the click would pass over a row that is there.
    await openPanel();
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

    await openPanelBare();
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
    // ⚠ `createdBy: ME` so the row wears NO authorship marker and its accessible name is the
    // bare template name — the marker is `composer-launch-marker.test.tsx`'s subject (ledger
    // ASK-21, 2026-08-30), and pinning it here would fail this case for the wrong reason.
    templateList.templates = [
      { id: "tpl-9", name: "Code auditor", workspaceId: "ws-1", createdBy: ME },
    ];
    const controls = launcher();
    mount({ newAgent: controls });
    await openPanel();

    fireEvent.click(pill("Code auditor"));
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

    fireEvent.click(pill("Opus 5"));
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

  it("names a BLANK launch `New Agent` rather than leaving it nameless", async () => {
    // ⚠ **THIS ASSERTED `rename` WAS NOT CALLED UNTIL 2026-09-15** — `#<id>` was the fallback and storing it filed a "custom" name identical to it; both halves are gone.
    // ⚠ **THE STORE PUTS IT IN THE HANDLE NAMESPACE**: two blank launches CONTEST `@new-agent` and get a diagnostic, where two nameless ones reach nobody in silence.
    const controls = launcher();
    mount({ newAgent: controls });
    await openPanel();
    fireEvent.click(launchButton());

    await waitFor(() => expect(controls.launchAgent).toHaveBeenCalled());
    await waitFor(() => expect(rename).toHaveBeenCalledWith(MINTED, "New Agent"));
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

describe("the two composer forms never stand at once", () => {
  it("the New thread glyph closes the launch form on its way to the popup", async () => {
    // ⚠ ONE DIRECTION ONLY SINCE 2026-09-08, and that is the honest shape. Both forms are modals;
    // the thread popup draws a scrim over this toolbar, so the Bot icon CANNOT be pressed while
    // it stands and cannot be asked to close it. What the card still owes is the other way round:
    // the glyph is reachable while the launch dialog is up, and it shuts that form rather than
    // stacking a second one over it (`composer.tsx › onNewThread` calls `launch.close()`).
    mount({ newAgent: launcher() });
    await openPanel();
    expect(panelOpen()).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    expect(panelOpen()).toBe("false");
    // ⚠ `waitFor` ON BOTH HALVES: `ModalShell` opens behind a rAF and leaves behind an exit
    // transition, so the popup arrives a tick late and the launch form departs a tick late.
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "New thread" })).toBeTruthy()
    );
    await waitFor(() => expect(screen.queryByLabelText("Agent name")).toBeNull());
  });

  it("LEAVES the chat textarea mounted, and leaves the draft in it", async () => {
    // ⚠ SUPERSEDED BY THE POPUP. "One edit surface at a time" unmounted the textarea because
    // the form stood ON this card; what it protected — a draft surviving the detour — is here.
    mount({ newAgent: launcher() });
    const body = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: "morning, all" } });

    await openPanel();
    expect(screen.getByLabelText("Message")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close new agent" }));
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("morning, all");
  });

  it("IS LAUNCHABLE WITH NO NAME — a blank one becomes `New Agent`", async () => {
    // ⚠ **THIS ASSERTED THE OPPOSITE UNTIL 2026-09-15** — `disabled` plus INVARIANTS §8 rule 4's *"An agent needs a name"*. The field OPENS blank now, so that gate would leave a freshly opened dialog un-launchable; naming happens once on the way out (`use-agent-launch-run.ts › launchWithIdentity`).
    // ⚠ AND THIS IS THE OLD-DESKTOP ARM — no `mintAgentId`, no pre-assigned address, still launchable.
    stubBridge({ mintAgentId: undefined });
    mount({ newAgent: launcher() });
    await openPanelBare();

    expect(launchButton().disabled).toBe(false);
    expect(launchButton().title).toBe("Launch");
  });

  it("there is exactly ONE Launch on screen — the dialog's", async () => {
    // ⚠ THE 2026-08-27 RULE ("two submits on ONE CARD is two answers") still holds: the
    // composer's control went back to "Send" when the form left (`composer.tsx › NO_LAUNCH`).
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
