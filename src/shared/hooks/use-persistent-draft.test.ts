// @vitest-environment jsdom
/** The one draft hook: navigate away and back, two composers on one page, no-user memory only. */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetDraftStoreForTests, flushDrafts } from "../lib/draft-store";
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
