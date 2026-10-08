import { describe, expect, it } from "vitest";
import { HOME_MEMORY_EMPTY, homeMemory, homeScope, parseHomeMemory } from "./home-memory";

describe("home memory", () => {
  it("keeps a known tab and row", () => {
    expect(parseHomeMemory({ tab: "ontology", rowId: "rel:ws-1" })).toEqual({
      tab: "ontology",
      rowId: "rel:ws-1",
    });
  });

  it("🔒 reads an unknown tab as the default and a junk row as none", () => {
    expect(parseHomeMemory({ tab: "graph", rowId: 7 })).toEqual(HOME_MEMORY_EMPTY);
    expect(parseHomeMemory("ontology")).toBeNull();
  });

  it("is account-wide and per user", () => {
    homeMemory.write(homeScope("u1"), { tab: "knowledge", rowId: null });
    expect(homeMemory.read(homeScope("u1")).tab).toBe("knowledge");
    expect(homeMemory.read(homeScope("u2"))).toEqual(HOME_MEMORY_EMPTY);
    expect(homeMemory.storageKey(homeScope("u1"))).toBe("dopl.home.lastFace:u1:-");
  });
});
