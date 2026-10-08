// @vitest-environment jsdom
/** The one draft hook: navigate away and back, two composers on one page, no-user memory only. */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDraftStoreForTests,
  draftKey,
  flushDrafts,
  orphanedSends,
  stashPendingSend,
} from "../lib/draft-store";
import { usePersistentDraft } from "./use-persistent-draft";

const scope = { userId: "u-me", workspaceId: "ws-1" };

beforeEach(() => {
  localStorage.clear();
  __resetDraftStoreForTests();
});

describe("usePersistentDraft", () => {
  it("brings the draft back after navigating away (unmount) and back (remount)", () => {
    const first = renderHook(() => usePersistentDraft(scope, "channel:c1"));
    act(() => first.result.current.setText("unsent words"));
    first.unmount();
    const again = renderHook(() => usePersistentDraft(scope, "channel:c1"));
    expect(again.result.current.text).toBe("unsent words");
  });

  it("switching target shows each target's own draft", () => {
    const { result, rerender } = renderHook(({ t }) => usePersistentDraft(scope, t), {
      initialProps: { t: "channel:c1" },
    });
    act(() => result.current.setText("for one"));
    rerender({ t: "channel:c2" });
    expect(result.current.text).toBe("");
    act(() => result.current.setText("for two"));
    rerender({ t: "channel:c1" });
    expect(result.current.text).toBe("for one");
  });

  it("two composers on the same page: same key in step, different keys apart", () => {
    const a = renderHook(() => usePersistentDraft(scope, "channel:c1"));
    const b = renderHook(() => usePersistentDraft(scope, "channel:c1"));
    const c = renderHook(() => usePersistentDraft(scope, "agent:c1:x"));
    act(() => a.result.current.setText("shared"));
    expect(b.result.current.text).toBe("shared");
    expect(c.result.current.text).toBe("");
  });

  it("with no user it still holds text for the mount, and never writes storage", () => {
    const { result } = renderHook(() => usePersistentDraft({ userId: null }, "channel:c1"));
    act(() => result.current.setText("memory only"));
    expect(result.current.text).toBe("memory only");
    flushDrafts();
    expect(localStorage.length).toBe(0);
  });

  it("with no user, switching target does not carry text across", () => {
    const { result, rerender } = renderHook(({ t }) => usePersistentDraft({ userId: null }, t), {
      initialProps: { t: "agent:c1:a" },
    });
    act(() => result.current.setText("for A"));
    rerender({ t: "agent:c1:b" });
    expect(result.current.text).toBe("");
    rerender({ t: "agent:c1:a" });
    expect(result.current.text).toBe("for A");
  });

  it("clear empties it", () => {
    const { result } = renderHook(() => usePersistentDraft(scope, "channel:c1"));
    act(() => result.current.setText("x"));
    act(() => result.current.clear());
    expect(result.current.text).toBe("");
  });
});

// 🔒 A send a reload cut off is settled by ASKING the server (2026-10-08): landed ⇒ dropped,
// not landed ⇒ restored, could not ask ⇒ restored (words twice beat words lost).
describe("a send interrupted by a reload", () => {
  const interrupted = () => {
    stashPendingSend(draftKey(scope, "channel:c1"), "msg-1", { text: "in flight" });
    __resetDraftStoreForTests(); // the reload: memory gone, storage kept
  };

  it("LANDED: the words stay gone", async () => {
    interrupted();
    const verify = vi.fn(async () => true);
    const { result } = renderHook(() => usePersistentDraft(scope, "channel:c1", verify));
    await waitFor(() => expect(verify).toHaveBeenCalledWith("msg-1"));
    await waitFor(() => expect(orphanedSends(draftKey(scope, "channel:c1"))).toEqual([]));
    expect(result.current.text).toBe("");
  });

  it("NOT LANDED: the words come back", async () => {
    interrupted();
    const { result } = renderHook(() => usePersistentDraft(scope, "channel:c1", async () => false));
    await waitFor(() => expect(result.current.text).toBe("in flight"));
  });

  it("the CHECK FAILED: the words come back", async () => {
    interrupted();
    const { result } = renderHook(() =>
      usePersistentDraft(scope, "channel:c1", async () => {
        throw new Error("offline");
      })
    );
    await waitFor(() => expect(result.current.text).toBe("in flight"));
  });

  it("no way to ask (no verifier): the words come back", async () => {
    interrupted();
    const { result } = renderHook(() => usePersistentDraft(scope, "channel:c1"));
    await waitFor(() => expect(result.current.text).toBe("in flight"));
  });
});
