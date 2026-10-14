import "@/features/marketing/marketing.css";
import "@/features/marketing/legal/legal.css";

import { LegalMarkdown } from "../legal/legal-markdown";
import type { LegalDoc } from "../legal/parse-legal-markdown";
import { Logo } from "./logo";

/**
 * Shared chrome for the static legal pages (`/services-agreement`, `/privacy`). Server
 * component. The body comes from `docs/legal/*.md` via `loadLegalDoc` — never hand-copied.
 *
 * ⚠ WHITE PAGE, NOT A WHITE CARD. The surface is `body.legal-active` (`legal.css`),
 * applied before first paint by `src/app/layout.tsx`'s inline script and kept by
 * `shared/layout/layout-shell.tsx › LayoutShell`, which also renders these routes bare
 * (no `mosaic-bg`, no `FlushGrid`, no dark `<main>`). Nothing blue sits underneath.
 */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <div className="legal">
      {/* The landing/pricing nav's brand block — same `.lp-nav` / `.lp-nav-left` classes and
          `<Logo />`, so the mark + wordmark sit in the top-left exactly as on every other
          marketing page. Only the brand: the legal pages carry no links, CTA, search or menu. */}
      <header className="lp-nav">
        <div className="lp-nav-left">
          <Logo />
        </div>
      </header>

      <main className="legal-main">
        <article className="legal-doc">
          <div className="legal-doc-head">
            <h1>{doc.title}</h1>
            {doc.updated && <p className="legal-updated">Last updated: {doc.updated}</p>}
          </div>

          {/* Desktop: a sticky sidebar to the right of the text. Narrow: sits under the title. */}
          {doc.sections.length > 0 && (
            <aside className="legal-side">
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
            </aside>
          )}

          <div className="legal-doc-body">
            <LegalMarkdown blocks={doc.blocks} />
          </div>
        </article>
      </main>
    </div>
  );
}
