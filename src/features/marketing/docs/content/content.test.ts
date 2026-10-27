import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CAPABILITY_IDS,
  CAPABILITY_RISK_TIER,
  ContextProfileSchema,
  ERROR_CODE_INFO,
} from "@dopl/contracts/device-sdk";
import { describe, expect, it } from "vitest";

import { createDesktopAdapter } from "@/features/device-sdk/adapters/desktop";
import { createEvenG2Adapter } from "@/features/device-sdk/adapters/even-g2";

import { DOC_PAGES, DOC_TABS, DOCS_HOME, getDocPage, pageToMarkdown, statusOf, type NavLink } from "./index";
import { ERROR_ROWS } from "./pages-api";
import { CAPABILITY_ROWS } from "./pages-concepts";
import { DESKTOP_MATRIX, DEVICE_ROWS, G2_MATRIX } from "./pages-devices";
import { AR_GLASSES_PROFILE } from "./pages-routing";
import type { DocBlock, DocPage } from "./types";

/**
 * The docs truth pass (B1) and structure (B2): every page carries a status, nothing that is not
 * built reads as available, every `/v1` path in a sample exists in the frozen contract, and the
 * tables that restate the contracts or the built adapters agree with them. The status source is
 * `docs/specs/device-sdk/SPEC-v1.md` §4.
 */

/** Claims that are only true once the Device SDK ships. */
const UNBUILT = [
  /api\.usedopl\.com/,
  /\/v1\//,
  /pip install/,
  /npm install/,
  /@dopl\/(client|cli|sdk)/,
  /dopl notify/,
  /\bBearer\b/,
  /\bsk_(test|live)_/,
  /\burgency\b/,
  /Connect Dopl/,
  /falls? back/i,
  /skill\.md|llms\.txt/,
];

const OPENAPI = readFileSync(join(process.cwd(), "docs/specs/device-sdk/openapi.yaml"), "utf8");
/** Top-level keys under `paths:` (two-space indent), relative to the `/v1` server URL. */
const CONTRACT_PATHS = [...OPENAPI.matchAll(/^ {2}(\/\S+):\s*$/gm)].map((m) => m[1]);
const CONTRACT_RES = CONTRACT_PATHS.map(
  (p) => new RegExp(`^${p.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+")}$`)
);

function allLinks(links: NavLink[]): NavLink[] {
  return links.flatMap((l) => [l, ...allLinks(l.children ?? [])]);
}

/** Every code sample on a page: code blocks at any depth, plus the API aside. */
function codeOf(page: DocPage): string[] {
  const walk = (b: DocBlock): string[] => {
    switch (b.type) {
      case "code":
        return b.tabs.map((t) => t.code);
      case "steps":
        return b.items.flatMap((s) => s.blocks.flatMap(walk));
      case "list":
        return b.items.flatMap((it) => (typeof it === "string" ? [] : (it.blocks ?? []).flatMap(walk)));
      default:
        return [];
    }
  };
  const aside = page.aside ? [...page.aside.request, ...page.aside.responses].map((t) => t.code) : [];
  return [...page.blocks.flatMap(walk), ...aside];
}

/** Page copy as Markdown with fenced code removed. */
function prose(page: DocPage): string {
  return pageToMarkdown(page).replace(/```[\s\S]*?```/g, "");
}

