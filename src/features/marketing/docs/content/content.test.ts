import { describe, expect, it } from "vitest";

import { DOC_PAGES, DOC_TABS, getDocPage, pageToMarkdown, statusOf, type NavLink } from "./index";

/**
 * The docs truth pass (B1): every page carries a status, and nothing that is not built reads
 * as available. The status source is `docs/specs/device-sdk/SPEC-v1.md` §4.
 */

/** Claims that are only true once the Device SDK ships. */
const UNBUILT = [
  /api\.usedopl\.com/,
  /pip install/,
  /npm install/,
  /@dopl\/(client|cli)/,
  /dopl notify/,
  /\bBearer\b/,
  /\bsk_(test|live)_/,
  /\burgency\b/,
  /Connect Dopl/,
  /falls? back/i,
  /skill\.md|llms\.txt/,
];

function allLinks(links: NavLink[]): NavLink[] {
  return links.flatMap((l) => [l, ...allLinks(l.children ?? [])]);
}

describe("docs content status", () => {
  it("gives every page a known status", () => {
    for (const page of DOC_PAGES) {
      expect(["live", "beta", "coming_soon"], page.slug).toContain(page.status);
    }
  });

  it("never lets a live or beta page describe the unbuilt SDK as available", () => {
    for (const page of DOC_PAGES.filter((p) => p.status !== "coming_soon")) {
      const md = pageToMarkdown(page);
      for (const pattern of UNBUILT) expect(md, `${page.slug} matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it("marks the planned API reference coming soon", () => {
    for (const page of DOC_PAGES.filter((p) => p.tab === "api")) {
      expect(page.status, page.slug).toBe("coming_soon");
    }
  });

  it("matches the device rollout: G2 live, desktop beta, the rest coming soon", () => {
    expect(getDocPage("devices/even-realities-g2")?.status).toBe("live");
    expect(getDocPage("devices/desktop")?.status).toBe("beta");
    for (const slug of ["phone-push", "mac-notch", "apple-watch", "cars", "meta-ray-ban", "robots"]) {
      expect(getDocPage(`devices/${slug}`)?.status, slug).toBe("coming_soon");
    }
  });

  it("uses the frozen contract paths on the API reference", () => {
    const paths = DOC_PAGES.flatMap((p) => p.blocks.flatMap((b) => (b.type === "endpoint" ? [b.path] : [])));
    expect(paths).toEqual(
      expect.arrayContaining([
        "/v1/users/{external_user_id}/deliver",
        "/v1/devices/{device_id}/actions/{capability}",
        "/v1/connect_sessions",
      ])
    );
    expect(paths.join(" ")).not.toMatch(/\/(show|ask|notify|endpoints)\b/);
  });

  it("writes no em or en dashes in page copy", () => {
    for (const page of DOC_PAGES) expect(pageToMarkdown(page), page.slug).not.toMatch(/[–—]/);
  });

  it("points every sidebar row at a page, and lists every page", () => {
    const links = DOC_TABS.flatMap((t) => t.groups.flatMap((g) => allLinks(g.links)));
    for (const link of links) expect(statusOf(link.slug), link.slug).toBeDefined();
    const listed = new Set(links.map((l) => l.slug.split("#")[0]));
    for (const page of DOC_PAGES) expect(listed.has(page.slug), page.slug).toBe(true);
  });

  it("puts the status line in the copied Markdown", () => {
    expect(pageToMarkdown(getDocPage("pricing")!)).toContain("Status: Coming soon");
  });
});
