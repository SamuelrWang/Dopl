// @vitest-environment jsdom
/**
 * THE NEW-THREAD POPUP (2026-09-08, Samuel: *"i want to make a pop up for the threads creation as
 * well"*) — the SECOND surface on `shared/ui/form-dialog.tsx`, and the first one that had to
 * replace a form that already worked.
 *
 * What is pinned here is what a redesign of a WORKING form loses quietly:
 *
 *  - **THE WIRE DID NOT MOVE.** ⚠ **THIS WAS A PARITY ASSERTION AGAINST THE INLINE PANEL UNTIL
 *    2026-09-08**, driving BOTH forms through the SAME composer with the SAME keystrokes. The
 *    panel is DELETED (Samuel wired its glyph to this popup instead), and a parity case with one
 *    side missing is a snapshot of the survivor — so the shape it compared is now written out as
 *    LITERALS: trimmed title, the form's description as `body`, one `toUserIds` entry per pill,
 *    and NOTHING ELSE on the object. The literals are the panel's, field for field.
 *  - **THE ADDRESSEES ARE A LIST, NOT A `PillChoice`.** `toUserIds` is plural; the kit's
 *    single-choice row is not, and a request reaching one member where the panel reached three
 *    would be a different write wearing the same button.
 *  - **DISCARD AND ESCAPE ARE THE SAME EXIT**, and neither creates. `FormDialog` takes ONE
 *    `onDiscard` for the ×, the scrim, Escape and the button precisely so they cannot disagree —
 *    a second callback is how the × comes to keep a draft the operator dismissed.
 *  - **THE THREADS TAB'S BUTTON REACHES IT**, through the REAL nonce
 *    (`use-channels-v2-selection.ts › requestNewThread`) rather than a counter this file invents.
 *
 * ⚠ `useThreadWrites` IS MOCKED, exactly as `composer.test.tsx` mocks it and for the same reason:
 * this file is about which DRAFT is built, never about the optimistic layer that carries it
 * (`hooks/use-thread-writes.test.ts`).
 * ⚠ THE POPUP'S OWN KIT CONFORMANCE — the bold label, the underline sweep, the two footer scales —
 * is `shared/ui/form-dialog.test.tsx`. What belongs HERE is this form's payload and its wiring.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const fanOutThreads = vi.fn();

vi.mock("../../hooks/use-thread-writes", () => ({
  useThreadWrites: () => ({
    send: { mutate: vi.fn() },
    fanOutThreads: { mutate: fanOutThreads },
    pending: false,
  }),
}));

// ⚠ IN THE GRAPH, NOT UNDER ASSERTION — `composer.tsx` imports the template picker
// unconditionally. `composer.test.tsx` mocks it for the same reason.
vi.mock("@/features/agent-templates/hooks/use-agent-templates", () => ({
  useAgentTemplates: () => ({ templates: [], loading: false, error: null, refetch: () => {} }),
}));

import { useState } from "react";
import { ChannelsV2Composer } from "./composer";
import { ThreadsTab } from "./threads-tab";
import { useChannelsV2Selection } from "./use-channels-v2-selection";
import { indexMembers } from "./view-model";
import { member, CHANNEL_ID, ME, PEER } from "./test-fixtures";

const THIRD = "u-third";
const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang" }),
  member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
  member({ userId: THIRD, displayName: "Ada Lovelace", role: "member" }),
];

beforeEach(() => fanOutThreads.mockClear());
afterEach(cleanup);

const composerProps = (newThreadSignal: number) => ({
  channelId: CHANNEL_ID,
  workspaceId: "ws-1",
  members: MEMBERS,
  currentUserId: ME,
  gate: { begin: vi.fn(), end: vi.fn() },
  newThreadSignal,
});

/**
 * Mount the composer and ask ONCE — the Threads tab's ask, one increment in.
 *
 * ⚠ IT MUST BE A CHANGE, NOT A STARTING VALUE. The signal is a nonce and the open state is the
 * dialog's own, so a composer mounted at `1` has never been ASKED anything — which is correct
 * (the app mounts it at `0`) and is the trap a `render(props(1))` helper would hide.
 */
