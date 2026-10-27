import Link from "next/link";

import { DOC_SECTIONS, DOCS_HOME_COPY, HOME_CARDS, HOME_LISTS, docHref, getDocPage, sectionHref } from "../content";
import { DOC_ICONS } from "./docs-icons";
import { DocsShell } from "./docs-page";

/**
 * The docs home: banner (two-line title, subtitle, image), a hairline, three cards, then one
 * two-column list per `group` section. Titles and descriptions come from the pages.
 */
export function DocsHome() {
  return (
    <DocsShell>
      <main>
        <div className="docs-wrap docs-banner">
          <div className="docs-banner-text">
            <h1>{DOCS_HOME_COPY.title}</h1>
            <p>{DOCS_HOME_COPY.subtitle}</p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="docs-banner-image" src="/img/dev-clouds.jpg" alt="" width={508} height={380} />
        </div>

        <hr className="docs-separator" />

        <div className="docs-wrap docs-home">
          <div className="docs-home-cards">
            {HOME_CARDS.map((c) => {
              const page = getDocPage(c.slug);
              const Icon = DOC_ICONS[c.icon];
              return (
                <Link key={c.slug} href={docHref(c.slug)} className="lp-mp-card docs-card docs-home-card">
                  <Icon size={22} strokeWidth={1.6} aria-hidden />
                  <span className="docs-card-title">{c.title}</span>
                  <span className="docs-card-desc">{page?.description}</span>
                </Link>
              );
            })}
          </div>

          {HOME_LISTS.map((list) => {
            const section = DOC_SECTIONS.find((s) => s.id === list.section);
            if (!section) return null;
            return (
              <section key={section.id} className="docs-home-list">
                <h2>
                  <Link href={sectionHref(section)}>{section.title}</Link>
                </h2>
                <div className="docs-home-grid">
                  {section.groups
                    .flatMap((g) => g.links)
                    .map((l) => {
                      const page = getDocPage(l.slug);
                      const Icon = DOC_ICONS[list.icons[l.slug] ?? "desktop"];
                      return (
                        <Link key={l.slug} href={docHref(l.slug)} className="docs-home-item">
                          <span className="docs-home-item-icon" aria-hidden>
                            <Icon size={28} strokeWidth={1.4} />
                          </span>
                          <span>
                            <span className="docs-home-item-title">{l.label}</span>
                            <span className="docs-home-item-desc">{page?.description}</span>
                          </span>
                        </Link>
                      );
                    })}
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </DocsShell>
  );
}
