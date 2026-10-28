import {
  DOC_SECTIONS,
  DOCS_HOME,
  docHref,
  sectionHref,
  statusOf,
  tableOfContents,
  type DocPage,
  type DocSection,
  type DocSectionId,
  type DocStatus,
} from "../content";
import { DocsNavTree, type NavHeading, type NavNode } from "./docs-nav-tree";

/** Sidebar headings, top to bottom, and the sections under each. */
const HEADINGS: { title: string; sections: DocSectionId[] }[] = [
  { title: "Get started", sections: ["quickstart"] },
  { title: "Build", sections: ["devices", "core", "sdks"] },
  { title: "Reference", sections: ["api", "security", "pricing", "changelog"] },
];

/** Only "Soon" reaches the sidebar; Beta stays beside the page's H1, where it is one label, not twenty. */
const TAG: Record<DocStatus, string | undefined> = { live: undefined, beta: undefined, coming_soon: "Soon" };

/** A one-page section is a plain row; a longer one is a folder, tagged once when every page shares a status. */
function toNode(s: DocSection): NavNode {
  const links = s.groups.flatMap((g) => g.links);
  if (links.length === 1) return { kind: "link", id: s.id, label: s.title, href: sectionHref(s), slug: links[0].slug };
  const statuses = new Set(links.map((l) => statusOf(l.slug) ?? "live"));
  const shared = statuses.size === 1 ? [...statuses][0] : "live";
  return {
    kind: "folder",
    id: s.id,
    label: s.title,
    tag: TAG[shared],
    groups: s.groups.map((g) => ({
      title: g.title,
      rows: g.links.map((l) => {
        const status = statusOf(l.slug) ?? "live";
        return {
          slug: l.slug,
          label: l.label,
          href: docHref(l.slug),
          tag: status === shared ? undefined : TAG[status],
          soon: status === "coming_soon",
        };
      }),
    })),
  };
}

/** The sidebar's navigation: every section on every page, the current page's folder open. */
export function DocsSidebarNav({ page }: { page?: DocPage }) {
  const headings: NavHeading[] = HEADINGS.map((h) => ({
    title: h.title,
    nodes: h.sections.flatMap((id) => DOC_SECTIONS.filter((s) => s.id === id).map(toNode)),
  }));
  headings[0].nodes.unshift({ kind: "link", id: "home", label: "Home", href: docHref(DOCS_HOME), slug: DOCS_HOME });
  return (
    <DocsNavTree
      headings={headings}
      activeSlug={page?.slug ?? DOCS_HOME}
      anchors={page ? tableOfContents(page) : []}
    />
  );
}