async function openPopup() {
  const view = render(<ChannelsV2Composer {...composerProps(0)} />);
  view.rerender(<ChannelsV2Composer {...composerProps(1)} />);
  // ⚠ `find`, NOT `get`: `modal-shell.tsx` mounts behind a `requestAnimationFrame` so the enter
  // transition gets its own paint. Every open on this surface is a tick away.
  await screen.findByRole("dialog", { name: "New thread" });
  return view;
}

/**
 * Scoped to the dialog.
 *
 * ⚠ IT EXISTS BECAUSE THE INLINE PANEL USED TO RENDER ITS OWN COPY OF EVERY PILL — always
 * mounted, collapsed to `grid-rows-[0fr]` — so a bare `screen.getByText("Diana's agent")` found
 * two. That panel is deleted, and the scope STAYS: this composer card can mount a second dialog
 * (New agent) whose own fields must never satisfy an assertion about this one.
 */
const dialog = () => within(screen.getByRole("dialog", { name: "New thread" }));

const dialogTitle = () => screen.getByLabelText("New thread title") as HTMLInputElement;
const dialogBody = () =>
  screen.getByLabelText("New thread description") as HTMLTextAreaElement;
const createButton = () => screen.getByRole("button", { name: "Create" }) as HTMLButtonElement;

function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

// ── 1. THE FORM ──────────────────────────────────────────────────────────────

describe("the popup renders the request's fields", () => {
  it("draws the title, the description and one pill per OTHER member", async () => {
    await openPopup();
    expect(dialogTitle()).toBeTruthy();
    expect(dialogBody().tagName).toBe("TEXTAREA");

    // ⚠ THE LABELS ARE THE KIT'S, ABOVE THE CONTROL — the visible words, which are the panel's
    // own two ("Title", "Description") plus the addressee section's.
    const card = screen.getByRole("dialog", { name: "New thread" });
    for (const word of ["Title", "Description", "Addressed"]) {
      expect(
        Array.from(card.querySelectorAll("label, span")).some(
          (el) => el.textContent === word
        )
      ).toBe(true);
    }

    // ⚠ EVERY OTHER MEMBER, AND NOT ME. You do not address your own agent.
    expect(dialog().getByText("Diana's agent")).toBeTruthy();
    expect(dialog().getByText("Ada's agent")).toBeTruthy();
    expect(dialog().queryByText("Sam's agent")).toBeNull();
  });

  it("gives the addressees a REMOVABLE LIST and not a single-choice row", async () => {
    // 🔒 `toUserIds` IS PLURAL. A `PillChoice` here would compile, render, and silently reduce
    // every request to one addressee — see this file's header.
    await openPopup();
    expect(dialog().queryByRole("tablist")).toBeNull();
    expect(dialog().getByRole("button", { name: "Remove Diana's agent" })).toBeTruthy();
    expect(dialog().getByRole("button", { name: "Remove Ada's agent" })).toBeTruthy();
  });

  it("refuses an incomplete request, and the disabled Create says why", async () => {
    await openPopup();
    expect(createButton().disabled).toBe(true);
    type(dialogTitle(), "Sweep the docs");
    expect(createButton().disabled).toBe(true);
    type(dialogBody(), "start here");
    expect(createButton().disabled).toBe(false);

    // Zero addressees is not sendable — "broadcast" is not a shape this product has.
    fireEvent.click(dialog().getByRole("button", { name: "Remove Diana's agent" }));
    fireEvent.click(dialog().getByRole("button", { name: "Remove Ada's agent" }));
    expect(createButton().disabled).toBe(true);
    expect(createButton().title).toBe(
      "A thread needs a title, a description and an addressee"
    );
    fireEvent.click(createButton());
    expect(fanOutThreads).not.toHaveBeenCalled();
  });
});

// ── 2. THE PAYLOAD, AGAINST THE PANEL IT REPLACED ────────────────────────────

/** The two fields, the keystrokes, and the press — through the POPUP. */
async function draftFromPopup(title: string, body: string) {
  await openPopup();
  type(dialogTitle(), title);
  type(dialogBody(), body);
  fireEvent.click(createButton());
  expect(fanOutThreads).toHaveBeenCalledTimes(1);
  return fanOutThreads.mock.calls[0][0];
}

