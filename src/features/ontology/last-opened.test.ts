// @vitest-environment jsdom
/**
 * THE LAST-OPENED STORE'S RULES, tested where they are pure. The view's
 * PRECEDENCE (click › address bar › memory › first) and the dangling-key sweep
 * are `components/ontology-view.tsx`; what is tested here is the key's scoping
 * and that no storage failure ever becomes an error state.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_REMEMBERED_OBJECTS,
  clearLastOpened,
  forgetOntology,
  parseMemory,
  readLastOpened,
  readMemory,
  writeFace,
  writeLastOpened,
  writeSelectedObject,
} from "./last-opened";

const USER = "user-1";
const OTHER_USER = "user-2";
const WS = "ws-1";
const OTHER_WS = "ws-2";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("the last-opened store", () => {
  it("remembers an ontology and hands the same id back", () => {
    writeLastOpened(USER, WS, "ont-a");
    expect(readLastOpened(USER, WS)).toBe("ont-a");
  });

  it("has no memory before anything is written", () => {
    expect(readLastOpened(USER, WS)).toBeNull();
  });

  it("🔒 scopes per USER — one machine holds more than one account", () => {
    // The whole reason the key carries an id: a previous operator's open board is
    // theirs, and must not greet the next person who signs in on this machine.
    writeLastOpened(USER, WS, "ont-a");
    expect(readLastOpened(OTHER_USER, WS)).toBeNull();
    expect(readLastOpened(USER, WS)).toBe("ont-a");
  });

  it("🔒 scopes per WORKSPACE — a board id from another one names nothing", () => {
    writeLastOpened(USER, WS, "ont-a");
    expect(readLastOpened(USER, OTHER_WS)).toBeNull();
  });

  it("🔒 keeps the two scopes independent, so neither bleeds", () => {
    writeLastOpened(USER, WS, "ont-a");
    writeLastOpened(USER, OTHER_WS, "ont-b");
    writeLastOpened(OTHER_USER, WS, "ont-c");
    expect(readLastOpened(USER, WS)).toBe("ont-a");
    expect(readLastOpened(USER, OTHER_WS)).toBe("ont-b");
    expect(readLastOpened(OTHER_USER, WS)).toBe("ont-c");
  });

  it("buckets a missing user id under `anon` rather than colliding with a real one", () => {
    writeLastOpened(undefined, WS, "ont-anon");
    expect(readLastOpened(undefined, WS)).toBe("ont-anon");
    expect(readLastOpened(USER, WS)).toBeNull();
  });

  it("overwrites rather than accumulating — one open board at a time", () => {
    writeLastOpened(USER, WS, "ont-a");
    writeLastOpened(USER, WS, "ont-b");
    expect(readLastOpened(USER, WS)).toBe("ont-b");
  });

  it("forgets the pair on clear, and leaves every other pair alone", () => {
    writeLastOpened(USER, WS, "ont-a");
    writeLastOpened(USER, OTHER_WS, "ont-b");
    clearLastOpened(USER, WS);
    expect(readLastOpened(USER, WS)).toBeNull();
    expect(readLastOpened(USER, OTHER_WS)).toBe("ont-b");
  });

  it("treats a stored empty string as corrupt, not as a selection", () => {
    // Nothing in the app writes "" — a hand-edited or truncated value must read
    // as "no memory", so the caller falls through to its default.
    window.localStorage.setItem(`dopl.ontology.lastOpened:${USER}:${WS}`, "");
    expect(readLastOpened(USER, WS)).toBeNull();
  });

  it("🔒 reads null instead of throwing when storage refuses", () => {
    // Private window, or site data blocked. Remembering is a convenience.
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => readLastOpened(USER, WS)).not.toThrow();
    expect(readLastOpened(USER, WS)).toBeNull();
  });

  it("🔒 swallows a refused write — failing to remember is not an error state", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeLastOpened(USER, WS, "ont-a")).not.toThrow();
  });

  it("🔒 swallows a refused clear", () => {
    vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => clearLastOpened(USER, WS)).not.toThrow();
  });
});

describe("the last-opened store — face and object panel", () => {
  it("remembers face and per-ontology object alongside the ontology", () => {
    writeLastOpened(USER, WS, "ont-a");
    writeFace(USER, WS, "changelog");
    writeSelectedObject(USER, WS, "ont-a", "obj-1");
    writeSelectedObject(USER, WS, "ont-b", "obj-2");
    expect(readMemory(USER, WS)).toEqual({
      ontologyId: "ont-a",
      face: "changelog",
      objects: { "ont-a": "obj-1", "ont-b": "obj-2" },
    });
  });

  it("switching ontology keeps every other ontology's object", () => {
    writeSelectedObject(USER, WS, "ont-a", "obj-1");
    writeLastOpened(USER, WS, "ont-b");
    expect(readMemory(USER, WS).objects["ont-a"]).toBe("obj-1");
  });

  it("a closed panel (null) forgets that ontology's object only", () => {
    writeSelectedObject(USER, WS, "ont-a", "obj-1");
    writeSelectedObject(USER, WS, "ont-b", "obj-2");
    writeSelectedObject(USER, WS, "ont-a", null);
    expect(readMemory(USER, WS).objects).toEqual({ "ont-b": "obj-2" });
  });

  it("forgetOntology drops the id and its object, keeps the face", () => {
    writeLastOpened(USER, WS, "ont-a");
    writeFace(USER, WS, "changelog");
    writeSelectedObject(USER, WS, "ont-a", "obj-1");
    forgetOntology(USER, WS, "ont-a");
    expect(readMemory(USER, WS)).toEqual({ ontologyId: null, face: "changelog", objects: {} });
  });

  it("bounds remembered objects, dropping the least recently touched", () => {
    for (let i = 0; i < MAX_REMEMBERED_OBJECTS + 5; i++) {
      writeSelectedObject(USER, WS, `ont-${i}`, `obj-${i}`);
    }
    const objects = readMemory(USER, WS).objects;
    expect(Object.keys(objects)).toHaveLength(MAX_REMEMBERED_OBJECTS);
    expect(objects["ont-0"]).toBeUndefined();
    expect(objects[`ont-${MAX_REMEMBERED_OBJECTS + 4}`]).toBe(`obj-${MAX_REMEMBERED_OBJECTS + 4}`);
  });

  it("reads the first build's bare-id value as the ontology", () => {
    expect(parseMemory("ont-a")).toEqual({ ontologyId: "ont-a", face: "board", objects: {} });
  });

  it("🔒 reads malformed JSON and wrong-typed fields as no memory, never throws", () => {
    expect(parseMemory("{not json")).toEqual({ ontologyId: null, face: "board", objects: {} });
    expect(
      parseMemory(JSON.stringify({ ontologyId: 7, face: "graph", objects: { a: 1, b: "x" } }))
    ).toEqual({ ontologyId: null, face: "board", objects: { b: "x" } });
  });

  it("removes the key once nothing is left to remember", () => {
    writeLastOpened(USER, WS, "ont-a");
    forgetOntology(USER, WS, "ont-a");
    expect(window.localStorage.getItem(`dopl.ontology.lastOpened:${USER}:${WS}`)).toBeNull();
  });
});

