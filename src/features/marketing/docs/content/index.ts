import { DOC_TABS } from "./nav";
import { API_PAGES, CHANGELOG_PAGES } from "./pages-api";
import { DEVICE_PAGES } from "./pages-devices";
import { OVERVIEW_PAGES } from "./pages-overview";
import { USE_CASE_PAGES } from "./pages-use-cases";
import type { DocBlock, DocPage, DocTab, NavLink } from "./types";

export { DOC_TABS };
export type * from "./types";

/** The landing page of `/docs` (bare `/docs` 308s here — `next.config.ts › redirects`). */
export const DOCS_HOME = "start-here";

export const DOC_PAGES: DocPage[] = [
  ...OVERVIEW_PAGES,
  ...USE_CASE_PAGES,
  ...DEVICE_PAGES,
  ...API_PAGES,
  ...CHANGELOG_PAGES,
];

const BY_SLUG = new Map(DOC_PAGES.map((p) => [p.slug, p]));

export function getDocPage(slug: string): DocPage | undefined {
  return BY_SLUG.get(slug);
}

export function docHref(slug: string): string {
  return `/docs/${slug}`;
}

export function getDocTab(page: DocPage): DocTab {
  return DOC_TABS.find((t) => t.id === page.tab) ?? DOC_TABS[0];
}

/** Heading anchor ids: lowercase, non-alphanumerics collapsed to `-`. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** The "On this page" list: every top-level h2 (and h3 under it). */
export function tableOfContents(page: DocPage): { id: string; text: string; depth: 2 | 3 }[] {
  return page.blocks.flatMap((b) =>
    b.type === "h2" || b.type === "h3"
      ? [{ id: slugify(b.text), text: b.text, depth: b.type === "h2" ? (2 as const) : (3 as const) }]
      : []
  );
}

/** Sidebar rows of one tab, flattened, page links only (no `#fragment` rows). */
function pageLinks(tab: DocTab): NavLink[] {
  return tab.groups.flatMap((g) => g.links).filter((l) => !l.slug.includes("#"));
}

/** Previous / next page within the same header tab, in sidebar order. */
export function neighbours(page: DocPage): { prev?: NavLink; next?: NavLink } {
  const links = pageLinks(getDocTab(page));
  const i = links.findIndex((l) => l.slug === page.slug);
  if (i < 0) return {};
  return { prev: links[i - 1], next: links[i + 1] };
}

/** Strip the inline marks to plain text, keeping link URLs. */
function plain(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1");
}

function blockText(b: DocBlock): string[] {
  switch (b.type) {
    case "p":
      return [plain(b.text)];
    case "h2":
      return [`## ${b.text}`];
    case "h3":
      return [`### ${b.text}`];
    case "quote":
      return [`> ${plain(b.text)}`];
    case "list":
      return b.items.map((it, i) => {
        const item = typeof it === "string" ? { text: it, blocks: [] } : it;
        const head = `${b.ordered ? `${i + 1}.` : "-"} ${plain(item.text)}`;
        return [head, ...(item.blocks ?? []).flatMap(blockText)].join("\n");
      });
    case "cards":
      return b.items.map((c) => `- [${c.title}](${docHref(c.href)}): ${plain(c.description)}`);
    case "steps":
      return b.items.flatMap((s, i) => [`${i + 1}. ${s.title}`, ...s.blocks.flatMap(blockText)]);
    case "tabs":
      return b.tabs.flatMap((t) => [`**${t.label}**`, ...t.blocks.flatMap(blockText)]);
    case "accordions":
      return b.items.flatMap((a) => [`**${a.title}**`, ...a.blocks.flatMap(blockText)]);
    case "code":
      return b.tabs.map((t) => `\`\`\`${t.label}\n${t.code}\n\`\`\``);
    case "hero":
      return [];
    case "endpoint":
      return [`\`${b.method} ${b.path}\``];
    case "params":
      return [`## ${b.title}`, ...b.params.map((p) => `- \`${p.name}\` (${p.type}): ${plain(p.description)}`)];
    case "table":
      return [
        `| ${b.columns.join(" | ")} |`,
        `| ${b.columns.map(() => "---").join(" | ")} |`,
        ...b.rows.map((r) => `| ${r.map(plain).join(" | ")} |`),
      ];
    case "changelog":
      return b.entries.map((e) => `## ${e.date} — ${e.title}\n${plain(e.description)}`);
  }
}

/** The page as Markdown — what the "Copy page" button puts on the clipboard. */
export function pageToMarkdown(page: DocPage): string {
  const head = [`# ${page.title}`, page.description].filter(Boolean);
  return [...head, ...page.blocks.flatMap(blockText)].join("\n\n");
}
