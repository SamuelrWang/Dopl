// @vitest-environment jsdom
/**
 * THE COMPOSER'S SEND, which is what Phase 3 turned on.
 *
 * The properties pinned here are the ones a redesign loses quietly:
 *
 *  - **The plain composer is human chat**, and `intent: "chat"` rides the wire
 *    explicitly — absence reads as `request` server-side.
 *  - **ONE SUBMIT, ONE ACT, AND IT IS THE ARROW** (2026-09-08). The card carried a second,
 *    LABELED submit while a form stood on it; both forms are dialogs now, so a labeled button on
 *    this card is a form that came back.
 *  - **THREAD CREATION IS A POPUP AND BOTH OPENERS REACH IT** — the Threads tab's nonce and the
 *    toolbar's `MessageSquarePlus` glyph (Samuel, 2026-09-08: *"look there is an icon in the text
 *    input bar that is supposed to spawn new threads. Why wasn't that wired in"*).
 *  - **THE INLINE REQUEST PANEL IS GONE**, and its absence is asserted rather than assumed —
 *    the `AgentRequestPanel` component, its `useThreadRequest` hook and the composer's
 *    three-act submit derivation were DELETED, not disarmed.
 *
 * ⚠ THE FAN-OUT'S OWN PINS MOVED TO `new-thread-dialog.test.tsx` ON 2026-09-08 — the payload
 * shape, the one base key, pills → `toUserIds`, and the refusals. They were written here against
 * the inline panel, which was the only surface that could raise a request through THIS card's
 * Send; the write is unchanged and its caller moved, so the cases moved with the caller.
 *
 * ⚠ `useThreadWrites` is MOCKED. What this file is about is which DRAFT the
 * composer builds; the write layer's own behaviour (optimistic rows, reconcile,
 * rollback) is pinned against TanStack's `MutationObserver` in
 * `hooks/use-thread-writes.test.ts`, which is where it belongs.
 *
 * ⚠ THE BOT ICON AND THE TEMPLATE CHEVRON ARE `composer-launch.test.tsx` SINCE
 * 2026-08-26 — the §1 split at the 500-line cap. **The seam is the subject, not
 * the line count**: this file is about what the composer WRITES; that one is
 * about the BRIDGE SPAWN beside it, which posts nothing and reaches a different
 * layer entirely.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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
    body: screen.getByLabelText("Message") as HTMLTextAreaElement,
    /** ⚠ THE CHAT TEXTAREA NEVER GOES ANYWHERE NOW — the popup draws its own scrim. This stayed a
     *  lazy query because its ABSENCE is what the popup cases assert against. */
    bodyOrNull: () => screen.queryByLabelText("Message") as HTMLTextAreaElement | null,
    /** The toolbar's `MessageSquarePlus` — icon-only, and the composer's own thread opener. */
    glyph: () => screen.getByRole("button", { name: "New thread" }) as HTMLButtonElement,
    sendButton: () => screen.getByRole("button", { name: "Send" }) as HTMLButtonElement,
  };
}

