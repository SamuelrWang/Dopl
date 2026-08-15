import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DocBodySkeleton } from "./doc-pane-chrome";

/**
 * ⚠ No local `animate-pulse` Bar clones (src/shared/ui/skeleton.tsx,
 * DESIGN-SYSTEM). The clone this replaced had already drifted to
 * `surface-raised-3` where the kit uses `surface-raised-2`, ghosting the
 * knowledge body a shade darker than every other skeleton. Hence pinned.
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
    // ⚠ Not `aria-hidden`: that leaves a screen reader silent where the body
    // is about to appear.
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading document");
  });
});
