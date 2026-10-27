import "@/features/marketing/marketing.css";
import "@/features/marketing/docs/docs.css";

import type { ReactNode } from "react";

import { DOC_PAGES, docHref, pageToMarkdown, type DocBlock, type DocPage } from "../content";
import { DocBlocks } from "./docs-blocks";
import { DocsFrame } from "./docs-header";
import { CodeGroup, CopyPageButton } from "./docs-interactive";
import { DocsSidebarNav } from "./docs-sidebar";
import { SocialLinks } from "./social-links";

const SITE = "https://www.usedopl.com";

const SEARCH_ENTRIES = DOC_PAGES.map((p) => ({
  title: p.title,
  group: p.group,
  href: docHref(p.slug),
}));

/**
 * The docs shell, shared by the home and every page: the sidebar (home view without a
 * `page`, else that page's section) and the content column under the top bar.
 *
 * ⚠ WHITE PAGE, LIKE THE LEGAL PAGES: `body.legal-active` (set before first paint by
 * `src/app/layout.tsx` and kept by `shared/layout/layout-shell.tsx`) — never the frame colour.
 */
export function DocsShell({ page, children }: { page?: DocPage; children: ReactNode }) {
  return (
    <DocsFrame nav={<DocsSidebarNav page={page} />} entries={SEARCH_ENTRIES}>
      {children}
      <footer className="docs-wrap docs-footer">
        <SocialLinks />
      </footer>
    </DocsFrame>
  );
}

/** An API Reference page leads with its endpoint line; the fields then sit beside the code. */
function splitEndpoint(blocks: DocBlock[]): {
  lead: DocBlock[];
  rest: DocBlock[];
} {
  const i = blocks.findIndex((b) => b.type === "endpoint");
  return i < 0 ? { lead: [], rest: blocks } : { lead: blocks.slice(0, i + 1), rest: blocks.slice(i + 1) };
}

/** One docs page: title (with the copy button), subtitle, then the blocks. */
export function DocsPage({ page }: { page: DocPage }) {
  const { lead, rest } = splitEndpoint(page.blocks);
  return (
    <DocsShell page={page}>
      <main className="docs-wrap docs-content">
        <header className="docs-head">
          <h1>{page.title}</h1>
          <CopyPageButton markdown={pageToMarkdown(page)} url={`${SITE}${docHref(page.slug)}`} />
        </header>
        {page.description && <p className="docs-subtitle">{page.description}</p>}

        {page.aside ? (
          <>
            <div className="docs-prose">
              <DocBlocks blocks={lead} />
            </div>
            <div className="docs-api-split">
              <div className="docs-prose">
                <DocBlocks blocks={rest} />
              </div>
              <aside className="docs-api-code" aria-label="Example request and response">
                <CodeGroup tabs={page.aside.request} />
                <CodeGroup tabs={page.aside.responses} />
              </aside>
            </div>
          </>
        ) : (
          <article className="docs-prose">
            <DocBlocks blocks={page.blocks} />
          </article>
        )}
      </main>
    </DocsShell>
  );
}