function type(field: HTMLTextAreaElement | HTMLInputElement, value: string) {
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

/**
 * TWO OPENERS, ONE FORM (Samuel, 2026-09-08).
 *
 * ⚠ THE GLYPH WAS THE HALF THAT WAS MISSING. The Threads tab's button was pointed at the popup on
 * the morning of 2026-09-08 and the toolbar's `MessageSquarePlus` was left on the inline panel,
 * which is the state Samuel found: *"look there is an icon in the text input bar that is supposed
 * to spawn new threads. Why wasn't that wired in"*.
 * ⚠ THE TWO NONCES ARE **ADDED**, not chosen between, and that is what the third case is for: a
 * composer that read one source would leave the other's button dead for the rest of the session.
 */
describe("thread creation is a POPUP, and BOTH openers reach it", () => {
  const props = (newThreadSignal: number) => ({
    channelId: CHANNEL_ID,
    workspaceId: "ws-1",
    members: MEMBERS,
    currentUserId: ME,
    gate: { begin: vi.fn(), end: vi.fn() },
    newThreadSignal,
  });
  const popup = () => screen.queryByRole("dialog", { name: "New thread" });
  /** ⚠ SCOPED TO THE DIALOG. The composer's own toolbar grows a "Discard" the moment the chat
   *  draft has a character in it, and a bare `getByRole` would find two — see the last case. */
  const discard = () =>
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "New thread" })).getByRole("button", {
        name: "Discard",
      })
    );

  it("opens on ANOTHER SURFACE'S signal, and again on the next one", async () => {
    // ⚠ THE SIGNAL IS A COUNTER, so this asserts the SECOND ask lands too — a boolean prop would
    // open once and then sit `true`, leaving the Threads tab's button dead.
    const view = render(<ChannelsV2Composer {...props(0)} />);
    expect(popup()).toBeNull();

    view.rerender(<ChannelsV2Composer {...props(1)} />);
    await waitFor(() => expect(popup()).toBeTruthy());

    discard();
    await waitFor(() => expect(popup()).toBeNull());
    view.rerender(<ChannelsV2Composer {...props(2)} />);
    await waitFor(() => expect(popup()).toBeTruthy());
  });

  it("opens on the TOOLBAR GLYPH, and again after a Discard", async () => {
    // 🔒 MUTATION-PROOF: point `composer.tsx`'s `onNewThread` at a no-op, or stop adding
    // `threadDialogNonce` into the dialog's `signal`, and this goes red — which is exactly the
    // build Samuel was looking at.
    const c = mount();
    expect(popup()).toBeNull();

    fireEvent.click(c.glyph());
    await waitFor(() => expect(popup()).toBeTruthy());

    discard();
    await waitFor(() => expect(popup()).toBeNull());
    fireEvent.click(c.glyph());
    await waitFor(() => expect(popup()).toBeTruthy());
  });

  it("lets the two sources interleave — neither masks the other", async () => {
    // ⚠ THE MUTATION THIS CATCHES is a composer that picks ONE source (`signal={newThreadSignal}`
    // or `signal={threadDialogNonce}`) instead of summing them. Either single-source build passes
    // one of the two cases above and fails here.
    const view = render(<ChannelsV2Composer {...props(0)} />);
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    await waitFor(() => expect(popup()).toBeTruthy());
    discard();
    await waitFor(() => expect(popup()).toBeNull());

    view.rerender(<ChannelsV2Composer {...props(1)} />);
    await waitFor(() => expect(popup()).toBeTruthy());
    discard();
    await waitFor(() => expect(popup()).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    await waitFor(() => expect(popup()).toBeTruthy());
  });

  it("has NO INLINE thread form left on the card", () => {
    // ⚠ DELETED, NOT HIDDEN (the channels-v2 purge ruling). The panel used to be MOUNTED at all
    // times inside a `grid-rows-[0fr]` collapse, so its fields were queryable even while shut —
    // which is why this asserts the fields and the panel's own × by name rather than looking for
    // something visible. ⚠ AND THE GLYPH CARRIES NO `aria-pressed`: it opens a modal it cannot
    // close, so a pressed state would be a claim nothing keeps true.
    const c = mount();
    expect(screen.queryByLabelText("Thread title")).toBeNull();
    expect(screen.queryByLabelText("Thread description")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close new thread" })).toBeNull();
    expect(c.glyph().getAttribute("aria-pressed")).toBeNull();
    // No second submit on the card either — see the footer block below.
    expect(screen.queryByRole("button", { name: "Create" })).toBeNull();
  });

  it("leaves the chat draft alone behind the popup", async () => {
    // ⚠ THE PROPERTY THE DELETED "one edit surface" CASES PROTECTED, kept. The panel UNMOUNTED
    // this textarea and the draft survived in composer state; the popup does not have to unmount
    // anything, so what is pinned now is that it does not — the field and the words are both
    // still there under the scrim.
    const c = mount();
    type(c.body, "morning, all");
    fireEvent.click(c.glyph());
    await waitFor(() => expect(popup()).toBeTruthy());

    expect(c.bodyOrNull()?.value).toBe("morning, all");
    discard();
    await waitFor(() => expect(popup()).toBeNull());
    expect(c.bodyOrNull()?.value).toBe("morning, all");
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

  it("is ONE submit, and it is the ARROW — no labeled button on the card", () => {
    // ⚠ THE CARD CARRIED A SECOND FACE UNTIL 2026-09-08: a labeled button wearing the open
    // panel's verb ("Create" / "Launch"), rendered on `panelOpen`. Both forms are dialogs with
    // their own footer now, so the branch and the button are DELETED. **The mutation this catches
    // is a labeled submit coming back onto the card**, which is a form coming back with it.
    // ⚠ `textContent` IS THE ASSERTION, not the accessible name: an `aria-label` satisfies
    // `getByRole({ name })` exactly as text content does, which is how the 2026-08-27 version of
    // this case passed over an arrow wearing its verb as a tooltip.
    mount();
    const arrow = screen.getByRole("button", { name: "Send" });
    expect(arrow.textContent).toBe("");
    expect(screen.getAllByRole("button", { name: "Send" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Launch" })).toBeNull();
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
