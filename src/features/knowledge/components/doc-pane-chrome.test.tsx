import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DocBodySkeleton } from "./doc-pane-chrome";

/**
 * The second of the two hand-rolled `animate-pulse` clones the kit forbids
 * (`src/shared/ui/skeleton.tsx:5-7`, DESIGN-SYSTEM "no local Bar clones").
 * It had already drifted — it tinted its bars `surface-raised-3` where the
 * kit uses `surface-raised-2`, so the knowledge body ghosted a shade darker
 * than every other skeleton in the app. That is the drift the rule exists to
 * prevent, and the reason this is pinned rather than left to review.
 */
describe("DocBodySkeleton", () => {
  const html = renderToStaticMarkup(<DocBodySkeleton />);

  it("is composed from the shared atom, at the shared tint", () => {
    const ghosts = html.match(/data-slot="skeleton"/g) ?? [];
    expect(ghosts.length).toBeGreaterThan(0);
    expect((html.match(/animate-pulse/g) ?? []).length).toBe(ghosts.length);
    expect(html).toContain("bg-surface-raised-2");
    expect(html).not.toContain("bg-surface-raised-3");
  });

  it("keeps the editor's geometry so the swap to real content doesn't reflow", () => {
    expect(html).toContain("max-w-3xl");
    expect(html).toContain("px-6");
  });

  it("keeps the 0%-width entries that read as paragraph breaks", () => {
    expect(html).toContain("width:0%");
  });

  it("announces itself instead of being hidden outright", () => {
    // It used to be `aria-hidden`, which left a screen reader with silence
    // where the body was about to appear.
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading document");
  });
});
