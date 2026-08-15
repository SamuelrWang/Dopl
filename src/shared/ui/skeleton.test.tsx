import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DetailDocSkeleton,
  DetailPaneSkeleton,
  PageShellSkeleton,
  Skeleton,
  SkeletonRow,
  TranscriptSkeleton,
  TwoPaneListSkeleton,
} from "./skeleton";

/**
 * Two non-cosmetic properties: (1) ONE pulse recipe — every ghost comes out of
 * `Skeleton`, since hand-rolled clones drift to different surface tints;
 * (2) every loading surface ANNOUNCES itself — visuals are `aria-hidden`
 * shimmer, so without `aria-busy` + `sr-only` a screen reader gets silence.
 */

/** Every ghost block the kit emits, by its stable data-slot marker. */
function ghosts(html: string): string[] {
  return html.match(/data-slot="skeleton"[^>]*/g) ?? [];
}

describe("Skeleton atom", () => {
  it("is the one pulse recipe, and is hidden from the a11y tree", () => {
    const html = renderToStaticMarkup(<Skeleton />);
    expect(html).toContain("animate-pulse");
    expect(html).toContain("bg-surface-raised-2");
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("TwoPaneListSkeleton", () => {
  it("paints the elevated two-pane surface, not flat panels", () => {
    const html = renderToStaticMarkup(<TwoPaneListSkeleton />);
    expect(html).toContain("page-float");
    expect(html).toContain("border-r border-border-default");
    expect(html).toContain("max-w-[760px]");
  });

  it("announces itself with the caller's label", () => {
    const html = renderToStaticMarkup(<TwoPaneListSkeleton label="Loading members" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('<span class="sr-only">Loading members</span>');
  });

  it("renders the requested number of row ghosts", () => {
    const three = renderToStaticMarkup(<TwoPaneListSkeleton rows={3} />);
    const seven = renderToStaticMarkup(<TwoPaneListSkeleton rows={7} />);
    expect(ghosts(seven).length).toBeGreaterThan(ghosts(three).length);
  });

  it("takes a custom detail pane — channels loads a transcript, not a document", () => {
    const html = renderToStaticMarkup(
      <TwoPaneListSkeleton detail={<div id="mine" />} />
    );
    expect(html).toContain('id="mine"');
    expect(html).not.toContain("border-border-strong");
  });

  it("carries no hand-rolled pulse — every ghost is the shared atom", () => {
    const html = renderToStaticMarkup(<TwoPaneListSkeleton rows={4} />);
    const pulses = html.match(/animate-pulse/g) ?? [];
    expect(pulses.length).toBe(ghosts(html).length);
  });
});

describe("SkeletonRow", () => {
  it("drops the leading tile when asked, and shapes it otherwise", () => {
    expect(renderToStaticMarkup(<SkeletonRow leading="none" />)).toContain(
      "flex items-start"
    );
    expect(renderToStaticMarkup(<SkeletonRow leading="circle" />)).toContain(
      "rounded-full"
    );
    expect(renderToStaticMarkup(<SkeletonRow leading="square" />)).toContain(
      "rounded-md"
    );
  });
});

describe("TranscriptSkeleton", () => {
  it("alternates agent and user bubbles, mirroring the loaded list", () => {
    const html = renderToStaticMarkup(<TranscriptSkeleton bubbles={4} />);
    expect(html.match(/ml-12/g)).toHaveLength(2);
    expect(html.match(/bg-bg-elevated/g)).toHaveLength(2);
  });

  it("scales to the bubble count the caller knows about", () => {
    const two = renderToStaticMarkup(<TranscriptSkeleton bubbles={2} />);
    const five = renderToStaticMarkup(<TranscriptSkeleton bubbles={5} />);
    expect(ghosts(five).length).toBeGreaterThan(ghosts(two).length);
  });
});

describe("DetailPaneSkeleton", () => {
  it("keeps the shared 52px top bar and hosts the caller's body", () => {
    const html = renderToStaticMarkup(
      <DetailPaneSkeleton>
        <div id="body" />
      </DetailPaneSkeleton>
    );
    expect(html).toContain("h-[52px]");
    expect(html).toContain('id="body"');
  });

  it("is what the default document ghost is built from", () => {
    expect(renderToStaticMarkup(<DetailDocSkeleton />)).toContain("h-[52px]");
  });
});

describe("PageShellSkeleton", () => {
  it("is a shaped page surface, never a line of copy", () => {
    const html = renderToStaticMarkup(<PageShellSkeleton label="Loading skills" />);
    expect(html).toContain("page-float");
    expect(html).toContain("h-[52px]");
    expect(ghosts(html).length).toBeGreaterThan(5);
  });

  it("announces the label to a screen reader instead of painting it", () => {
    const html = renderToStaticMarkup(<PageShellSkeleton label="Starting Dopl" />);
    expect(html).toContain('<span class="sr-only">Starting Dopl</span>');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("text-caption text-text-muted");
  });
});
