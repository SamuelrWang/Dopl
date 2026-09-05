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
 *
 * ⚠ THE BOT ICON AND THE TEMPLATE CHEVRON ARE `composer-launch.test.tsx` SINCE
 * 2026-08-26 — the §1 split at the 500-line cap, which the panel's own
 * description field pushed this file over. **The seam is the subject, not the
 * line count**: this file is about what the composer WRITES (a chat message or
 * a request fan-out); that one is about the BRIDGE SPAWN beside it, which posts
 * nothing and reaches a different layer entirely.
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

/**
 * ⚠ MOCKED BECAUSE THE MODULE IS IN THE GRAPH, not because this file asserts on
 * it. `composer.tsx` imports the template picker unconditionally (it renders
 * only with launch controls, which no test here hands down), and an unmocked
 * `useAgentTemplates` would put a real react-query read behind every send case.
 * The picker's own behaviour is `composer-launch.test.tsx`'s.
 */
vi.mock("@/features/agent-templates/hooks/use-agent-templates", () => ({
  useAgentTemplates: () => ({
    templates: [],
    loading: false,
    error: null,
    refetch: () => {},
  }),
}));

import { ChannelsV2Composer } from "./composer";
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
    // ⚠ CAPTURED AT MOUNT, WHICH IS PANEL-CLOSED. The chat textarea is
    // UNMOUNTED while the request panel is open (Samuel, 2026-08-26 — one edit
    // surface), so this reference goes stale on `openPanel`; the request tests
    // below reach for `title()` / `description()` instead, which is the point.
    body: screen.getByLabelText("Message") as HTMLTextAreaElement,
    /** The chat textarea if it is on screen at all, else `null`. */
    bodyOrNull: () => screen.queryByLabelText("Message") as HTMLTextAreaElement | null,
    title: () => screen.getByLabelText("Thread title") as HTMLInputElement,
    description: () =>
      screen.getByLabelText("Thread description") as HTMLTextAreaElement,
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

function type(field: HTMLTextAreaElement | HTMLInputElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

/** Title + description, the two halves a request cannot be raised without. */
function fillRequest(
  c: ReturnType<typeof mount>,
  title = "Sweep the docs",
  description = "start here"
) {
  type(c.title(), title);
  type(c.description(), description);
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
  /**
   * The panel's open state.
   *
   * ⚠ THIS READ THE MESSAGE TEXTAREA'S PLACEHOLDER UNTIL 2026-08-26 — the panel
   * used to swap it to "Describe the request", because the request's body WAS
   * the chat draft. That surface is gone (the description is now a field inside
   * the panel), so the tell is the toggle's own `aria-pressed`, which is what a
   * screen reader reads too and what the sibling describe block already uses.
   */
  const panelOpen = () =>
    screen.getByRole("button", { name: "New thread" }).getAttribute("aria-pressed");

  /** ⚠ THE SIGNAL IS A COUNTER, so this asserts the SECOND ask lands too — a
   *  boolean prop would open once and then sit `true`, leaving the Threads
   *  tab's button dead for the rest of the session. */
  it("opens on a signal change, and again on the next one", () => {
    const view = render(<ChannelsV2Composer {...props(0)} />);
    expect(panelOpen()).toBe("false");

    view.rerender(<ChannelsV2Composer {...props(1)} />);
    expect(panelOpen()).toBe("true");

    // Dismiss it, then ask again — the second increment must reopen.
    fireEvent.click(screen.getByRole("button", { name: "Close new thread" }));
    expect(panelOpen()).toBe("false");
    view.rerender(<ChannelsV2Composer {...props(2)} />);
    expect(panelOpen()).toBe("true");
  });
});

/**
 * ONE EDIT SURFACE AT A TIME (Samuel, 2026-08-26: *"the user will solely need to
 * edit the new thread panel"*).
 *
 * ⚠ THE PROPERTY IS AN ABSENCE, which is exactly the kind that comes back
 * silently. The request's body used to be the chat textarea under the panel —
 * one box that changed meaning while the panel was open — and re-rendering it
 * beside the Description field would restore that ambiguity without failing
 * anything else in this file.
 */
describe("the composer's two edit surfaces", () => {
  it("takes the chat textarea off screen while the panel is open", () => {
    const c = mount();
    expect(c.bodyOrNull()).not.toBeNull();

    c.openPanel();
    expect(c.bodyOrNull()).toBeNull();
    // ⚠ Not merely "a title field exists": the panel is always MOUNTED inside
    // the collapsing grid, so both of its fields are queryable either way. What
    // this pins is that the request's own description is the box on offer.
    expect(c.description()).toBeTruthy();
  });

  it("gives the half-typed chat message back when the panel shuts", () => {
    // ⚠ UNMOUNTED, NOT DISCARDED. `draft` is state in the composer rather than
    // in the element, and a reader who opens the panel by mistake must not lose
    // the message they were writing.
    const c = mount();
    type(c.body, "morning, all");

    c.openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Close new thread" }));
    expect(c.bodyOrNull()?.value).toBe("morning, all");
  });
});

