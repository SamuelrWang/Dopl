import { ChevronLeft } from "lucide-react";
import Link from "next/link";

import {
  DOC_SECTIONS,
  DOCS_HOME,
  docHref,
  getDocSection,
  sectionHref,
  tableOfContents,
  type DocPage,
  type DocSection,
} from "../content";
import { NAV_ICONS } from "./docs-icons";

function NavIcon({ id }: { id: keyof typeof NAV_ICONS }) {
  const Icon = NAV_ICONS[id];
  return (
    <span className="docs-nav-icon" aria-hidden>
      <Icon size={20} strokeWidth={1.6} />
    </span>
  );
}

/** Every section: `item` sections as one row, `group` sections as a heading over their pages. */
function HomeView() {
  const items = DOC_SECTIONS.filter((s) => s.home === "item");
  const groups = DOC_SECTIONS.filter((s) => s.home === "group");
  return (
    <>
      <ul className="docs-nav-top">
        <li>
          <Link href={docHref(DOCS_HOME)} className="docs-nav-item" data-active aria-current="page">
            <NavIcon id="home" />
            Home
          </Link>
        </li>
        {items.map((s) => (
          <li key={s.id}>
            <Link href={sectionHref(s)} className="docs-nav-item">
              <NavIcon id={s.id} />
              {s.title}
            </Link>
          </li>
        ))}
      </ul>
      {groups.map((s) => (
        <section key={s.id} className="docs-nav-group">
          <Link href={sectionHref(s)} className="docs-nav-group-title">
            <NavIcon id={s.id} />
            {s.title}
          </Link>
          <ul>
            {s.groups
              .flatMap((g) => g.links)
              .map((l) => (
                <li key={l.slug}>
                  <Link href={docHref(l.slug)} className="docs-nav-child">
                    {l.label}
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/** One section: "All docs", its title, its pages, and the active page's anchors beneath it. */
function SectionView({ section, page }: { section: DocSection; page: DocPage }) {
  const anchors = tableOfContents(page);
  return (
    <>
      <Link href={docHref(DOCS_HOME)} className="docs-nav-back">
        <span className="docs-nav-icon" aria-hidden>
          <ChevronLeft size={16} strokeWidth={2} />
        </span>
        All docs
      </Link>
      <p className="docs-nav-section-title">
        <NavIcon id={section.id} />
        {section.title}
      </p>
      {section.groups.map((g, i) => (
        <div key={g.title ?? i} className="docs-nav-sub">
          {g.title && <p className="docs-nav-sub-title">{g.title}</p>}
          <ul>
            {g.links.map((l) => {
              const active = l.slug === page.slug;
              return (
                <li key={l.slug}>
                  <Link
                    href={docHref(l.slug)}
                    className="docs-nav-page"
                    data-active={active || undefined}
                    aria-current={active ? "page" : undefined}
                  >
                    {l.label}
                  </Link>
                  {active && anchors.length > 0 && (
                    <ul className="docs-nav-anchors">
                      {anchors.map((a) => (
                        <li key={a.id}>
                          <a href={`#${a.id}`}>
                            <span className="docs-nav-hash" aria-hidden>
                              #
                            </span>
                            <span>{a.text}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

/** The sidebar's navigation: the home view on the docs home, else the page's section view. */
export function DocsSidebarNav({ page }: { page?: DocPage }) {
  return (
    <nav className="docs-nav" aria-label="Docs navigation">
      {page ? <SectionView section={getDocSection(page)} page={page} /> : <HomeView />}
    </nav>
  );
}
