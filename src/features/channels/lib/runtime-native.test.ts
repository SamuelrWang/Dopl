import { describe, expect, it } from "vitest";
import { effectiveNative, nativeDimensions } from "./runtime-native";
import { realDescriptor } from "./runtime-descriptors-harness";

// Mirrors main's `runtime/selection-vocabulary.js › normalizeNative`: an unrecognised containment value
// floors to the narrowest option; an absent one stays absent (the adapter's declared default applies).
describe("effectiveNative on a containment axis", () => {
  const sandbox = nativeDimensions(realDescriptor("codex"), null, null).find(
    (d) => d.kind === "containment"
  )!;

  it("absent resolves to the declared default", () => {
    expect(sandbox.default).toBeTruthy();
    expect(effectiveNative(sandbox, undefined)).toBe(sandbox.default);
    expect(effectiveNative(sandbox, "")).toBe(sandbox.default);
  });

  it("an unrecognised stored value falls to the narrowest option, never the default", () => {
    expect(sandbox.options[0].value).not.toBe(sandbox.default);
    expect(effectiveNative(sandbox, "workspace-read")).toBe(sandbox.options[0].value);
  });

  it("a recognised value is kept", () => {
    const last = sandbox.options[sandbox.options.length - 1].value;
    expect(effectiveNative(sandbox, last)).toBe(last);
  });
});
