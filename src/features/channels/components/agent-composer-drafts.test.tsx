// @vitest-environment jsdom
/**
 * **ONE COMPOSER INSTANCE, ONE DRAFT PER AGENT** (Samuel, 2026-09-05: type to
 * agent A, switch to B, and B's box was showing A's words).
 *
 * The cause is ordinary React and that is what makes it worth pinning: the
 * component stays MOUNTED across an agent switch, so its `useState` keeps
 * serving the agent it was filled for. The fix is a keyed swap during render,
 * and the three properties below are the ones that fail quietly:
 *
 *  - **THE DRAFT FOLLOWS THE ADDRESSEE**, both ways — B starts empty AND A comes
 *    back. A fix that only cleared on switch would look right in the first
 *    direction and silently throw away work in the second.
 *  - **IT IS NOT A REMOUNT.** `key={agentId}` would fix the draft and lose
 *    everything else the box holds — an in-flight send's verdict most of all,
 *    which is the one thing this surface promises to deliver even when the agent
 *    dies mid-send. The case below detects a remount through the composer's own
 *    mount-once capability read.
 *  - **A DEAD AGENT'S DRAFT GOES.** Nothing revives an ended session, so a draft
 *    addressed to one can only ever be re-typed somewhere else.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AgentComposer } from "./agent-composer";
import { CHANNEL_ID } from "./test-fixtures";

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

/** ⚠ `apiRequest` is the SPA marker `getSpaBridge` keys on — without it there is
 *  no bridge at all and every case collapses to "cannot message". */
function bridge() {
  const message = vi.fn().mockResolvedValue({ ok: true });
  (window as { dopl?: unknown }).dopl = {
    apiRequest: vi.fn(),
    sessions: { reopen: vi.fn(), message },
  };
  return message;
}

function composer(agentId: string, ended = false) {
  return (
    <AgentComposer
      channelId={CHANNEL_ID}
      taskId="t-1"
      agentId={agentId}
      name={agentId}
      ended={ended}
    />
  );
}

const box = () => screen.getByRole("textbox") as HTMLTextAreaElement;

describe("drafts are per agent", () => {
  it("does not carry A's words into B's box, and gives them back on the way home", () => {
    bridge();
    const { rerender } = render(composer("aaaaaaaa"));
    fireEvent.change(box(), { target: { value: "for A" } });

    rerender(composer("bbbbbbbb"));
    expect(box().value).toBe("");

    // ⚠ THE HALF A NAIVE FIX LOSES. Clearing on switch passes the assertion
    // above and quietly destroys work every time the operator looks at another
    // agent mid-sentence.
    fireEvent.change(box(), { target: { value: "for B" } });
    rerender(composer("aaaaaaaa"));
    expect(box().value).toBe("for A");
    rerender(composer("bbbbbbbb"));
    expect(box().value).toBe("for B");
  });

  it("🔒 swaps WITHOUT remounting — the instance survives the switch", () => {
    // ⚠ HOW THIS DETECTS A REMOUNT, since a component cannot be asked. The
    // composer reads its capability ONCE, in lazy state at mount
    // (`useCanMessageAgent`), and renders NOTHING when it is false. So: mount
    // with a bridge, take the bridge away, switch agents. A live instance keeps
    // its answer and keeps rendering; a remount re-reads, gets false, and the
    // box disappears. The same read is what would drop an in-flight send's
    // verdict, which is the cost that made `key={agentId}` the wrong fix.
    bridge();
    const { rerender } = render(composer("aaaaaaaa"));
    delete (window as { dopl?: unknown }).dopl;
    rerender(composer("bbbbbbbb"));
    expect(screen.queryByRole("textbox")).not.toBeNull();
  });

  it("drops the draft when that agent ENDS", () => {
    bridge();
    const { rerender } = render(composer("aaaaaaaa"));
    fireEvent.change(box(), { target: { value: "for A" } });

    // Dead is dead: the input goes entirely, and the words go with it rather
    // than waiting to be shown to whoever opens this agent next.
    rerender(composer("aaaaaaaa", true));
    expect(screen.queryByRole("textbox")).toBeNull();

    rerender(composer("aaaaaaaa"));
    expect(box().value).toBe("");
  });
});

describe("the box grows", () => {
  it("hands the field to the shared auto-grow hook, at the composer's ceiling", () => {
    // ⚠ jsdom REPORTS `scrollHeight` AS 0, so `use-auto-grow.ts` is a deliberate
    // no-op here and a height assertion would pin nothing (that file says so in
    // its own header). What IS worth pinning is the wiring: the hook needs the
    // element, so a field the hook cannot reach is the failure mode — and it is
    // exactly the state this box shipped in, stuck at `rows={1}` while the
    // channel composer had grown since 2026-08-20.
    bridge();
    render(composer("aaaaaaaa"));
    expect(box().rows).toBe(1);
    expect(box().style.height).not.toBe("");
  });
});
