/**
 * Parity: the mirror in `display.ts` must equal the app's block vocabulary v2
 * (`src/features/display/core/types.ts`). Type-level mutual assignability is checked by `tsc`
 * (this file is in the package's typecheck); the runtime constants are compared here.
 */
import { describe, expect, it } from "vitest";

import {
  BLOCK_TYPES as APP_BLOCK_TYPES,
  DISPLAY_LIMITS as APP_DISPLAY_LIMITS,
  type DisplayBlock as AppDisplayBlock,
} from "../../../../src/features/display/core/types";
import {
  DISPLAY_LIMITS,
  DisplayBlockSchema,
  DisplayBlocksSchema,
  SDK_BLOCK_TYPES,
  V2_BLOCK_TYPES,
  type V2DisplayBlock,
} from "./display.js";
import { expectRoundTrip } from "./test-fixtures.js";

type Assignable<A, B> = [A] extends [B] ? true : false;
const mirrorToApp: Assignable<V2DisplayBlock, AppDisplayBlock> = true;
const appToMirror: Assignable<AppDisplayBlock, V2DisplayBlock> = true;

const SAMPLES: V2DisplayBlock[] = [
  { id: "h", type: "heading", text: "Today" },
  { id: "t", type: "text", content: "Line one\nLine two", tone: "muted", lines: 2, brightness: 3, border: true },
  { id: "f", type: "fields", rows: [{ label: "Where", value: "Room 4" }] },
  { id: "l", type: "list", items: ["a", "b"], style: "number" },
  { id: "c", type: "choice", options: [{ label: "Yes", recommended: true, why: "faster" }, { label: "No", description: "later" }] },
  { id: "p", type: "progress", value: 0.4, label: "Upload" },
  { id: "tb", type: "table", columns: ["k", "v"], rows: [["a", "1"]] },
  { id: "d", type: "divider" },
  { id: "s", type: "spacer", lines: 2 },
];

describe("C6 display mirror", () => {
  it("is structurally identical to the app's block v2 (types)", () => {
    expect(mirrorToApp && appToMirror).toBe(true);
  });

  it("block types and limits equal the app's", () => {
    expect([...V2_BLOCK_TYPES]).toEqual([...APP_BLOCK_TYPES]);
    expect(DISPLAY_LIMITS).toEqual(APP_DISPLAY_LIMITS);
    expect(SDK_BLOCK_TYPES).toEqual([...APP_BLOCK_TYPES, "image"]);
  });

  it("round-trips every block, image included", () => {
    for (const b of SAMPLES) expectRoundTrip(DisplayBlockSchema, b);
    expectRoundTrip(DisplayBlockSchema, { id: "i", type: "image", url: "https://cdn.example/x.png", alt: "Map", width: 200, height: 100 });
    expectRoundTrip(DisplayBlocksSchema, SAMPLES);
  });

  it("rejects a non-https image, a second choice and duplicate ids", () => {
    expect(DisplayBlockSchema.safeParse({ id: "i", type: "image", url: "http://x.example/a.png", alt: "a" }).success).toBe(false);
    expect(DisplayBlocksSchema.safeParse([SAMPLES[4], { ...SAMPLES[4], id: "c2" }]).success).toBe(false);
    expect(DisplayBlocksSchema.safeParse([SAMPLES[0], SAMPLES[0]]).success).toBe(false);
  });
});
