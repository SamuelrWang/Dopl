import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageComposer } from "@/features/channels/components/message-composer";
import type { ChannelMember } from "@/features/channels/types";

/**
 * THE FLAGSHIP INTERACTION, exercised where it actually runs.
 *
 * P0-1's user-visible claim is about the first frame after Enter: the operator's
 * text leaves the composer AT ONCE and the button stops pretending the only
 * thing that changed is its opacity. Neither can be pinned in the root suite —
 * it runs in the node environment with no DOM, so nothing there can press a
 * key. Same reasoning as `composer-intent-pill.test.tsx`.
 *
 * What each case is about:
 *  - the draft clears BEFORE the network settles (it has moved into the
 *    transcript as a pending row; waiting for the round trip is exactly what
 *    made the operator's own words sit in the field through two hops);
 *  - the send button MORPHS to the pause face for the length of the write — the
 *    `mode="pause"` affordance `SendButton` has carried since it was extracted
 *    and no composer ever passed;
 *  - a FAILED send puts the draft back verbatim, because the caller rolled its
 *    cache back and the message no longer exists anywhere else.
 */

const ME = "user-me";
const PEER = "user-peer";

function member(userId: string, displayName: string): ChannelMember {
  return {
    channelId: "channel-1",
    userId,
    role: "member",
    lastReadAt: null,
    notifyScope: null,
    agentToolProfile: null,
    agentOnline: true,
    lastSeenAt: "2026-08-07T10:00:00.000Z",
    addedBy: null,
    joinedAt: "2026-08-07T09:00:00.000Z",
    displayName,
    email: null,
    avatarUrl: null,
  };
}

const MEMBERS = [member(ME, "Sam"), member(PEER, "Ada")];

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
  render(
    <MessageComposer onSend={onSend} members={MEMBERS} currentUserId={ME} />
  );
  return screen.getByPlaceholderText("Message the channel") as HTMLTextAreaElement;
}

function type(field: HTMLTextAreaElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

function press(field: HTMLTextAreaElement) {
  fireEvent.keyDown(field, { key: "Enter" });
}

describe("MessageComposer — the optimistic send", () => {
  it("clears the draft before the write settles", async () => {
    const { onSend, settle, done } = deferredSend();
    const field = composer(onSend);
    type(field, "morning");
    press(field);

    expect(onSend).toHaveBeenCalledWith("morning", { intent: "chat" });
    // The network has NOT answered and the field is already empty.
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
    // The one pixel that used to change was this button's opacity. Now it is a
    // different control for the length of the round trip.
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
    // One more turn of the loop for the restore that follows the rejection.
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
