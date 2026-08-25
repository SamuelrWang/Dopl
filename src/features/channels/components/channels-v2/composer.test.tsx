// @vitest-environment jsdom
/**
 * THE COMPOSER'S SEND, which is what Phase 3 turned on.
 *
 * The properties pinned here are the ones a redesign loses quietly:
 *
 *  - **N pills = N addressees.** One send carries every remaining pill, and
 *    dropping a pill drops that person from the request. "Broadcast" is not a
 *    shape this product has (INVARIANTS §5).
 *  - **Zero pills is NOT SENDABLE**, and the button says why rather than
 *    swallowing the click. ⚠ This is the courtesy half only — the CONTRACT is
 *    `schema.ts › TaskFanOutSchema`, where an empty addressee list is a 400.
 *  - **One BASE idempotency key per Send**, minted here (INVARIANTS §8). The
 *    server derives the per-addressee keys and the group id from it.
 *  - **The plain composer is human chat**, and `intent: "chat"` rides the wire
 *    explicitly — absence reads as `request` server-side.
 *
 * ⚠ `useThreadWrites` is MOCKED. What this file is about is which DRAFT the
 * composer builds; the write layer's own behaviour (optimistic rows, reconcile,
 * rollback) is pinned against TanStack's `MutationObserver` in
 * `hooks/use-thread-writes.test.ts`, which is where it belongs.
 */

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

/**
 * ⚠ THE TEMPLATE PICKER'S READ IS MOCKED, and the composer has mounted the
 * picker since 2026-08-22. What this file pins is that the BOT ICON did not
 * change — the picker is a second glyph beside it, exactly as "New thread" is
 * (`agent-templates/components/template-picker.test.tsx` owns the popover).
 */
