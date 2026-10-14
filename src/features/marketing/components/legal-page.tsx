import "@/features/marketing/marketing.css";
import "@/features/marketing/legal/legal.css";

import Link from "next/link";

import { LegalMarkdown } from "../legal/legal-markdown";
import type { LegalDoc } from "../legal/parse-legal-markdown";
import { Logo } from "./logo";

/** The two legal pages, in the order the top bar lists them. */
export const LEGAL_PAGES = [
  { href: "/services-agreement", label: "Services Agreement" },
  { href: "/privacy", label: "Privacy Policy" },
] as const;

export type LegalHref = (typeof LEGAL_PAGES)[number]["href"];

/**
 * Shared chrome for the static legal pages (`/services-agreement`, `/privacy`). Server
 * component. The body comes from `docs/legal/*.md` via `loadLegalDoc` — never hand-copied.
 *
 * ⚠ WHITE PAGE, NOT A WHITE CARD. The surface is `body.legal-active` (`legal.css`),
 * applied before first paint by `src/app/layout.tsx`'s inline script and kept by
 * `shared/layout/layout-shell.tsx › LayoutShell`, which also renders these routes bare
 * (no `mosaic-bg`, no `FlushGrid`, no dark `<main>`). Nothing blue sits underneath.
 */
export function LegalPage({ doc, current }: { doc: LegalDoc; current: LegalHref }) {
  return (
    <div className="legal">
      <header className="legal-bar">
        <div className="legal-bar-inner">
          <Logo />
          <nav aria-label="Legal" className="legal-bar-links">
            {LEGAL_PAGES.map((page) => (
              <Link
                key={page.href}
                href={page.href}
                aria-current={page.href === current ? "page" : undefined}
              >
                {page.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="legal-main">
        <article className="legal-doc">
          <h1>{doc.title}</h1>
          {doc.updated && <p className="legal-updated">Last updated: {doc.updated}</p>}

          {doc.sections.length > 0 && (
            <nav aria-label="Contents" className="legal-toc">
              <p className="legal-toc-title">Contents</p>
              <ol>
                {doc.sections.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`}>{section.text}</a>
                  </li>
                ))}
              </ol>
            </nav>
          )}

          <LegalMarkdown blocks={doc.blocks} />
        </article>
      </main>
    </div>
  );
}
