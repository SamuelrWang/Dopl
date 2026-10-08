// @vitest-environment jsdom
/**
 * 🔒 UNSENT DRAFTS SURVIVE (Samuel, 2026-10-08): navigation, reload and restart keep them; a
 * successful send clears them, a failed one does not; targets and accounts never share one.
 * "Reload" here = module memory reset with `localStorage` left as it was.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAFT_CAP,
  DRAFT_DEBOUNCE_MS,
  DRAFT_TTL_MS,
  __resetDraftStoreForTests,
  clearDraftsForTarget,
  draftKey,
  flushDrafts,
  orphanedSends,
  readDraft,
  resolveOrphanedSend,
  settlePendingSend,
  stashPendingSend,
  subscribeDraft,
  writeDraft,
} from "./draft-store";

let clock = 1_000_000;
const reload = () => __resetDraftStoreForTests(() => clock);

const ME = { userId: "u-me", workspaceId: "ws-1" };
const key = (target: string, scope: { userId: string | null; workspaceId?: string } = ME) =>
  draftKey(scope, target);

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  clock = 1_000_000;
  reload();
});
afterEach(() => vi.useRealTimers());

describe("a draft is kept", () => {
  it("in memory at once, on disk after the debounce", () => {
    const k = key("channel:c1");
    writeDraft(k, { text: "hello" });
    expect(readDraft(k)?.text).toBe("hello");
    expect(localStorage.length).toBe(0);
    vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS);
    expect(localStorage.length).toBe(1);
  });

  it("across a RELOAD (memory gone, storage kept)", () => {
    writeDraft(key("channel:c1"), { text: "half a thought", extra: { addressOff: true } });
    flushDrafts();
    reload();
    expect(readDraft(key("channel:c1"))).toEqual({
      text: "half a thought",
      extra: { addressOff: true },
    });
  });

  it("flushed when the page hides, before the debounce", () => {
    writeDraft(key("channel:c1"), { text: "quit now" });
    window.dispatchEvent(new Event("pagehide"));
    reload();
    expect(readDraft(key("channel:c1"))?.text).toBe("quit now");
  });
});

describe("isolation", () => {
  it("per target", () => {
    writeDraft(key("channel:c1"), { text: "one" });
    writeDraft(key("channel:c2"), { text: "two" });
    flushDrafts();
    reload();
    expect(readDraft(key("channel:c1"))?.text).toBe("one");
    expect(readDraft(key("channel:c2"))?.text).toBe("two");
  });

  it("per account and per workspace on one machine", () => {
    writeDraft(key("channel:c1"), { text: "mine" });
    flushDrafts();
    reload();
    expect(readDraft(key("channel:c1", { userId: "u-other", workspaceId: "ws-1" }))).toBeNull();
    expect(readDraft(key("channel:c1", { userId: "u-me", workspaceId: "ws-2" }))).toBeNull();
  });

  it("no signed-in user ⇒ no key, nothing on disk", () => {
    expect(key("channel:c1", { userId: null })).toBeNull();
    writeDraft(null, { text: "x" });
    flushDrafts();
    expect(localStorage.length).toBe(0);
  });
});

describe("sending", () => {
  it("a SUCCESSFUL send clears the draft, disk included", () => {
    const k = key("channel:c1");
    writeDraft(k, { text: "send me" });
    stashPendingSend(k, "msg-1", { text: "send me" });
    expect(readDraft(k)).toBeNull();
    settlePendingSend("msg-1", true);
    reload();
    expect(readDraft(key("channel:c1"))).toBeNull();
  });

  it("a FAILED send puts the text back", () => {
    const k = key("channel:c1");
    stashPendingSend(k, "msg-1", { text: "do not lose me" });
    settlePendingSend("msg-1", false);
    expect(readDraft(k)?.text).toBe("do not lose me");
    reload();
    expect(readDraft(key("channel:c1"))?.text).toBe("do not lose me");
  });

  it("a failed send keeps what was typed since, after the failed text", () => {
    const k = key("channel:c1");
    stashPendingSend(k, "msg-1", { text: "first" });
    writeDraft(k, { text: "second" });
    settlePendingSend("msg-1", false);
    expect(readDraft(k)?.text).toBe("first\n\nsecond");
  });

  it("a send a RELOAD cut off is an orphan the next page must settle", () => {
    stashPendingSend(key("channel:c1"), "msg-1", { text: "in flight" });
    // Same page: it is this page's own send, not an orphan.
    expect(orphanedSends(key("channel:c1"))).toEqual([]);
    reload();
    expect(readDraft(key("channel:c1"))).toBeNull();
    expect(orphanedSends(key("channel:c1"))).toEqual([{ id: "msg-1", value: { text: "in flight" } }]);
  });

  it("orphan LANDED ⇒ dropped silently, and never asked about again", () => {
    stashPendingSend(key("channel:c1"), "msg-1", { text: "in flight" });
    reload();
    resolveOrphanedSend(key("channel:c1"), "msg-1", true);
    expect(readDraft(key("channel:c1"))).toBeNull();
    reload();
    expect(orphanedSends(key("channel:c1"))).toEqual([]);
  });

  it("orphan NOT landed ⇒ the words come back, before anything typed since", () => {
    stashPendingSend(key("channel:c1"), "msg-1", { text: "in flight" });
    reload();
    writeDraft(key("channel:c1"), { text: "typed after reload" });
    resolveOrphanedSend(key("channel:c1"), "msg-1", false);
    expect(readDraft(key("channel:c1"))?.text).toBe("in flight\n\ntyped after reload");
    reload();
    expect(orphanedSends(key("channel:c1"))).toEqual([]);
  });

  it("typing a new draft while a send is out does not erase the record of what was sent", () => {
    stashPendingSend(key("channel:c1"), "msg-1", { text: "sent words" });
    writeDraft(key("channel:c1"), { text: "new words" });
    flushDrafts();
    reload();
    expect(readDraft(key("channel:c1"))?.text).toBe("new words");
    expect(orphanedSends(key("channel:c1"))[0]?.value.text).toBe("sent words");
  });

  it("success does not wipe a NEW draft typed while the send was in flight", () => {
    const k = key("channel:c1");
    stashPendingSend(k, "msg-1", { text: "sent" });
    writeDraft(k, { text: "next one" });
    settlePendingSend("msg-1", true);
    expect(readDraft(k)?.text).toBe("next one");
  });
});

describe("bounds", () => {
  it("drops a draft untouched past the TTL", () => {
    writeDraft(key("channel:c1"), { text: "old" });
    flushDrafts();
    clock += DRAFT_TTL_MS + 1;
    reload();
    expect(readDraft(key("channel:c1"))).toBeNull();
  });

  it("keeps at most DRAFT_CAP, evicting the oldest", () => {
    for (let i = 0; i <= DRAFT_CAP; i++) {
      clock += 1;
      writeDraft(key(`channel:c${i}`), { text: `d${i}` });
      flushDrafts();
    }
    reload();
    expect(readDraft(key("channel:c0"))).toBeNull();
    expect(readDraft(key(`channel:c${DRAFT_CAP}`))?.text).toBe(`d${DRAFT_CAP}`);
  });

  it("drops a deleted channel's drafts, every composer's, and no other channel's", () => {
    writeDraft(key("channel:c1"), { text: "a" });
    writeDraft(key("agent:c1:abc"), { text: "b" });
    writeDraft(key("channel:c2"), { text: "c" });
    flushDrafts();
    clearDraftsForTarget("u-me", "c1");
    reload();
    expect(readDraft(key("channel:c1"))).toBeNull();
    expect(readDraft(key("agent:c1:abc"))).toBeNull();
    expect(readDraft(key("channel:c2"))?.text).toBe("c");
  });

  it("reads a malformed stored value as no draft", () => {
    const k = key("channel:c1") as string;
    localStorage.setItem(k, "{not json");
    reload();
    expect(readDraft(key("channel:c1"))).toBeNull();
  });
});

it("tells every subscriber on a key, so two composers stay in step", () => {
  const k = key("channel:c1");
  const a = vi.fn();
  const b = vi.fn();
  subscribeDraft(k, a);
  subscribeDraft(k, b);
  writeDraft(k, { text: "x" });
  expect(a).toHaveBeenCalled();
  expect(b).toHaveBeenCalled();
});
