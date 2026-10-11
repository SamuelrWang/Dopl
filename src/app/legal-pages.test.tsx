// @vitest-environment jsdom
/**
 * /privacy and /terms — static legal pages, server-rendered for signed-out
 * visitors (both are PUBLIC_ROUTES). Pins what a reader gets: the back link,
 * the title + date, every numbered section in order, and the contact block.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import PrivacyPage, { metadata as privacyMeta } from "./privacy/page";
import TermsPage, { metadata as termsMeta } from "./terms/page";

function doc(markup: string): Document {
  return new DOMParser().parseFromString(markup, "text/html");
}

const PAGES = [
  {
    name: "privacy",
    Page: PrivacyPage,
    meta: privacyMeta,
    title: "Privacy Policy",
    contactLead: "If you have questions about this Privacy Policy or your data, contact us at:",
  },
  {
    name: "terms",
    Page: TermsPage,
    meta: termsMeta,
    title: "Terms of Service",
    contactLead: "If you have questions about these Terms, contact us at:",
  },
] as const;

describe.each(PAGES)("/$name", ({ Page, meta, title, contactLead }) => {
  const d = doc(renderToStaticMarkup(<Page />));

  it("titles the document and the page", () => {
    expect(meta.title).toBe(`${title} — Dopl Intelligence`);
    const h1s = d.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.textContent).toBe(title);
    expect(d.body.textContent).toContain("Last updated: April 2026");
  });

  it("links back to /login", () => {
    const back = Array.from(d.querySelectorAll("a")).find((a) =>
      a.textContent?.includes("Back"),
    );
    expect(back).toBeDefined();
    expect(back!.getAttribute("href")).toBe("/login");
  });

  it("numbers 13 sections, in order, each its own <section> with one h2", () => {
    const sections = Array.from(d.querySelectorAll("section"));
    expect(sections).toHaveLength(13);
    sections.forEach((section, i) => {
      const h2s = section.querySelectorAll("h2");
      expect(h2s).toHaveLength(1);
      expect(h2s[0]!.textContent?.trim()).toMatch(new RegExp(`^${i + 1}\\. \\S`));
    });
    expect(sections[12]!.querySelector("h2")!.textContent?.trim()).toBe("13. Contact");
  });

  it("ends with the contact block and a working mailto", () => {
    const contact = d.querySelectorAll("section")[12]!;
    expect(contact.textContent).toContain(contactLead);
    expect(contact.textContent).toContain("2603 California Street");
    const mail = contact.querySelector('a[href^="mailto:"]');
    expect(mail).not.toBeNull();
    expect(mail!.getAttribute("href")).toBe("mailto:build@usedopl.com");
  });
});

describe("cross-links", () => {
  it("terms points readers at the privacy policy", () => {
    const d = doc(renderToStaticMarkup(<TermsPage />));
    expect(d.querySelector('a[href="/privacy"]')).not.toBeNull();
  });
});