describe("the payload is the panel's, field for field", () => {
  it("builds the draft the panel built, from the same inputs", async () => {
    // ⚠ THE TRAILING SPACE IS THE ASSERTION'S POINT: the panel `trim()`ed, and a popup that
    // forgot to would put a title on the wire the panel never could.
    const popup = await draftFromPopup("  Sweep the docs  ", "  start here  ");

    // 🔒 MUTATION-PROOF: drop the `.trim()`, rename `body` to `description`, or send
    // `targets` instead of `addressed` in `new-thread-dialog.tsx` and exactly one of these fails.
    expect(popup.channelId).toBe(CHANNEL_ID);
    expect(popup.title).toBe("Sweep the docs");
    expect(popup.body).toBe("start here");
    expect(popup.toUserIds).toEqual([PEER, THIRD]);
    // ⚠ THE KEY SET IS PART OF THE CLAIM — a draft carrying an extra field is a payload the
    // server's schema has never seen, and `TaskFanOutSchema` is not a `.passthrough()`.
    expect(Object.keys(popup).sort()).toEqual(
      ["body", "channelId", "clientMsgId", "title", "toUserIds"]
    );
  });

  it("mints ONE idempotency key per Create, and a FRESH one each time", async () => {
    // ⚠ INVARIANTS §8: the server derives one key per addressee from this plus the group id, so a
    // key minted anywhere but at the press is a key a second press can reuse.
    const first = await draftFromPopup("Alpha", "one");
    cleanup();
    fanOutThreads.mockClear();
    const second = await draftFromPopup("Alpha", "one");
    expect(typeof first.clientMsgId).toBe("string");
    expect(first.clientMsgId.length).toBeGreaterThan(0);
    expect(second.clientMsgId).not.toBe(first.clientMsgId);
  });

  it("drops a removed pill from `toUserIds` and nothing else", async () => {
    await openPopup();
    type(dialogTitle(), "Sweep the docs");
    type(dialogBody(), "start here");
    fireEvent.click(dialog().getByRole("button", { name: "Remove Diana's agent" }));
    fireEvent.click(createButton());
    expect(fanOutThreads.mock.calls[0][0].toUserIds).toEqual([THIRD]);
  });
});

// ── 3. THE ONE EXIT ──────────────────────────────────────────────────────────

describe("Discard and Escape are the same exit, and neither creates", () => {
  it("closes on Discard without a write, and comes back EMPTY", async () => {
    const view = await openPopup();
    type(dialogTitle(), "Sweep the docs");
    type(dialogBody(), "start here");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "New thread" })).toBeNull()
    );
    expect(fanOutThreads).not.toHaveBeenCalled();

    // ⚠ DISCARD CLEARS, IT DOES NOT MERELY HIDE — a form that came back holding a request the
    // operator dismissed would be remembering a decision they undid.
    view.rerender(<ChannelsV2Composer {...composerProps(2)} />);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "New thread" })).toBeTruthy());
    expect(dialogTitle().value).toBe("");
    expect(dialogBody().value).toBe("");
  });

  it("closes on Escape without a write", async () => {
    await openPopup();
    type(dialogTitle(), "Sweep the docs");
    type(dialogBody(), "start here");
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "New thread" })).toBeNull()
    );
    expect(fanOutThreads).not.toHaveBeenCalled();
  });

  it("closes on the × — one exit, not two", async () => {
    await openPopup();
    // ⚠ THE × IS "Close new thread form", NOT the inline panel's "Close new thread". Both forms
    // are mounted at once, and two controls sharing an accessible name are ONE control to a
    // screen reader.
    fireEvent.click(screen.getByRole("button", { name: "Close new thread form" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "New thread" })).toBeNull()
    );
    expect(fanOutThreads).not.toHaveBeenCalled();
  });
});

// ── 4. THE WIRING, FROM THE BUTTON THAT OPENS IT ─────────────────────────────

