import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageComposer } from "@/features/channels/components/message-composer";

/**
 * The first frame after Enter. Pinned HERE because the root suite runs in the
 * node environment with no DOM and cannot press a key.
 *
 *  - draft clears BEFORE the network settles (it has moved into the transcript
 *    as a pending row);
 *  - send button MORPHS to the pause face for the length of the write;
 *  - a FAILED send restores the draft verbatim — the caller rolled its cache
 *    back and the message exists nowhere else.
 */

/** A send whose promise the test settles by hand. */
function deferredSend() {
  let settle!: () => void;
  let fail!: () => void;
  const done = new Promise<void>((resolve, reject) => {
    settle = resolve;
    fail = () => reject(new Error("nope"));
  });
  const onSend = vi.fn(() => done);
  return { onSend, settle, fail, done };
}

function composer(onSend: () => Promise<void>) {
  // ⚠ NO ROSTER PROP any more. The composer stopped taking one when request
  // mode retired (wiring plan Phase 3) — it has nobody to address.
  render(<MessageComposer onSend={onSend} />);
  return screen.getByPlaceholderText("Message the channel") as HTMLTextAreaElement;
}

function type(field: HTMLTextAreaElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

function press(field: HTMLTextAreaElement) {
  fireEvent.keyDown(field, { key: "Enter" });
}

describe("MessageComposer — the optimistic send", () => {
  /** ⚠ `{ intent: "chat" }` IS THE ASSERTION, not decoration: absence reads as
   *  `request` server-side, so a dropped field puts every message on this page
   *  back on the lane that can start somebody's agent. */
  it("clears the draft before the write settles", async () => {
    const { onSend, settle, done } = deferredSend();
    const field = composer(onSend);
    type(field, "morning");
    press(field);

    expect(onSend).toHaveBeenCalledWith("morning", { intent: "chat" });
    // Network has NOT answered and the field is already empty.
    expect(field.value).toBe("");

    settle();
    await done;
    expect(field.value).toBe("");
  });

  it("morphs the send button to the pause face while the write is in flight", async () => {
    const { onSend, settle, done } = deferredSend();
    const field = composer(onSend);
    expect(screen.getByRole("button", { name: "Send message" })).toBeTruthy();

    type(field, "morning");
    press(field);
    // A different control for the length of the round trip, not an opacity
    // change.
    expect(screen.getByRole("button", { name: "Sending" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();

    settle();
    await done;
    // Back to the send face once the write settles.
    expect(await screen.findByRole("button", { name: "Send message" })).toBeTruthy();
  });

  it("puts the draft back, verbatim, when the write fails", async () => {
    const { onSend, fail, done } = deferredSend();
    const field = composer(onSend);
    type(field, "morning");
    press(field);
    expect(field.value).toBe("");

    fail();
    await done.catch(() => undefined);
    // One more turn of the loop for the post-rejection restore.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(field.value).toBe("morning");
  });

  it("does not clobber a draft typed while the failed write was in flight", async () => {
    const { onSend, fail, done } = deferredSend();
    const field = composer(onSend);
    type(field, "morning");
    press(field);
    type(field, "second thought");

    fail();
    await done.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(field.value).toBe("second thought");
  });

  it("refuses an empty draft — nothing optimistic, nothing sent", () => {
    const { onSend } = deferredSend();
    const field = composer(onSend);
    type(field, "   ");
    press(field);
    expect(onSend).not.toHaveBeenCalled();
  });
});
