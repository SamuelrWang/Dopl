// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_VALUE_BYTES,
  boundRecord,
  definePersistedState,
  omitKey,
} from "./persisted-ui-state";

interface Pick {
  id: string | null;
}

const decode = vi.fn((raw: unknown, fromVersion: number): Pick | null => {
  if (fromVersion === 0) return typeof raw === "string" ? { id: raw } : null;
  const v = raw as { id?: unknown };
  return v && typeof v.id === "string" ? { id: v.id } : null;
});

const state = definePersistedState<Pick>({
  name: "test.pick",
  version: 2,
  fallback: { id: null },
  decode,
  isEmpty: (v) => v.id === null,
});
const drafts = definePersistedState<Pick>({
  name: "test.draft",
  version: 1,
  fallback: { id: null },
  decode: (raw) => raw as Pick,
  requireUser: true,
});

const A = { userId: "u1", workspaceId: "w1" };

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  decode.mockClear();
});

describe("persisted-ui-state", () => {
  it("round-trips a value under a scoped, enveloped key", () => {
    state.write(A, { id: "x" });
    expect(state.read(A)).toEqual({ id: "x" });
    expect(JSON.parse(window.localStorage.getItem("dopl.test.pick:u1:w1")!)).toEqual({
      v: 2,
      d: { id: "x" },
    });
  });

  it("🔒 scopes by user, workspace and sub-key; account-wide is its own bucket", () => {
    state.write(A, { id: "x" });
    expect(state.read({ userId: "u2", workspaceId: "w1" }).id).toBeNull();
    expect(state.read({ userId: "u1", workspaceId: "w2" }).id).toBeNull();
    expect(state.read({ ...A, key: "t1" }).id).toBeNull();
    expect(state.read({ userId: "u1", workspaceId: null }).id).toBeNull();
    expect(state.storageKey({ userId: undefined, workspaceId: null, key: "a:b" })).toBe(
      "dopl.test.pick:anon:-:a_b"
    );
  });

  it("hands a pre-envelope value to decode at version 0", () => {
    window.localStorage.setItem("dopl.test.pick:u1:w1", "legacy-id");
    expect(state.read(A)).toEqual({ id: "legacy-id" });
    expect(decode).toHaveBeenCalledWith("legacy-id", 0);
  });

  it("hands an older envelope its version so decode can migrate", () => {
    window.localStorage.setItem("dopl.test.pick:u1:w1", JSON.stringify({ v: 1, d: { id: "o" } }));
    expect(state.read(A)).toEqual({ id: "o" });
    expect(decode).toHaveBeenCalledWith({ id: "o" }, 1);
  });

  it("🔒 reads a NEWER build's value as fallback, never guessing its shape", () => {
    window.localStorage.setItem("dopl.test.pick:u1:w1", JSON.stringify({ v: 3, d: { id: "n" } }));
    expect(state.read(A)).toEqual({ id: null });
  });

  it("🔒 malformed, rejected or throwing decode reads as fallback", () => {
    window.localStorage.setItem("dopl.test.pick:u1:w1", JSON.stringify({ v: 2, d: 5 }));
    expect(state.read(A)).toEqual({ id: null });
    decode.mockImplementationOnce(() => {
      throw new Error("bad");
    });
    window.localStorage.setItem("dopl.test.pick:u1:w1", JSON.stringify({ v: 2, d: { id: "x" } }));
    expect(state.read(A)).toEqual({ id: null });
  });

  it("🔒 never throws when storage refuses", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(state.read(A)).toEqual({ id: null });
    expect(() => state.write(A, { id: "x" })).not.toThrow();
    expect(() => state.update(A, () => ({ id: "y" }))).not.toThrow();
    expect(() => state.clear(A)).not.toThrow();
  });

  it("removes the key for an empty value; skips an oversize one", () => {
    state.write(A, { id: "x" });
    state.write(A, { id: null });
    expect(window.localStorage.getItem("dopl.test.pick:u1:w1")).toBeNull();
    state.write(A, { id: "y".repeat(MAX_VALUE_BYTES) });
    expect(window.localStorage.getItem("dopl.test.pick:u1:w1")).toBeNull();
  });

  it("update skips the write when the change returns the same object", () => {
    const set = vi.spyOn(Storage.prototype, "setItem");
    state.update(A, (v) => v);
    expect(set).not.toHaveBeenCalled();
  });

  it("enumerates one user's keys of one name, per workspace or all", () => {
    state.write(A, { id: "1" });
    state.write({ ...A, key: "t" }, { id: "2" });
    state.write({ userId: "u1", workspaceId: "w2" }, { id: "3" });
    state.write({ userId: "u2", workspaceId: "w1" }, { id: "4" });
    window.localStorage.setItem("dopl.test.pickle:u1:w1", "other name");
    expect(state.keys({ userId: "u1", workspaceId: "w1" }).sort()).toEqual([
      "dopl.test.pick:u1:w1",
      "dopl.test.pick:u1:w1:t",
    ]);
    expect(state.keys({ userId: "u1" })).toHaveLength(3);
    const k = state.keys({ userId: "u1", workspaceId: "w2" })[0]!;
    expect(state.readKey(k)).toEqual({ id: "3" });
    state.removeKey(k);
    expect(state.keys({ userId: "u1" })).toHaveLength(2);
  });

  it("🔒 requireUser: no user ⇒ nothing read, written or listed", () => {
    const anon = { userId: undefined, workspaceId: "w1" };
    window.localStorage.setItem("dopl.test.draft:anon:w1", JSON.stringify({ v: 1, d: { id: "s" } }));
    expect(drafts.read(anon)).toEqual({ id: null });
    drafts.write({ ...anon, key: "x" }, { id: "typed" });
    expect(window.localStorage.getItem("dopl.test.draft:anon:w1:x")).toBeNull();
    expect(drafts.keys({ userId: undefined })).toEqual([]);
    drafts.write(A, { id: "ok" });
    expect(drafts.read(A)).toEqual({ id: "ok" });
  });

  it("boundRecord keeps the newest entries; omitKey drops one", () => {
    expect(boundRecord({ a: 1, b: 2, c: 3 }, 2)).toEqual({ b: 2, c: 3 });
    expect(boundRecord({ a: 1 }, 2)).toEqual({ a: 1 });
    expect(omitKey({ a: 1, b: 2 }, "a")).toEqual({ b: 2 });
  });
});
