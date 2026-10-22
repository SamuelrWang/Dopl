import "@/features/marketing/marketing.css";
import "@/features/marketing/docs/docs.css";

import { AlignLeft, ChevronLeft, ChevronRight, Menu } from "lucide-react";
import Link from "next/link";

import {
  DOC_PAGES,
  DOC_TABS,
  docHref,
  getDocTab,
  neighbours,
  pageToMarkdown,
  tableOfContents,
  type DocPage,
} from "../content";
import { DocBlocks } from "./docs-blocks";
import { DocsHeader } from "./docs-header";
import { AskBar, CodeGroup, CopyPageButton, PageFeedback } from "./docs-interactive";
import { DocsSidebar } from "./docs-sidebar";
import { SocialLinks } from "./social-links";

const SITE = "https://www.usedopl.com";

/**
 * One docs page: header (brand, search, tabs), the tab's sidebar, the article, and either
 * "On this page" or — on an API Reference page — the sticky request/response column.
 *
 * ⚠ WHITE PAGE, LIKE THE LEGAL PAGES: `body.legal-active` (set before first paint by
 * `src/app/layout.tsx` and kept by `shared/layout/layout-shell.tsx`) — never the frame colour.
 */
export function DocsPage({ page }: { page: DocPage }) {
  const tab = getDocTab(page);
  const toc = page.aside ? [] : tableOfContents(page);
  const { prev, next } = neighbours(page);
  const headerTabs = DOC_TABS.map((t) => ({
    label: t.label,
    href: docHref(t.slug),
    active: t.id === tab.id,
  }));
  const entries = DOC_PAGES.map((p) => ({ title: p.title, group: p.group, href: docHref(p.slug) }));

  return (
    <div className="lp docs">
      <DocsHeader tabs={headerTabs} entries={entries} />

      <div className="docs-body">
        <aside className="docs-sidebar" aria-label="Docs navigation">
          <DocsSidebar tab={tab} slug={page.slug} />
        </aside>

        <div className="docs-main" data-layout={page.aside ? "api" : "guide"}>
          <div className="docs-column">
            <details className="docs-mobile-nav">
              <summary>
                <Menu size={16} aria-hidden />
                <span>{page.group}</span>
              </summary>
              <DocsSidebar tab={tab} slug={page.slug} />
            </details>

            <header className="docs-page-head">
              <p className="lp-ctl-eyebrow docs-eyebrow">{page.group}</p>
              <div className="docs-title-row">
                <h1>{page.title}</h1>
                <CopyPageButton markdown={pageToMarkdown(page)} url={`${SITE}${docHref(page.slug)}`} />
              </div>
              {page.description && <p className="docs-subtitle">{page.description}</p>}
            </header>

            <article className="docs-prose">
              <DocBlocks blocks={page.blocks} />
            </article>

            {page.aside && (
              <div className="docs-aside-inline">
                <CodeGroup tabs={page.aside.request} />
                <CodeGroup tabs={page.aside.responses} />
              </div>
            )}

            <PageFeedback />

            <nav className="docs-pager" aria-label="Previous and next page">
              {prev ? (
                <Link href={docHref(prev.slug)} className="docs-pager-link">
                  <ChevronLeft size={14} aria-hidden />
                  {prev.label}
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link href={docHref(next.slug)} className="docs-pager-link">
                  {next.label}
                  <ChevronRight size={14} aria-hidden />
                </Link>
              )}
            </nav>

            <footer className="docs-footer">
              <SocialLinks />
            </footer>

            <AskBar />
          </div>

          {page.aside ? (
            <aside className="docs-api-aside" aria-label="Example request and response">
              <div className="docs-api-request">
                <p className="docs-api-title">{page.aside.title}</p>
                <CodeGroup tabs={page.aside.request} />
              </div>
              <CodeGroup tabs={page.aside.responses} />
            </aside>
          ) : (
            toc.length > 0 && (
              <aside className="docs-toc" aria-label="On this page">
                <p className="docs-toc-title">
                  <AlignLeft size={14} aria-hidden />
                  On this page
                </p>
                <ul>
                  {toc.map((item) => (
                    <li key={item.id} data-depth={item.depth}>
                      <a href={`#${item.id}`}>{item.text}</a>
                    </li>
                  ))}
                </ul>
              </aside>
            )
          )}
        </div>
      </div>
    </div>
  );
}
