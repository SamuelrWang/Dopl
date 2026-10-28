// @vitest-environment jsdom
/**
 * /services-agreement and /privacy — static legal pages rendered from
 * `docs/legal/*.md` (the single source of truth), server-rendered for signed-out
 * visitors (both are PUBLIC_ROUTES). `/terms` is a 308 to `/services-agreement`.
 *
 * Pins: titles, one h1, every section/subsection/table/address of the .md in order,
 * the DRAFTING NOTE never rendered, contents links that resolve, the brand-only nav, the
 * white page (no `mosaic-bg`, no `FlushGrid`, no frame colour), and the redirect.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfig from "../../next.config";
import { parseLegalMarkdown } from "@/features/marketing/legal/parse-legal-markdown";

import PrivacyPage, { metadata as privacyMeta, dynamic as privacyDynamic } from "./privacy/page";
import ServicesAgreementPage, {
  metadata as agreementMeta,
  dynamic as agreementDynamic,
} from "./services-agreement/page";

const pathnameMock = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock.current }));
vi.mock("@/shared/design", () => ({ FlushGrid: () => <div data-testid="flush-grid" /> }));

const { LayoutShell } = await import("@/shared/layout/layout-shell");

function doc(markup: string): Document {
  return new DOMParser().parseFromString(markup, "text/html");
}

function source(file: string): string {
  return readFileSync(path.join(process.cwd(), "docs", "legal", file), "utf8");
}

function headings(md: string, hashes: "##" | "###"): string[] {
  const noComments = md.replace(/<!--[\s\S]*?-->/g, "");
  return noComments
    .split("\n")
    .filter((l) => l.startsWith(`${hashes} `))
    .map((l) => l.slice(hashes.length + 1).trim());
}

const PAGES = [
  {
    route: "/services-agreement",
    Page: ServicesAgreementPage,
    meta: agreementMeta,
    dynamic: agreementDynamic,
    file: "SERVICES-AGREEMENT.md",
    metaTitle: "Services Agreement — Dopl",
    h1: "Dopl Services Agreement",
  },
  {
    route: "/privacy",
    Page: PrivacyPage,
    meta: privacyMeta,
    dynamic: privacyDynamic,
    file: "PRIVACY.md",
    metaTitle: "Privacy Policy — Dopl",
    h1: "Dopl Privacy Policy",
  },
] as const;

describe.each(PAGES)("$route", ({ Page, meta, dynamic, file, metaTitle, h1 }) => {
  const md = source(file);
  const d = doc(renderToStaticMarkup(<Page />));
  const article = d.querySelector("article")!;

  it("titles the document and the page, and prerenders at build", () => {
    expect(meta.title).toBe(metaTitle);
    expect(dynamic).toBe("force-static");
    const h1s = d.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.textContent).toBe(h1);
    expect(d.querySelector(".legal-updated")!.textContent).toMatch(/^Last updated: \S/);
  });

  it("never renders the DRAFTING NOTE comment", () => {
    expect(md).toContain("DRAFTING NOTE");
    expect(d.body.textContent).not.toContain("DRAFTING NOTE");
    expect(d.body.textContent).not.toContain("<!--");
  });

  it("renders every ## section and ### subsection of the .md, in order", () => {
    const h2 = Array.from(article.querySelectorAll("h2")).map((h) => h.textContent);
    const h3 = Array.from(article.querySelectorAll("h3")).map((h) => h.textContent);
    expect(h2).toEqual(headings(md, "##"));
    expect(h3).toEqual(headings(md, "###"));
    expect(h2.length).toBeGreaterThan(15);
    expect(h2.at(-1)).toBe("Appendix 1 (Definitions)");
  });

  it("gives headings slug ids, and every contents link resolves", () => {
    expect(article.querySelector("h2")!.id).toMatch(/^1-[a-z-]+$/);
    const toc = Array.from(d.querySelectorAll('nav[aria-label="Contents"] a'));
    expect(toc.length).toBe(headings(md, "##").length);
    // One sidebar box beside the text: the contents nav sits in an <aside>, not the body.
    const nav = d.querySelector('nav[aria-label="Contents"]')!;
    expect(nav.parentElement!.matches("aside.legal-side")).toBe(true);
    expect(nav.closest(".legal-doc-body")).toBeNull();
    const ids = new Set(Array.from(d.querySelectorAll("[id]")).map((el) => el.id));
    expect(ids.size).toBe(d.querySelectorAll("[id]").length);
    for (const a of Array.from(d.querySelectorAll('a[href^="#"]'))) {
      expect(ids.has(a.getAttribute("href")!.slice(1))).toBe(true);
    }
  });

  it("renders tables, address blocks and no stray markdown", () => {
    const tables = (md.match(/^\|[-| :]+\|\s*$/gm) ?? []).length;
    expect(article.querySelectorAll(".legal-table-wrap > table")).toHaveLength(tables);
    expect(tables).toBeGreaterThan(0);
    expect(article.querySelectorAll("blockquote").length).toBeGreaterThan(0);
    const address = Array.from(article.querySelectorAll("blockquote")).at(-1)!;
    expect(address.querySelectorAll("p").length).toBeGreaterThan(3);
    expect(address.textContent).toContain("2603 California Street");
    expect(address.querySelector('a[href="mailto:build@usedopl.com"]')).not.toBeNull();
    expect(article.textContent).not.toMatch(/\*\*|^#|\n\|/);
    expect(article.querySelectorAll("strong").length).toBeGreaterThan(5);
    expect(article.querySelectorAll("p.legal-clause").length).toBeGreaterThan(5);
  });

  it("has the landing's brand-only nav: logo to `/`, no legal switcher", () => {
    const bar = d.querySelector("header.lp-nav")!;
    const logo = bar.querySelector(".lp-nav-left > a.lp-brand")!;
    expect(logo.getAttribute("href")).toBe("/");
    expect(logo.getAttribute("aria-label")).toBe("Dopl");
    expect(logo.querySelector(".lp-brand-word")!.textContent).toBe("Dopl");
    expect(bar.querySelectorAll("a")).toHaveLength(1);
    expect(bar.querySelector("nav")).toBeNull();
    expect(bar.querySelector('a[href="/services-agreement"], a[href="/privacy"]')).toBeNull();
    expect(d.querySelector("[aria-current]")).toBeNull();
    expect(d.querySelector('a[href="/login"]')).toBeNull();
  });
});

describe("content fidelity", () => {
  it("publishes no drafting markers on either page", () => {
    for (const Page of [PrivacyPage, ServicesAgreementPage]) {
      const text = doc(renderToStaticMarkup(<Page />)).body.textContent ?? "";
      expect(text).not.toContain("TODO");
      expect(text).not.toContain("DRAFTING NOTE");
    }
  });

  it("sets the all-caps warranty disclaimer as a notice", () => {
    const d = doc(renderToStaticMarkup(<ServicesAgreementPage />));
    const notice = d.querySelector("p.legal-notice")!;
    expect(notice.textContent).toMatch(/^THE SERVICES AND DOPL TECHNOLOGY ARE PROVIDED "AS IS"/);
  });

  it("refuses markdown it cannot render rather than printing it", () => {
    expect(() => parseLegalMarkdown("# T\n\n- a bullet")).toThrow(/unsupported/);
    expect(() => parseLegalMarkdown("# T\n\nSee [x](#y).")).toThrow(/unsupported/);
    expect(() => parseLegalMarkdown("# T\n\n#### Too deep")).toThrow(/deeper/);
  });
});

describe("/terms", () => {
  it("308s to /services-agreement", async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects).toContainEqual({
      source: "/terms",
      destination: "/services-agreement",
      permanent: true,
    });
  });
});

describe("the white page — no frame colour under the legal routes", () => {
  afterEach(() => {
    cleanup();
    document.body.className = "mosaic-bg";
    document.body.removeAttribute("style");
  });

  it.each(["/services-agreement", "/privacy"])("%s renders bare on legal-active", (p) => {
    pathnameMock.current = p;
    document.body.className = "mosaic-bg";
    const { container, queryByTestId } = render(
      <LayoutShell>
        <p>doc</p>
      </LayoutShell>,
    );
    expect(document.body.classList.contains("mosaic-bg")).toBe(false);
    expect(document.body.classList.contains("legal-active")).toBe(true);
    expect(document.body.style.backgroundColor).toBe("");
    expect(queryByTestId("flush-grid")).toBeNull();
    expect(container.querySelector("main")).toBeNull();
  });

  it("leaves the other routes' paint alone", () => {
    pathnameMock.current = "/login";
    const { queryByTestId } = render(
      <LayoutShell>
        <p>login</p>
      </LayoutShell>,
    );
    expect(document.body.classList.contains("mosaic-bg")).toBe(true);
    expect(document.body.classList.contains("legal-active")).toBe(false);
    expect(queryByTestId("flush-grid")).not.toBeNull();
  });

  it("strips mosaic-bg before first paint, and the class paints white", () => {
    const layout = readFileSync(path.join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toContain(
      // /docs shares the white legal ground since the docs site merged (2026-10-22).
      "p==='/services-agreement'||p==='/privacy'||p==='/docs'||p.indexOf('/docs/')===0){document.body.classList.remove('mosaic-bg');document.body.classList.add('legal-active');",
    );
    const css = readFileSync(
      path.join(process.cwd(), "src/features/marketing/legal/legal.css"),
      "utf8",
    );
    const rule = /body\.legal-active\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toMatch(/--body-bg:\s*#ffffff/);
    expect(rule).toMatch(/background-color:\s*#ffffff/);
  });
});
