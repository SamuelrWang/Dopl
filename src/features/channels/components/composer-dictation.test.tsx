// @vitest-environment jsdom
/**
 * **LIVE DICTATION THROUGH THE REAL COMPOSER — the wiring, not the arithmetic** (Samuel,
 * 2026-10-12 item 2; the loss-mode cases are Review 21's).
 *
 * ⚠ **THIS IS ITS OWN FILE BECAUSE `composer-toolbar.test.tsx` HIT THE 500-LINE CAP** and §1 is
 * explicit that an edit to an over-cap file either splits it or shrinks it. ⚠ **AND IT IS A REAL
 * SEAM**: that file is about the ROW — where the recipient tag hangs, the 24px glyph face, the
 * icon order, the mic's own chrome — while this one is about what dictation DOES TO THE DRAFT.
 * One reason to change each.
 *
 * ⚠ **WHERE THE REST OF THE RULE LIVES.** `dictation/insert-text.test.ts` owns the arithmetic
 * (pure, seventeen cases, no engine); `use-dictation.test.ts` owns the engine events. What can
 * only break HERE is the composer's four refs: the anchor taken off the textarea's own caret, the
 * mirror that lets two phrases in one tick compose, the `lastWritten` guard that re-anchors after
 * an outside edit, and the reset that stops a second dictation resuming at the end of the first.
 * So every case drives REAL engine events through the REAL composer and reads the textarea.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  engineEnds,
  engineSays,
  installWebRecognition,
  removeWebRecognition,
} from "./dictation/recognition-harness";

vi.mock("../hooks/use-thread-writes", () => ({
  useThreadWrites: () => ({
    send: { mutate: vi.fn() },
    fanOutThreads: { mutate: vi.fn() },
    pending: false,
  }),
}));

vi.mock("@/features/agent-identities/hooks/use-agent-identities", () => ({
  useAgentIdentities: () => ({ identities: [], loading: false, error: null, refetch: () => {} }),
}));

import { ChannelsComposer } from "./composer";
import { member, CHANNEL_ID, ME, PEER } from "./test-fixtures";

const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang" }),
  member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
];

beforeEach(installWebRecognition);
afterEach(() => {
  removeWebRecognition();
  cleanup();
});

function mount() {
  render(
    <ChannelsComposer
      channelId={CHANNEL_ID}
      workspaceId="ws-1"
      members={MEMBERS}
      currentUserId={ME}
      gate={{ begin: vi.fn(), end: vi.fn() }}
    />
  );
}

const btn = (name: string) => screen.getByRole("button", { name });
const messageBox = () => screen.getByLabelText("Message") as HTMLTextAreaElement;

/**
 * **DICTATION TYPES INTO THE BOX, LIVE** (Samuel, 2026-10-12, item 2: *"text collects LEFT of the
 * mic and only enters the input when dictation ends. Make it stream into the input live, as if
 * typed"*).
 *
 * ⚠ **THE PREVIEW'S ABSENCE IS ASSERTED, because deleting a caption leaves no error.** The
 * words used to appear beside the mic and only there; a change that inserted live AND kept the
 * caption would pass every other case in this file while showing the operator everything twice.
 */
describe("dictation streams into the input", () => {
  it("shows an INTERIM phrase in the box immediately", () => {
    mount();
    fireEvent.click(btn("Dictate"));
    engineSays("hello wor", false);
    // ⚠ THE OLD BEHAVIOUR WAS AN EMPTY BOX until the engine closed the phrase.
    expect(messageBox().value).toBe("hello wor");
  });

  it("replaces the interim IN PLACE as the engine re-words it", () => {
    mount();
    fireEvent.click(btn("Dictate"));
    engineSays("hello wor", false);
    engineSays("hello world", false);
    expect(messageBox().value).toBe("hello world");
  });

  it("writes AT THE CARET and keeps the text after it", () => {
    mount();
    fireEvent.change(messageBox(), { target: { value: "ping  — thanks" } });
    // ⚠ THE CARET IS THE TEXTAREA'S OWN, read when the first phrase arrives: the mic button holds
    // focus by then, and a textarea keeps its selection.
    messageBox().setSelectionRange(5, 5);
    fireEvent.click(btn("Dictate"));
    engineSays("now", true);
    expect(messageBox().value).toBe("ping now — thanks");
  });

  it("leaves the caret after the dictated words, as if typed", () => {
    // ⚠ **THE TEXT AFTER THE CARET IS WHAT MAKES THIS A TEST.** A value change puts a textarea's
    // caret at the END of the new value by default, so dictating into the TAIL of a draft reads
    // as "the caret followed the words" whether anything placed it or not — measured: this case
    // passed with `setSelectionRange` removed until the trailing " — thanks" was added.
    mount();
    fireEvent.change(messageBox(), { target: { value: "ping  — thanks" } });
    messageBox().setSelectionRange(5, 5);
    fireEvent.click(btn("Dictate"));
    engineSays("now", false);
    expect(messageBox().value).toBe("ping now — thanks");
    expect(messageBox().selectionStart).toBe(8);
  });

  it("keeps words typed BEFORE the mic was opened", () => {
    mount();
    fireEvent.change(messageBox(), { target: { value: "note" } });
    fireEvent.click(btn("Dictate"));
    engineSays("and this", true);
    expect(messageBox().value).toBe("note and this");
  });

  it("commits the outstanding interim when the session ends", () => {
    // ⚠ NO SECOND COPY. The characters are already in the box from the interim, so a commit that
    // appended would read "and more and more" — the most common way to end a dictation.
    mount();
    fireEvent.click(btn("Dictate"));
    engineSays("and more", false);
    engineEnds();
    expect(messageBox().value).toBe("and more");
  });

  it("starts the NEXT dictation at the caret, not after the last one", () => {
    // ⚠ THE REF RESET THIS PINS: a span that outlived its session would anchor phrase two to the
    // end of phrase one wherever the operator had moved since.
    mount();
    fireEvent.click(btn("Dictate"));
    engineSays("second", true);
    engineEnds();
    expect(messageBox().value).toBe("second");

    messageBox().setSelectionRange(0, 0);
    fireEvent.click(btn("Dictate"));
    engineSays("first", true);
    expect(messageBox().value).toBe("firstsecond");
  });

  it("no longer previews the phrase beside the mic", () => {
    mount();
    fireEvent.click(btn("Dictate"));
    engineSays("hello wor", false);
    const row = btn("Send").parentElement as HTMLElement;
    // ⚠ The box has the words; the row must not also carry a caption of them.
    expect(messageBox().value).toBe("hello wor");
    expect(row.querySelector("[aria-live]")).toBeNull();
    const captions = [...row.querySelectorAll("span")].map((s) => s.textContent);
    expect(captions).not.toContain("hello wor");
  });
});

