import { describe, expect, it } from "vitest";
import { classifyBadRequest, decisionDraftArgs } from "./channel-errors";

const err = (details: unknown) => ({ status: 400, apiCode: "CHANNEL_DECISION_REQUIRED", code: "CHANNEL_DECISION_REQUIRED", apiMessage: "x", details });
const DRAFT = { summary: "Which do you want?", options: [{ label: "A", consequence: "a" }, { label: "B", consequence: "b" }] };

describe("CHANNEL_DECISION_REQUIRED (2026-10-08)", () => {
  it("classifies as decision_required", () => {
    expect(classifyBadRequest(err({ draft: DRAFT }))).toBe("decision_required");
  });

  it("renders the draft as resend JSON", () => {
    expect(JSON.parse(decisionDraftArgs(err({ draft: DRAFT })))).toEqual(DRAFT);
  });

  it.each([undefined, {}, { draft: null }, { draft: { summary: 1, options: [] } }, { draft: { summary: "q", options: [{ label: "A", consequence: "a" }] } }])(
    "malformed details render nothing: %j",
    (details) => expect(decisionDraftArgs(err(details))).toBe(""),
  );
});