const pathsIn = (text: string) => [...text.matchAll(/\/v1(\/[^\s'"`?)\\]+)/g)].map((m) => m[1]);

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

  it("marks the planned API reference, SDK and project MCP coming soon", () => {
    for (const page of DOC_PAGES.filter((p) => p.tab === "api")) {
      expect(page.status, page.slug).toBe("coming_soon");
    }
    for (const slug of ["quickstart", "sdks/typescript", "sdks/project-mcp"]) {
      expect(getDocPage(slug)?.status, slug).toBe("coming_soon");
    }
    for (const page of DOC_PAGES.filter((p) => /^(concepts|guides)\//.test(p.slug))) {
      expect(page.status, page.slug).toBe("coming_soon");
    }
  });

  it("matches the device rollout: G2 live, desktop beta, the rest coming soon", () => {
    expect(getDocPage("devices/even-realities-g2")?.status).toBe("live");
    expect(getDocPage("devices/desktop")?.status).toBe("beta");
    expect(getDocPage("sdks/hosted-mcp")?.status).toBe("live");
    for (const slug of ["meta", "mentra", "home-assistant", "google-home", "cars", "robots"]) {
      expect(getDocPage(`devices/${slug}`)?.status, slug).toBe("coming_soon");
    }
    for (const row of DEVICE_ROWS) expect(getDocPage(`devices/${row.slug}`)?.status, row.slug).toBe(row.status);
  });

  it("puts the status line in the copied Markdown", () => {
    expect(pageToMarkdown(getDocPage("pricing")!)).toContain("Status: Coming soon");
  });
});

describe("docs structure", () => {
  it("lands on the overview", () => {
    expect(getDocPage(DOCS_HOME)?.slug).toBe("overview");
  });

  it("points every sidebar row at a page, and lists every page", () => {
    const links = DOC_TABS.flatMap((t) => t.groups.flatMap((g) => allLinks(g.links)));
    for (const tab of DOC_TABS) expect(statusOf(tab.slug), tab.id).toBeDefined();
    for (const link of links) expect(statusOf(link.slug), link.slug).toBeDefined();
    const listed = new Set(links.map((l) => l.slug.split("#")[0]));
    for (const page of DOC_PAGES) expect(listed.has(page.slug), page.slug).toBe(true);
  });

  it("puts every page in the tab whose sidebar lists it", () => {
    for (const tab of DOC_TABS) {
      for (const link of tab.groups.flatMap((g) => allLinks(g.links))) {
        expect(getDocPage(link.slug.split("#")[0])?.tab, link.slug).toBe(tab.id);
      }
    }
  });

  it("links only to pages that exist", () => {
    for (const page of DOC_PAGES) {
      const md = pageToMarkdown(page);
      for (const m of md.matchAll(/\]\(\/docs\/([^)#\s]+)/g)) {
        expect(getDocPage(m[1]), `${page.slug} links to ${m[1]}`).toBeDefined();
      }
    }
  });
});

describe("docs copy", () => {
  it("writes no em or en dashes", () => {
    for (const page of DOC_PAGES) expect(pageToMarkdown(page), page.slug).not.toMatch(/[–—]/);
  });

  it("uses no spaced hyphen as punctuation in prose", () => {
    for (const page of DOC_PAGES) expect(prose(page), page.slug).not.toMatch(/\S - \S/);
  });
});

describe("docs against the frozen contracts", () => {
  it("reads the contract's paths", () => {
    expect(CONTRACT_PATHS).toContain("/users/{external_user_id}/deliver");
    expect(CONTRACT_PATHS.length).toBeGreaterThanOrEqual(9);
  });

  it("only uses /v1 paths that exist in openapi.yaml, in prose and in code", () => {
    let seen = 0;
    for (const page of DOC_PAGES) {
      for (const text of [pageToMarkdown(page), ...codeOf(page)]) {
        for (const path of pathsIn(text)) {
          seen += 1;
          expect(
            CONTRACT_RES.some((re) => re.test(path)),
            `${page.slug} uses /v1${path}, which is not in openapi.yaml`
          ).toBe(true);
        }
      }
    }
    expect(seen).toBeGreaterThan(10);
  });

  it("has an API reference page for every contract path", () => {
    const documented = DOC_PAGES.flatMap((p) => p.blocks.flatMap((b) => (b.type === "endpoint" ? [b.path] : [])));
    for (const path of CONTRACT_PATHS) expect(documented, path).toContain(`/v1${path}`);
    expect(documented.join(" ")).not.toMatch(/\/(show|ask|notify|endpoints)\b/);
  });

  it("states every capability's default tier as the contracts do", () => {
    const stated = CAPABILITY_ROWS.flatMap(([, ids, tier]) => ids.map((id) => [id, tier] as const));
    expect(stated.map(([id]) => id).sort()).toEqual([...CAPABILITY_IDS].sort());
    for (const [id, tier] of stated) expect(tier, id).toBe(CAPABILITY_RISK_TIER[id as keyof typeof CAPABILITY_RISK_TIER]);
  });

  it("lists every error code with its contract status, type and retry flag", () => {
    expect(ERROR_ROWS.map(([code]) => code).sort()).toEqual(Object.keys(ERROR_CODE_INFO).sort());
    for (const [code, status, type, retryable] of ERROR_ROWS) {
      const info = ERROR_CODE_INFO[code as keyof typeof ERROR_CODE_INFO];
      expect({ status, type, retryable }, code).toEqual({ status: info.status, type: info.type, retryable: info.retryable });
    }
  });

  it("shows a context profile the contract accepts", () => {
    expect(ContextProfileSchema.safeParse(AR_GLASSES_PROFILE).success).toBe(true);
  });

  it("matches the built adapters' capability matrices", () => {
    const pairs = (rows: [string, string, string][]) => rows.map(([cap, tier]) => [cap, tier]);
    const described = (a: ReturnType<typeof createEvenG2Adapter>) =>
      a.describe({} as never).map((d) => [d.capability, d.risk_tier]);
    expect(pairs(G2_MATRIX)).toEqual(described(createEvenG2Adapter()));
    expect(pairs(DESKTOP_MATRIX)).toEqual(described(createDesktopAdapter()));
  });
});