describe("the agent panel sends a REQUEST FAN-OUT", () => {
  it("addresses every remaining pill, in ONE send with ONE base key", () => {
    const c = mount();
    c.openPanel();
    fillRequest(c);
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

  /**
   * ⚠ THE BODY IS THE PANEL'S DESCRIPTION, NOT THE CHAT DRAFT (2026-08-26). The
   * wire field is still `body` — what moved is which BOX the operator types it
   * in — so this is the case that would pass on the OLD wiring too if the
   * description merely happened to be empty. Typing a chat draft FIRST is what
   * makes it discriminating: the old composer would have sent that string.
   */
  it("takes the body from the panel's description, never the chat draft", () => {
    const c = mount();
    type(c.body, "a chat message I was part-way through");
    c.openPanel();
    fillRequest(c, "Sweep the docs", "read every §5 bullet");
    fireEvent.click(c.sendButton());

    expect(fanOutThreads.mock.calls[0][0].body).toBe("read every §5 bullet");
  });

  it("drops a removed pill from the request rather than sending to them", () => {
    const c = mount();
    c.openPanel();
    fireEvent.click(
      screen.getByRole("button", { name: /^Remove .*Ada/ })
    );
    fillRequest(c);
    fireEvent.click(c.sendButton());

    expect(fanOutThreads.mock.calls[0][0].toUserIds).toEqual([PEER]);
  });

  it("clears BOTH panel fields after a send", () => {
    const c = mount();
    c.openPanel();
    fillRequest(c);
    fireEvent.click(c.sendButton());

    // The panel shuts, and its fields are empty behind it — a second request
    // must not start pre-loaded with the first one's words.
    expect(c.title().value).toBe("");
    expect(c.description().value).toBe("");
  });

  it("is NOT SENDABLE with no addressee, and says why", () => {
    const c = mount();
    c.openPanel();
    for (const name of [/^Remove .*Diana/, /^Remove .*Ada/]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    fillRequest(c);

    // ⚠ The UI refusal is a COURTESY. `schema.ts › TaskFanOutSchema` refuses an
    // empty `toUserIds` with a 400, which is the rule; this is the affordance.
    expect(c.sendButton().disabled).toBe(true);
    expect(c.sendButton().title).toBe(
      "A request needs a title, a description and at least one agent"
    );
    expect(screen.getByText(/reaches nobody/)).toBeTruthy();
    fireEvent.click(c.sendButton());
    expect(fanOutThreads).not.toHaveBeenCalled();
  });

  it("is NOT SENDABLE with no title", () => {
    const c = mount();
    c.openPanel();
    type(c.description(), "start here");
    expect(c.sendButton().disabled).toBe(true);
    fireEvent.click(c.sendButton());
    expect(fanOutThreads).not.toHaveBeenCalled();
  });

  /** ⚠ THE THIRD REQUIREMENT, and the newest. A title with no description is
   *  a thread nobody can act on, and before 2026-08-26 the description could
   *  not be empty because it was the chat draft the Send gate already checked —
   *  moving it into the panel is exactly what put this case at risk. */
  it("is NOT SENDABLE with no description", () => {
    const c = mount();
    c.openPanel();
    type(c.title(), "Sweep the docs");
    expect(c.sendButton().disabled).toBe(true);
    fireEvent.click(c.sendButton());
    expect(fanOutThreads).not.toHaveBeenCalled();

    // Whitespace is not a description either.
    type(c.description(), "   ");
    expect(c.sendButton().disabled).toBe(true);
  });
});

/**
 * THE FOOTER (Samuel, 2026-08-27) — one submit control, and a Discard that is only there when
 * there is something to discard.
 */
describe("the composer's footer", () => {
  it("hides DISCARD on an empty composer and shows it once there is text", () => {
    // ⚠ IT RENDERED ALWAYS, which put a control that does nothing beside the send button —
    // the inert chrome §5's interaction-completeness ruling forbids.
    const c = mount();
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();

    type(c.body, "morning");
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();

    // Whitespace is not content.
    type(c.body, "   ");
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
  });

  it("is ONE submit, and a PANEL's submit wears a VISIBLE word", () => {
    // ⚠ THE LABEL IS RENDERED TEXT, NOT A `title` ON AN ARROW (Samuel, 2026-08-27, from the
    // rendered app). Shipping it as a tooltip made all three acts look identical on screen, and
    // the earlier pin passed because an `aria-label` satisfies `getByRole({ name })` just as text
    // content does. **Asserting `textContent` is what makes this case see the difference.**
    const c = mount();
    // A plain message sends from the kit's ARROW — an icon button, no word on it.
    expect(screen.getByRole("button", { name: "Send" }).textContent).toBe("");

    c.openPanel();
    const create = screen.getByRole("button", { name: "Create" });
    expect(create.textContent).toBe("Create");
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("hangs SEND at the right end of the ICON ROW, not above it", () => {
    // ⚠ THE ARROW MOVED TO THE BOTTOM-RIGHT (Samuel, live review 2026-08-28). It used to sit
    // inside the input row beside the field, which put the card's one submit at the TOP-right
    // while every other control sat along the bottom. It is now the last thing in the toolbar
    // row, level with the icons.
    // ⚠ SAME PARENT **AND** AFTER — either alone is satisfied by a mutation the other catches:
    // an arrow re-parented back into the input row still follows the icons in document order,
    // and an arrow moved to the row's LEFT end is still in the row.
    // ⚠ ANCHORED ON EMOJI SINCE 2026-09-04. It was "Attach file", which Samuel's toolbar ruling
    // DELETED along with Shortcuts — this case is about the ARROW'S POSITION relative to the icon
    // run, so it needs any surviving icon and not that one in particular.
    const c = mount();
    const send = screen.getByRole("button", { name: "Send" });
    const icon = screen.getByRole("button", { name: "Emoji" });
    expect(send.parentElement).toBe(icon.parentElement);
    expect(
      icon.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // And it is OUT of the field's own row — the input row is the field and nothing else here.
    expect(c.body.parentElement?.contains(send)).toBe(false);
  });

  it("has NO expand control", () => {
    // ⚠ DELETED, NOT HIDDEN (Samuel, live review 2026-08-28). The 4-arrow glyph carried no
    // `onClick` in any shipped build, so nothing became unreachable — there is no expanded
    // editor behind it to restore. ⚠ THE MUTATION THIS CATCHES is somebody "finishing" the
    // toolbar by putting the icon back on the way to wiring it.
    mount();
    expect(screen.queryByRole("button", { name: "Expand composer" })).toBeNull();
    expect(screen.queryByRole("button", { name: /expand/i })).toBeNull();
  });
});

// ⚠ THE SHARED FIELD KIT'S PINS ARE `panel-field.test.tsx` (2026-08-27) — it is `PanelField`,
// which BOTH panels mount, and half its cases were landing here and half in the launch suite.
// ⚠ ONE PROPERTY STAYS HERE because it is the PANEL's and not the kit's: the description starts
// at one line (`rows={1}`) rather than the three-line box that made the panel tall before a word
// was typed. The growth itself is `use-auto-grow.ts`, a style mutation jsdom cannot measure.
describe("the thread panel's description", () => {
  it("starts at ONE line — it grows as it is typed", () => {
    const c = mount();
    c.openPanel();
    expect(c.description().rows).toBe(1);
  });
});

/**
 * THE @ GLYPH OPENS THE PICKER (Samuel, 2026-08-27).
 *
 * ⚠ IT WAS INERT — a glyph sitting in a row of working controls, which §5's
 * interaction-completeness ruling forbids outright. There is no second "open the popover" path to
 * keep in step: the popover is a pure function of the DRAFT, so the honest wiring is to write the
 * token the operator would have typed.
 */
describe("the composer's @ button", () => {
  const atButton = () => screen.getByRole("button", { name: "Mention" });
  const picker = () => screen.queryByRole("listbox", { name: "Mention a member" });

  it("opens the same picker typing `@` opens", () => {
    const c = mount();
    expect(picker()).toBeNull();
    fireEvent.click(atButton());
    expect(picker()).not.toBeNull();
    expect(c.bodyOrNull()?.value).toBe("@");
  });

  it("puts a SPACE before the `@` when the draft does not end in one", () => {
    // ⚠ WITHOUT IT the `@` welds onto the previous word and `mentionQuery` — which requires a
    // boundary — answers null, so the button would write a character and open nothing.
    const c = mount();
    type(c.body, "morning");
    fireEvent.click(atButton());
    expect(c.bodyOrNull()?.value).toBe("morning @");
    expect(picker()).not.toBeNull();
  });

  it("does not double the space when the draft already ends in one", () => {
    const c = mount();
    type(c.body, "morning ");
    fireEvent.click(atButton());
    expect(c.bodyOrNull()?.value).toBe("morning @");
  });
});