const templateList = vi.hoisted(() => ({ templates: [] as unknown[] }));
vi.mock("@/features/agent-templates/hooks/use-agent-templates", () => ({
  useAgentTemplates: () => ({
    templates: templateList.templates,
    loading: false,
    error: null,
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

beforeEach(() => {
  send.mockClear();
  fanOutThreads.mockClear();
});
afterEach(cleanup);

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
  return {
    body: screen.getByLabelText("Message") as HTMLTextAreaElement,
    openPanel: () =>
      // ⚠ THE PANEL MOVED OFF THE BOT ICON ON 2026-08-21 (Samuel). `Bot` is New
      // Agent now — a bridge spawn that posts nothing — and this panel, which
      // raises a REQUEST at another member over the write layer, opens from its
      // own "New thread" control. Two acts, two glyphs.
      fireEvent.click(screen.getByRole("button", { name: "New thread" })),
    // ⚠ ONE BUTTON, TWO LABELS: "Send" with the panel closed, "Create" with it
    // open (Samuel, 2026-08-24) — the second act raises a thread, it does not
    // send a message. Matching both is what keeps this helper honest about
    // there being ONE submit control.
    sendButton: () =>
      screen.getByRole("button", {
        name: /^(Send|Create)$/,
      }) as HTMLButtonElement,
  };
}

function type(field: HTMLTextAreaElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

describe("the plain composer sends CHAT", () => {
  it("posts the body with an explicit chat intent and a minted key", () => {
    const c = mount();
    type(c.body, "morning");
    fireEvent.click(c.sendButton());

    expect(send).toHaveBeenCalledTimes(1);
    const draft = send.mock.calls[0][0];
    expect(draft.body).toBe("morning");
    // ⚠ Absence reads as `request` on the wire. This literal is the difference
    // between a remark and something that can start somebody's agent.
    expect(draft.intent).toBe("chat");
    expect(draft.channelId).toBe(CHANNEL_ID);
    expect(typeof draft.clientMsgId).toBe("string");
    expect(fanOutThreads).not.toHaveBeenCalled();
  });

  it("refuses an empty draft and says so", () => {
    const c = mount();
    type(c.body, "   ");
    expect(c.sendButton().disabled).toBe(true);
    expect(c.sendButton().title).toBe("Write a message first");
    fireEvent.click(c.sendButton());
    expect(send).not.toHaveBeenCalled();
  });

  it("sends on Enter and breaks the line on Shift+Enter", () => {
    const c = mount();
    type(c.body, "morning");
    fireEvent.keyDown(c.body, { key: "Enter", shiftKey: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(c.body, { key: "Enter" });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("another surface can open the new-thread panel", () => {
  const props = (newThreadSignal: number) => ({
    channelId: CHANNEL_ID,
    workspaceId: "ws-1",
    members: MEMBERS,
    currentUserId: ME,
    gate: { begin: vi.fn(), end: vi.fn() },
    newThreadSignal,
  });
  /** The panel's open state, read off the one thing that changes with it. */
  const placeholder = () =>
    (screen.getByLabelText("Message") as HTMLTextAreaElement).placeholder;

  /** ⚠ THE SIGNAL IS A COUNTER, so this asserts the SECOND ask lands too — a
   *  boolean prop would open once and then sit `true`, leaving the Threads
   *  tab's button dead for the rest of the session. */
  it("opens on a signal change, and again on the next one", () => {
    const view = render(<ChannelsV2Composer {...props(0)} />);
    expect(placeholder()).toBe("Write a message");

    view.rerender(<ChannelsV2Composer {...props(1)} />);
    expect(placeholder()).toBe("Describe the request");

    // Dismiss it, then ask again — the second increment must reopen.
    fireEvent.click(screen.getByRole("button", { name: "Close new thread" }));
    expect(placeholder()).toBe("Write a message");
    view.rerender(<ChannelsV2Composer {...props(2)} />);
    expect(placeholder()).toBe("Describe the request");
  });
});

describe("the agent panel sends a REQUEST FAN-OUT", () => {
  it("addresses every remaining pill, in ONE send with ONE base key", () => {
    const c = mount();
    c.openPanel();
    fireEvent.change(screen.getByLabelText("Thread title"), {
      target: { value: "Sweep the docs" },
    });
    type(c.body, "start here");
    fireEvent.click(c.sendButton());

    expect(fanOutThreads).toHaveBeenCalledTimes(1);
    const draft = fanOutThreads.mock.calls[0][0];
    // Every OTHER member — you do not address your own agent.
    expect(draft.toUserIds).toEqual([PEER, THIRD]);
    expect(draft.title).toBe("Sweep the docs");
    expect(draft.body).toBe("start here");
    // ⚠ ONE base key for the whole send. The per-addressee keys are derived
    // server-side; minting per pill here would move that rule to the client.
    expect(typeof draft.clientMsgId).toBe("string");
    expect(send).not.toHaveBeenCalled();
  });

  it("drops a removed pill from the request rather than sending to them", () => {
    const c = mount();
    c.openPanel();
    fireEvent.click(
      screen.getByRole("button", { name: /^Remove .*Ada/ })
    );
    fireEvent.change(screen.getByLabelText("Thread title"), {
      target: { value: "Sweep the docs" },
    });
    type(c.body, "start here");
    fireEvent.click(c.sendButton());

    expect(fanOutThreads.mock.calls[0][0].toUserIds).toEqual([PEER]);
  });

  it("is NOT SENDABLE with no addressee, and says why", () => {
    const c = mount();
    c.openPanel();
    for (const name of [/^Remove .*Diana/, /^Remove .*Ada/]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    fireEvent.change(screen.getByLabelText("Thread title"), {
      target: { value: "Sweep the docs" },
    });
    type(c.body, "start here");

    // ⚠ The UI refusal is a COURTESY. `schema.ts › TaskFanOutSchema` refuses an
    // empty `toUserIds` with a 400, which is the rule; this is the affordance.
    expect(c.sendButton().disabled).toBe(true);
    expect(c.sendButton().title).toBe(
      "A request needs a title and at least one agent"
    );
    expect(screen.getByText(/reaches nobody/)).toBeTruthy();
    fireEvent.click(c.sendButton());
    expect(fanOutThreads).not.toHaveBeenCalled();
  });

  it("is NOT SENDABLE with no title", () => {
    const c = mount();
    c.openPanel();
    type(c.body, "start here");
    expect(c.sendButton().disabled).toBe(true);
    fireEvent.click(c.sendButton());
    expect(fanOutThreads).not.toHaveBeenCalled();
  });
});

/**
 * THE BOT ICON AND THE THREAD PANEL ARE TWO CONTROLS (Samuel, 2026-08-21).
 *
 * ⚠ THE SPLIT IS NOT COSMETIC AND THAT IS WHY IT IS PINNED. One glyph used to
 * mean both acts, and they do not even reach the same layer: the panel raises a
 * REQUEST at another member over the write layer; the Bot icon spawns MY OWN
 * agent on THIS machine over the bridge and posts nothing. A regression that
 * quietly re-merges them would make one of the two silently unreachable.
 *
 * ⚠ AND THE BOT ICON IS NOT RENDERED WHERE IT CANNOT WORK. `canLaunch` is the
 * bridge op's own detection — the web tree and the pop-out thread window get no
 * affordance rather than one that can only refuse (INVARIANTS §11).
 */
describe("the composer's two agent controls", () => {
  function launcher(over: Partial<AgentLaunchControls> = {}): AgentLaunchControls {
    return {
      canLaunch: true,
      launchBusy: false,
      launchError: null,
      launchAgent: vi.fn().mockResolvedValue({ ok: true }),
      approveTemplate: vi.fn().mockResolvedValue({ ok: true }),
      ...over,
    };
  }

  /** Whether the request panel is OPEN. ⚠ Not "is the title field in the DOM" —
   *  the panel is always mounted inside the collapsing grid and merely `inert`
   *  when shut, so its fields are queryable either way. The toggle's own
   *  `aria-pressed` is the state, and it is what a screen reader reads too. */
  const panelOpen = () =>
    screen.getByRole("button", { name: "New thread" }).getAttribute("aria-pressed");

  it("opens the thread panel from NEW THREAD, and not from the Bot icon", () => {
    mount({ newAgent: launcher() });
    expect(panelOpen()).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "New Agent" }));
    // The Bot icon launches; it must not have opened the request panel.
    expect(panelOpen()).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    expect(panelOpen()).toBe("true");
    expect(screen.getByLabelText("Thread title")).toBeTruthy();
  });

  it("posts NOTHING when the Bot icon is clicked", () => {
    mount({ newAgent: launcher() });
    fireEvent.click(screen.getByRole("button", { name: "New Agent" }));
    expect(send).not.toHaveBeenCalled();
    expect(fanOutThreads).not.toHaveBeenCalled();
  });

  it("launches onto the OPEN THREAD in thread view", () => {
    const controls = launcher();
    mount({ newAgent: controls, openThreadId: "t-1" });
    fireEvent.click(screen.getByRole("button", { name: "New Agent" }));
    expect(controls.launchAgent).toHaveBeenCalledWith("t-1");
  });

  it("launches a CHANNEL-LEVEL agent in channel view — null, not empty string", () => {
    // ⚠ `""` is already a real wire value ("a responder whose thread never
    // became first-class"), so the two must not collapse into one.
    const controls = launcher();
    mount({ newAgent: controls });
    fireEvent.click(screen.getByRole("button", { name: "New Agent" }));
    expect(controls.launchAgent).toHaveBeenCalledWith(null);
  });

  it("renders NO Bot icon when the bridge cannot launch", () => {
    mount({ newAgent: launcher({ canLaunch: false }) });
    expect(screen.queryByRole("button", { name: "New Agent" })).toBeNull();
    // ⚠ And the thread panel is untouched by that absence — it is a write, not
    // a bridge op, and it works in a plain browser.
    expect(screen.getByRole("button", { name: "New thread" })).toBeTruthy();
  });

  it("renders no Bot icon at all with no launch controls handed down", () => {
    mount();
    expect(screen.queryByRole("button", { name: "New Agent" })).toBeNull();
  });

  it("disables the Bot icon ONLY while a launch is in flight", () => {
    mount({ newAgent: launcher({ launchBusy: true }) });
    expect(
      (screen.getByRole("button", { name: "New Agent" }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("stays enabled once a launch has settled — every click is a NEW agent", () => {
    mount({ newAgent: launcher() });
    expect(
      (screen.getByRole("button", { name: "New Agent" }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it("says a refusal out loud rather than swallowing it", () => {
    // ⚠ Main answering `{ok:false}` changes nothing on its side, so no push
    // follows to explain a button that visibly did nothing.
    mount({ newAgent: launcher({ launchError: "Session limit reached" }) });
    expect(screen.getByRole("alert").textContent).toBe("Session limit reached");
  });

  it("shows no alert when there is nothing to report", () => {
    mount({ newAgent: launcher() });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

/**
 * THE CHEVRON BESIDE THE BOT ICON (2026-08-22, the agent-templates launch wave).
 *
 * ⚠ THE PINNED PROPERTY IS THE ONE-CLICK BLANK LAUNCH — Samuel's standing
 * channels-v2 ruling (*one lane, one-click launch*), which the templates spec
 * proposed trading for a popover plus Enter and which he refused. The Bot icon
 * still spawns a blank agent on the FIRST click, with a payload carrying no
 * template; the picker is an adjacent zone with its own accessible name.
 *
 * ⚠ THREE GLYPHS NOW, THREE ACTS. `Bot` = launch blank (bridge, posts nothing),
 * the chevron = choose an identity, `MessageSquarePlus` = raise a REQUEST at
 * another member (a write). Re-merging any two of them makes one unreachable —
 * which is exactly what happened to the thread panel in 2026-08-21.
 */
describe("the composer's template chevron", () => {
  function launcher(over: Partial<AgentLaunchControls> = {}): AgentLaunchControls {
    return {
      canLaunch: true,
      launchBusy: false,
      launchError: null,
      launchAgent: vi.fn().mockResolvedValue({ ok: true }),
      approveTemplate: vi.fn().mockResolvedValue({ ok: true }),
      ...over,
    };
  }

  it("keeps the Bot icon a ONE-CLICK BLANK launch, opening nothing", () => {
    const controls = launcher();
    mount({ newAgent: controls, openThreadId: "t-1" });

    fireEvent.click(screen.getByRole("button", { name: "New Agent" }));
    expect(controls.launchAgent).toHaveBeenCalledWith("t-1");
    // ⚠ EXACTLY ONE ARGUMENT — a spelled-out `null` template would be a
    // different object on the wire from the one this icon has always sent.
    expect(vi.mocked(controls.launchAgent).mock.calls[0].length).toBe(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the picker from the chevron, which launches nothing itself", () => {
    const controls = launcher();
    mount({ newAgent: controls });

    const chevron = screen.getByRole("button", { name: "Launch from template" });
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(chevron);

    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Blank agent/ })).toBeTruthy();
    expect(controls.launchAgent).not.toHaveBeenCalled();
  });

  it("does NOT open the thread panel — three glyphs, three acts", () => {
    mount({ newAgent: launcher() });
    fireEvent.click(screen.getByRole("button", { name: "Launch from template" }));
    expect(
      screen.getByRole("button", { name: "New thread" }).getAttribute("aria-pressed")
    ).toBe("false");
  });

  it("renders no chevron where the bridge cannot launch", () => {
    mount({ newAgent: launcher({ canLaunch: false }) });
    expect(screen.queryByRole("button", { name: "Launch from template" })).toBeNull();
  });

  it("disables the chevron only while a launch is in flight", () => {
    mount({ newAgent: launcher({ launchBusy: true }) });
    expect(
      (screen.getByRole("button", { name: "Launch from template" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it("carries the picked template into the SAME launch op the Bot icon uses", async () => {
    templateList.templates = [
      {
        id: "tpl-9",
        workspaceId: "ws-1",
        name: "Code auditor",
        description: null,
        instructions: null,
        model: null,
        fields: [],
        visibility: "private",
        teamIds: [],
        knowledgeBases: [],
        createdBy: ME,
        createdAt: "2026-08-01T00:00:00Z",
        updatedAt: "2026-08-01T00:00:00Z",
      },
    ];
    const controls = launcher();
    mount({ newAgent: controls, openThreadId: "t-1" });

    fireEvent.click(screen.getByRole("button", { name: "Launch from template" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Launch Code auditor/ }));
    await waitFor(() =>
      expect(controls.launchAgent).toHaveBeenCalledWith("t-1", "tpl-9", undefined)
    );
    templateList.templates = [];
  });
});
