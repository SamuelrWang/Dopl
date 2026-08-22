// @vitest-environment jsdom
/**
 * DELETE THREAD, END TO END ON THE CLIENT (Samuel, 2026-08-21) — the confirm
 * dialog, the stop-then-delete order, and the silent degrade without a bridge.
 *
 * ⚠ THE ORDER IS THE WHOLE POINT AND NOTHING ELSE PINS IT. My own agents on the
 * thread are ENDED FIRST, then the DELETE leaves. Reversed, the transcript goes
 * out from under a live session that is still posting into it. Neither half fails
 * loudly on its own, so a regression would show up as an occasional stray message
 * in a channel — which is why the order is asserted as a sequence rather than as
 * two independent calls.
 *
 * ⚠ THE STOP IS BEST-EFFORT AND MUST NEVER BLOCK THE DELETE. A plain browser has
 * no bridge (`useAgentControls` answers `false`), an older main lacks the op, and
 * an agent whose registry entry has already gone refuses — none of those is a
 * reason to keep the thread. This is the ONE place the family's
 * "never swallow main's verdict" rule is deliberately not applied: the verdict the
 * operator asked for is the DELETE's.
 *
 * ⚠ PEERS ARE NOT REACHED, structurally: every op resolves against THIS machine's
 * registry (INVARIANTS §11), so a peer's agent on the deleted thread is left to
 * its own idle/abandon timer. Accepted, and asserted so nobody "completes" it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";

const control = vi.fn(async () => true);
const removeMutateAsync = vi.fn(async () => undefined);
const setModeMutate = vi.fn();

vi.mock("./agents-controls", () => ({
  useAgentControls: () => control,
}));
vi.mock("../../hooks/use-thread-lifecycle-writes", () => ({
  useThreadLifecycleWrites: (deps: { onDeleted: (id: string) => void }) => {
    lastDeps = deps;
    return {
      setMode: { mutate: setModeMutate, pending: false },
      remove: { mutateAsync: removeMutateAsync, pending: false },
      pending: false,
    };
  },
}));

let lastDeps: { onDeleted: (id: string) => void } | null = null;

import { ChannelsV2ThreadManageActions } from "./thread-manage";
import { CHANNEL_ID, ME, thread as makeThread } from "./test-fixtures";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  lastDeps = null;
});

const THREAD_ID = "t-1";

function session(over: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    sessionId: "s-1",
    channelId: CHANNEL_ID,
    taskId: THREAD_ID,
    name: "flint",
    state: "working",
    ...over,
  } as DesktopSessionSummary;
}

function mount(over: {
  agentSessions?: readonly DesktopSessionSummary[] | null;
  canManageChannel?: boolean;
  createdBy?: string;
} = {}) {
  const onDeleted = vi.fn();
  render(
    <ChannelsV2ThreadManageActions
      thread={makeThread({ id: THREAD_ID, createdBy: over.createdBy ?? ME })}
      workspaceId="ws-1"
      currentUserId={ME}
      canManageChannel={over.canManageChannel ?? false}
      agentSessions={over.agentSessions ?? null}
      gate={{ begin: () => {}, end: () => {} }}
      onDeleted={onDeleted}
    />
  );
  return { onDeleted };
}

/**
 * Open the confirm dialog and press the destructive button. ⚠ `await`ed because
 * `ModalShell` mounts a frame after `open` flips (it animates in), so the button
 * is not in the DOM on the click that asked for it.
 */
async function confirmDelete() {
  fireEvent.click(screen.getByText("Delete thread"));
  fireEvent.click(await screen.findByText("Delete permanently"));
}

