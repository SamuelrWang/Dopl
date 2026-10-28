import { describe, expect, it } from "vitest";

import { ContextProfileSchema, DeviceContextSchema, POSTURES, ProfileOverflowSchema } from "./context.js";
import { expectRoundTrip } from "./test-fixtures.js";

const PROFILE = {
  id: "my-glasses",
  match: { kind: "glasses" as const },
  prompt_append: "User is on AI glasses, likely on the move. Reply in ≤5 short plain lines.",
  output: { max_lines: 5, max_chars: 300, format: "plain" as const, markdown: false },
  allowed_capabilities: ["present.*", "ask.*"] as ("present.*" | "ask.*")[],
  display_template: "tpl_brief_card",
  confirmation: { T3: "on_device" as const, T4: "deny" as const },
  overflow: "truncate" as const,
};

describe("C5 context", () => {
  it("posture is the spec's five", () => {
    expect(POSTURES).toEqual(["glanceable", "hands_free", "seated", "driving", "unknown"]);
  });

  it("round-trips the spec's profile example and each overflow form", () => {
    expectRoundTrip(ContextProfileSchema, PROFILE);
    expectRoundTrip(ContextProfileSchema, { ...PROFILE, overflow: { send_to: "phone" } });
    expectRoundTrip(ContextProfileSchema, { ...PROFILE, overflow: "callback", version: 3 });
  });

  it("D3: rejects every rewrite form of overflow", () => {
    for (const bad of ["rewrite", "summarize", { rewrite: true }, { send_to: "phone", rewrite: true }]) {
      expect(ProfileOverflowSchema.safeParse(bad).success).toBe(false);
      expect(ContextProfileSchema.safeParse({ ...PROFILE, overflow: bad }).success).toBe(false);
    }
    expect(ContextProfileSchema.safeParse({ ...PROFILE, rewrite: true }).success).toBe(false);
  });

  it("T4 cannot be confirmation-free; match needs a key", () => {
    expect(ContextProfileSchema.safeParse({ ...PROFILE, confirmation: { T4: "none" } }).success).toBe(false);
    expect(ContextProfileSchema.safeParse({ ...PROFILE, match: {} }).success).toBe(false);
  });

  it("round-trips the context object", () => {
    expectRoundTrip(DeviceContextSchema, {
      active_device: { id: "dev_123", kind: "glasses", model: "even_g2", last_seen_s: 4 },
      posture: "glanceable",
      available: [{ kind: "glasses", id: "dev_123", capabilities: ["present.display", "ask.choice"] }],
      profile: { id: "glasses-default", prompt_append: "Be brief.", output: { max_lines: 5 } },
      source_of_last_message: "glasses",
    });
    expectRoundTrip(DeviceContextSchema, {
      active_device: null,
      posture: "unknown",
      available: [],
      profile: null,
      source_of_last_message: null,
    });
  });
});
