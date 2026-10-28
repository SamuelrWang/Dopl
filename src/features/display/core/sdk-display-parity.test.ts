/**
 * Parity: the SDK's C6 mirror (`@dopl/device-contracts › display`) must equal the app's block
 * vocabulary v2 (`./types`). The SDK package is standalone and cannot import the app, so the
 * check lives here. Type-level mutual assignability is checked by `tsc` (root typecheck); the
 * runtime constants are compared below. Change one, change both, in the same commit.
 */
import { describe, expect, it } from "vitest";

import { DISPLAY_LIMITS, SDK_BLOCK_TYPES, V2_BLOCK_TYPES, type V2DisplayBlock } from "@dopl/device-contracts";

import { BLOCK_TYPES, DISPLAY_LIMITS as APP_DISPLAY_LIMITS, type DisplayBlock } from "./types";

type Assignable<A, B> = [A] extends [B] ? true : false;
const mirrorToApp: Assignable<V2DisplayBlock, DisplayBlock> = true;
const appToMirror: Assignable<DisplayBlock, V2DisplayBlock> = true;

describe("SDK C6 display mirror vs app block v2", () => {
  it("is structurally identical (types)", () => {
    expect(mirrorToApp && appToMirror).toBe(true);
  });

  it("block types and limits equal the app's", () => {
    expect([...V2_BLOCK_TYPES]).toEqual([...BLOCK_TYPES]);
    expect(DISPLAY_LIMITS).toEqual(APP_DISPLAY_LIMITS);
    expect(SDK_BLOCK_TYPES).toEqual([...BLOCK_TYPES, "image"]);
  });
});
