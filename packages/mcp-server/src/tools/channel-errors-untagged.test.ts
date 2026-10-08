import { describe, expect, it } from "vitest";
import { classifyBadRequest } from "./channel-errors";

describe("CHANNEL_ADDRESSEE_UNTAGGED (2026-10-08)", () => {
  it("classifies as addressee_untagged, not as an unresolved recipient", () => {
    const e = { status: 400, apiCode: "CHANNEL_ADDRESSEE_UNTAGGED", code: "CHANNEL_ADDRESSEE_UNTAGGED", apiMessage: "Add @diana-taylor" };
    expect(classifyBadRequest(e)).toBe("addressee_untagged");
  });
});
