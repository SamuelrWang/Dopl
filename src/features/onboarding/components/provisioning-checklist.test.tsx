import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProvisioningChecklist } from "./provisioning-checklist";

describe("ProvisioningChecklist", () => {
  const html = renderToStaticMarkup(<ProvisioningChecklist />);

  it("names the real stages of the call it covers", () => {
    expect(html).toContain("Saving your setup");
    expect(html).toContain("Naming your workspace");
    expect(html).toContain("Opening Dopl");
  });

  it("does not spin", () => {
    expect(html).not.toContain("animate-spin");
  });

  it("starts with the first step active and nothing yet claimed done", () => {
    expect(html).not.toContain("<svg");
    expect(html.match(/animate-pulse/g)).toHaveLength(1);
  });

  it("announces progress instead of only animating it", () => {
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-busy="true"');
  });
});

describe("onboarding flow", () => {
  const source = readFileSync(
    new URL("./onboarding-flow-core.tsx", import.meta.url),
    "utf8"
  );

  it("no longer hand-rolls a spinner over the finish call", () => {
    expect(source).not.toContain("animate-spin");
  });

  it("renders the checklist while finishing", () => {
    expect(source).toContain("<ProvisioningChecklist />");
  });
});