/**
 * The Threads tab and the composer, joined by the REAL nonce.
 *
 * ⚠ `use-channels-v2-selection.ts › requestNewThread` IS THE HOP, not a counter this file writes:
 * a harness with its own `useState` would pass with the product's increment deleted.
 * `surface-info-panel.tsx › onNewThread` is this wiring in the app, plus a `showChannel()`.
 */
function ThreadsTabHarness() {
  const sel = useChannelsV2Selection({});
  const [index] = useState(() => indexMembers(MEMBERS, ME));
  return (
    <>
      <ThreadsTab
        threads={[]}
        truncated={false}
        loading={false}
        index={index}
        openThreadId={null}
        onOpenThread={() => {}}
        onNewThread={sel.requestNewThread}
      />
      <ChannelsV2Composer {...composerProps(sel.newThreadSignal)} />
    </>
  );
}

/** ⚠ TWO CONTROLS ANSWER TO "New thread", AND BOTH OPEN THIS ONE FORM — the TAB's text button
 *  and the composer's icon glyph. The tab's is the one with the words IN it; the glyph is
 *  icon-only and carries its name on `aria-label`. Picking by index would silently follow a DOM
 *  reorder. */
const tabButton = () =>
  screen
    .getAllByRole("button", { name: "New thread" })
    .find((el) => el.textContent === "New thread") as HTMLButtonElement;
const composerGlyph = () =>
  screen
    .getAllByRole("button", { name: "New thread" })
    .find((el) => el.textContent === "") as HTMLButtonElement;

describe("both New thread buttons open the one popup", () => {
  it("opens it from the TAB, and opens it AGAIN after a Discard", async () => {
    // 🔒 MUTATION-PROOF: point `composer.tsx`'s `NewThreadDialog signal` at `threadDialogNonce`
    // alone, and this goes red.
    render(<ThreadsTabHarness />);
    const button = tabButton;
    expect(screen.queryByRole("dialog", { name: "New thread" })).toBeNull();

    fireEvent.click(button());
    await waitFor(() => expect(screen.getByRole("dialog", { name: "New thread" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "New thread" })).toBeNull()
    );

    // ⚠ THE SIGNAL IS A COUNTER: a boolean would open once and leave this button dead for the
    // rest of the session.
    fireEvent.click(button());
    await waitFor(() => expect(screen.getByRole("dialog", { name: "New thread" })).toBeTruthy());
  });

  it("opens the SAME form from the COMPOSER GLYPH, and writes the same draft", async () => {
    // ⚠ THE GLYPH WAS THE MISSING WIRE (Samuel, 2026-09-08: *"look there is an icon in the text
    // input bar that is supposed to spawn new threads. Why wasn't that wired in"*). It opened an
    // INLINE panel until this change; that panel is deleted, so what this pins is that the glyph
    // reaches THIS dialog and that a request raised from it is the same write.
    // 🔒 MUTATION-PROOF: point `composer.tsx`'s `onNewThread` at a no-op, or drop
    // `threadDialogNonce` out of the dialog's `signal`, and this goes red.
    render(<ThreadsTabHarness />);
    fireEvent.click(composerGlyph());
    await waitFor(() => expect(screen.getByRole("dialog", { name: "New thread" })).toBeTruthy());

    type(dialogTitle(), "Sweep the docs");
    type(dialogBody(), "start here");
    fireEvent.click(createButton());
    expect(fanOutThreads).toHaveBeenCalledTimes(1);
    expect(fanOutThreads.mock.calls[0][0].toUserIds).toEqual([PEER, THIRD]);
  });

  it("has NO SECOND thread form for either button to reach", () => {
    // ⚠ DELETED, NOT HIDDEN. The inline panel's fields were queryable even while it was shut —
    // it collapsed rather than unmounting — so their absence is the assertion that says the
    // panel is gone rather than merely closed.
    render(<ThreadsTabHarness />);
    expect(screen.queryByLabelText("Thread title")).toBeNull();
    expect(screen.queryByLabelText("Thread description")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close new thread" })).toBeNull();
    // ⚠ AND THE GLYPH HAS NO PRESSED STATE: it opens a modal it cannot close.
    expect(composerGlyph().getAttribute("aria-pressed")).toBeNull();
  });
});