/**
 * 🔴 **TYPING WHILE THE MIC IS OPEN MUST NOT DESTROY CHARACTERS** (Review 21, Batch 21 — a real
 * defect in the first cut of live dictation, and a LOSS MODE THE OLD BEHAVIOUR DID NOT HAVE:
 * appending to the end of the draft never deleted anything).
 *
 * ⚠ **THE CAUSE WAS A STALE SPAN, NOT BAD ARITHMETIC.** `insertDictation` replaces the character
 * range the last interim wrote. The moment the operator types OUTSIDE that range every index
 * after their caret shifts, so the range now covers THEIR characters — and the next interim
 * replaces them. The reviewer's probe: draft `abc def` with the caret at 3, interim `hi` →
 * `abc hi def`; then a `Z` typed at position 0 and the next interim gave `Zab hi therei def`,
 * i.e. the `c` gone.
 *
 * ⚠ **THE RULE IS "THE OPERATOR'S EDIT WINS"**, in all three shapes below. An edit this closure
 * did not make re-anchors the session at the caret with an empty span, so dictation CONTINUES
 * where the person is writing and whatever the last interim had already put in the box stays
 * behind as ordinary typed text. Nothing is rewound and nothing is deleted.
 *
 * ⚠ **THESE ARE WIRING CASES AND COULD NOT BE PURE ONES.** `insertDictation` is handed a span and
 * cannot know an edit happened — detecting it needs the draft the closure last WROTE, which is
 * the composer's ref. `dictation/insert-text.test.ts` owns the arithmetic; this owns the anchor.
 */
describe("typing while the mic is open loses nothing", () => {
  it("keeps every character when text is typed BEFORE the live span", () => {
    mount();
    fireEvent.change(messageBox(), { target: { value: "abc def" } });
    messageBox().setSelectionRange(3, 3);
    fireEvent.click(btn("Dictate"));
    engineSays("hi", false);
    expect(messageBox().value).toBe("abc hi def");

    // The operator types a `Z` at the very start — every index after it has moved.
    fireEvent.change(messageBox(), { target: { value: "Zabc hi def" } });
    messageBox().setSelectionRange(1, 1);
    engineSays("hi there", false);
    // ⚠ THE PROBE: this was `Zab hi therei def` — the `c` deleted by the next interim.
    const after = messageBox().value;
    expect(after).toContain("abc");
    expect(after).toContain("hi there");
    expect(after.startsWith("Z")).toBe(true);
  });

  it("keeps a character typed INSIDE the live span", () => {
    mount();
    fireEvent.change(messageBox(), { target: { value: "abc def" } });
    messageBox().setSelectionRange(3, 3);
    fireEvent.click(btn("Dictate"));
    engineSays("hi", false);
    expect(messageBox().value).toBe("abc hi def");

    // An `X` typed into the middle of the words dictation itself just wrote.
    fireEvent.change(messageBox(), { target: { value: "abc Xhi def" } });
    messageBox().setSelectionRange(5, 5);
    engineSays("hi there", false);
    // ⚠ THE SECOND PROBE: this lost the `X` and left an orphan `i`.
    const after = messageBox().value;
    expect(after).toContain("X");
    expect(after).toContain("hi there");
    expect(after).toContain("def");
  });

  it("continues at the operator's caret, and leaves the earlier interim as typed text", () => {
    // ⚠ THE POSITIVE HALF OF THE RULE, so "nothing is lost" cannot be satisfied by freezing.
    mount();
    fireEvent.change(messageBox(), { target: { value: "abc def" } });
    messageBox().setSelectionRange(3, 3);
    fireEvent.click(btn("Dictate"));
    engineSays("hi", false);
    fireEvent.change(messageBox(), { target: { value: "Zabc hi def" } });
    messageBox().setSelectionRange(1, 1);
    engineSays("ok", false);
    expect(messageBox().value).toBe("Z okabc hi def");
  });

  it("still replaces its OWN interim in place when nobody typed", () => {
    // ⚠ THE REGRESSION GUARD ON THE FIX: a re-anchor that fired on every phrase would append
    // each interim instead of replacing it ("hello wor hello world").
    mount();
    fireEvent.click(btn("Dictate"));
    engineSays("hello wor", false);
    engineSays("hello world", false);
    expect(messageBox().value).toBe("hello world");
  });
});
