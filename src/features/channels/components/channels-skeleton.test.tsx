import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChannelsSkeleton } from "./channels-skeleton";

/**
 * This file used to hand-roll its own `animate-pulse` + surface tints — one of
 * the two local clones `src/shared/ui/skeleton.tsx:5-7` and DESIGN-SYSTEM
 * forbid. The test that matters is therefore structural: every ghost here must
 * be the shared atom, so the two can never drift apart again.
 */
describe("ChannelsSkeleton", () => {
  const html = renderToStaticMarkup(<ChannelsSkeleton />);

  it("composes the shared kit — no local pulse recipe survives", () => {
    const ghosts = html.match(/data-slot="skeleton"/g) ?? [];
    const pulses = html.match(/animate-pulse/g) ?? [];
    expect(ghosts.length).toBeGreaterThan(0);
    expect(pulses.length).toBe(ghosts.length);
  });

  it("mirrors the loaded chrome: two panes inside the page-float", () => {
    expect(html).toContain("page-float");
    expect(html).toContain("border-r border-border-default");
    expect(html).toContain("h-[52px]");
  });

  it("ghosts a transcript in the detail pane, not a document", () => {
    // user turns indent right, exactly as the loaded thread renders them
    expect(html).toContain("ml-12");
    expect(html).toContain("max-w-[760px]");
  });

  it("announces itself rather than shimmering silently", () => {
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading channels");
  });
});
