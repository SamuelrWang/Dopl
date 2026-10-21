import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { docHref, type DocTab, type NavLink } from "../content";

function isActive(link: NavLink, slug: string): boolean {
  return link.slug === slug;
}

function Row({ link, slug }: { link: NavLink; slug: string }) {
  const active = isActive(link, slug);
  return (
    <Link
      href={docHref(link.slug)}
      className={active ? "docs-nav-link raised-tab" : "docs-nav-link"}
      data-active={active || undefined}
      aria-current={active ? "page" : undefined}
    >
      {link.method && (
        <span className="docs-method docs-method-sm" data-method={link.method}>
          {link.method === "DELETE" ? "DEL" : link.method}
        </span>
      )}
      <span>{link.label}</span>
    </Link>
  );
}

/** A row with children: a chevron that expands in place (`<details>`, no client JS). */
function NestedRow({ link, slug }: { link: NavLink; slug: string }) {
  return (
    <details className="docs-nav-nested">
      <summary className="docs-nav-link">
        <span>{link.label}</span>
        <ChevronRight size={12} className="docs-nav-chevron" aria-hidden />
      </summary>
      <ul className="docs-nav-children">
        {link.children!.map((child) => (
          <li key={child.slug}>
            <Row link={child} slug={slug} />
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The left column: one tab's groups, each a title and its rows. */
export function DocsSidebar({ tab, slug }: { tab: DocTab; slug: string }) {
  return (
    <div className="docs-nav">
      {tab.groups.map((group) => (
        <div key={group.title} className="docs-nav-group">
          <p className="docs-nav-title">{group.title}</p>
          <ul>
            {group.links.map((link) => (
              <li key={link.slug}>
                {link.children ? <NestedRow link={link} slug={slug} /> : <Row link={link} slug={slug} />}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