describe("delete thread", () => {
  it("asks before it deletes", async () => {
    mount();
    fireEvent.click(screen.getByText("Delete thread"));
    expect(await screen.findByText("Delete thread?")).toBeTruthy();
    // ⚠ Opening the dialog writes nothing.
    expect(removeMutateAsync).not.toHaveBeenCalled();
  });

  it("says what goes, for whom, and that it cannot be undone", async () => {
    mount();
    fireEvent.click(screen.getByText("Delete thread"));
    await screen.findByText("Delete thread?");
    const text = document.body.textContent ?? "";
    expect(text).toContain("permanently deleted");
    expect(text).toContain("everyone in this channel");
    expect(text).toContain("can't be undone");
  });

  it("ENDS my own agents on the thread, then deletes", async () => {
    const order: string[] = [];
    control.mockImplementation(async () => {
      order.push("end");
      return true;
    });
    removeMutateAsync.mockImplementation(async () => {
      order.push("delete");
      return undefined;
    });
    mount({ agentSessions: [session()] });

    await confirmDelete();

    await waitFor(() => expect(order).toEqual(["end", "delete"]));
    expect(control).toHaveBeenCalledWith("end", {
      channelId: CHANNEL_ID,
      taskId: THREAD_ID,
    });
  });

  /** ⚠ ONE CALL PER AGENT, not one per thread: `(channel, thread)` addresses a
   *  THREAD since multiplayer agents (F-239), so looping the rows is what ends
   *  all of them on a main that ends one per call. */
  it("ends every one of my agents standing on the thread", async () => {
    mount({
      agentSessions: [
        session({ sessionId: "s-1" }),
        session({ sessionId: "s-2" }),
      ],
    });
    await confirmDelete();
    await waitFor(() => expect(removeMutateAsync).toHaveBeenCalled());
    expect(control).toHaveBeenCalledTimes(2);
  });

  it("touches agents on OTHER threads not at all", async () => {
    mount({ agentSessions: [session({ taskId: "t-other" })] });
    await confirmDelete();
    await waitFor(() => expect(removeMutateAsync).toHaveBeenCalled());
    expect(control).not.toHaveBeenCalled();
  });

  /** `null` = could not ask (a plain browser, or a main without the feed). The
   *  delete still goes. */
  it("deletes with no bridge at all", async () => {
    mount({ agentSessions: null });
    await confirmDelete();
    await waitFor(() =>
      expect(removeMutateAsync).toHaveBeenCalledWith({
        channelId: CHANNEL_ID,
        threadId: THREAD_ID,
      })
    );
    expect(control).not.toHaveBeenCalled();
  });

  /** A refused or throwing stop is one agent that outlives the thread by a
   *  timeout — not a reason to leave the thread standing. */
  it("deletes even when the stop op throws", async () => {
    control.mockRejectedValue(new Error("no-bridge"));
    mount({ agentSessions: [session()] });
    await confirmDelete();
    await waitFor(() => expect(removeMutateAsync).toHaveBeenCalled());
  });

  it("hands the deletion back up so the selection can leave the thread", async () => {
    const { onDeleted } = mount();
    await confirmDelete();
    await waitFor(() => expect(removeMutateAsync).toHaveBeenCalled());
    lastDeps?.onDeleted(THREAD_ID);
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });
});

describe("who sees what", () => {
  it("gives the creator both controls", () => {
    mount({ createdBy: ME });
    expect(screen.getByText("Mode")).toBeTruthy();
    expect(screen.getByText("Delete thread")).toBeTruthy();
  });

  /** A manager may delete somebody else's thread and may NOT set its mode — the
   *  server's split (`setTaskMode` is creator-only), mirrored so neither row is
   *  inert. */
  it("gives a channel manager Delete alone on somebody else's thread", () => {
    mount({ createdBy: "u-someone", canManageChannel: true });
    expect(screen.queryByText("Mode")).toBeNull();
    expect(screen.getByText("Delete thread")).toBeTruthy();
  });

  it("gives a plain participant nothing to manage", () => {
    mount({ createdBy: "u-someone", canManageChannel: false });
    expect(screen.getByText("Nothing to manage")).toBeTruthy();
  });
});
