import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProvisioningChecklist } from "./provisioning-checklist";

/**
 * One of the repo's four real spinners: a hand-rolled 28px `animate-spin`
 * ring held over the multi-second `POST /api/onboarding/complete` call, i.e.
 * over the LAST thing a new user waits on before seeing the product. It is a
 * stepped checklist now (LAUNCH-READINESS-ROADMAP §5 offers exactly that or a
 * destination skeleton).
 */

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
    // The tick mark only renders for completed steps.
    expect(html).not.toContain("<svg");
    // The active marker is the pulse dot the connect step already uses for
    // "Waiting for your agent…" — a status indicator, not a spinner.
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
