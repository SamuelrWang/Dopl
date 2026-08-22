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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const send = vi.fn();
const fanOutThreads = vi.fn();

vi.mock("../../hooks/use-thread-writes", () => ({
  useThreadWrites: () => ({
    send: { mutate: send },
    fanOutThreads: { mutate: fanOutThreads },
    pending: false,
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
    sendButton: () =>
      screen.getByRole("button", { name: /^Send/ }) as HTMLButtonElement,
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
      launchAgent: vi.fn().mockResolvedValue(undefined),
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
