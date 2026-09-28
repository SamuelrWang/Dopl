import { describe, expect, it } from "vitest";
import { evenG2 } from "./even-g2";
import { platformInfo } from "./info";
import { DEFAULT_PLATFORM, glassesPlatform } from "./registry";

describe("glasses platform registry", () => {
  it("dispatches a device's platform id to its implementation", () => {
    expect(glassesPlatform("even_g2")).toBe(evenG2);
    expect(glassesPlatform("even_g2").compileScreen({ blocks: [{ type: "text", content: "hi" }] }, "s1")).toMatchObject({
      ok: true,
      payload: { screen_id: "s1", nav_footer: { y: 248 } },
    });
  });

  it("falls back to the default platform for an unknown or missing id", () => {
    expect(DEFAULT_PLATFORM).toBe(evenG2);
    expect(glassesPlatform("meta_display")).toBe(DEFAULT_PLATFORM);
    expect(glassesPlatform(null)).toBe(DEFAULT_PLATFORM);
  });

  it("serves the same facts client-side as the server implementation", () => {
    expect(platformInfo("even_g2")).toMatchObject({ id: evenG2.id, label: evenG2.label, assistant: evenG2.assistant });
    expect(platformInfo("meta_display")).toBeNull();
  });

  it("routes platform-specific text rules through the implementation", () => {
    expect(glassesPlatform("even_g2").sanitizeText("“ok” — done \u{1F680}")).toBe('"ok" - done');
  });
});
