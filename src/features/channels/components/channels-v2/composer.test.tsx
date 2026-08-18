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

function mount() {
  render(
    <ChannelsV2Composer
      channelId={CHANNEL_ID}
      workspaceId="ws-1"
      members={MEMBERS}
      currentUserId={ME}
      gate={{ begin: vi.fn(), end: vi.fn() }}
    />
  );
  return {
    body: screen.getByLabelText("Message") as HTMLTextAreaElement,
    openPanel: () =>
      fireEvent.click(screen.getByRole("button", { name: "New agent thread" })),
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
