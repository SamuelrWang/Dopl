import { CONNECT_TABS } from "./connect";
import { DOC_SECTIONS } from "./nav";
import { API_PAGES, CHANGELOG_PAGES } from "./pages-api";
import { DEVICE_PAGES } from "./pages-devices";
import { OVERVIEW_PAGES } from "./pages-overview";
import { USE_CASE_PAGES } from "./pages-use-cases";
import type { DocBlock, DocPage, DocSection } from "./types";

export { CONNECT_TABS, DOC_SECTIONS };
export { DOCS_HOME_COPY, HOME_CARDS, HOME_LISTS } from "./home";
export type * from "./types";

/** The docs home (`src/app/docs/home/page.tsx`); bare `/docs` 308s here — `next.config.ts › redirects`. */
export const DOCS_HOME = "home";

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

export function getDocSection(page: DocPage): DocSection {
  return DOC_SECTIONS.find((s) => s.id === page.section) ?? DOC_SECTIONS[0];
}

/** Where a section's sidebar row lands: its first page. */
export function sectionHref(section: DocSection): string {
  return docHref(section.groups[0].links[0].slug);
}

/** Heading anchor ids: lowercase, non-alphanumerics collapsed to `-`. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** The page's anchors, listed under it in the sidebar: headings, field groups, changelog entries. */
export function tableOfContents(page: DocPage): { id: string; text: string }[] {
  return page.blocks.flatMap((b) => {
    if (b.type === "h2" || b.type === "h3") return [{ id: slugify(b.text), text: b.text }];
    if (b.type === "params") return [{ id: slugify(b.title), text: b.title }];
    if (b.type === "changelog") return b.entries.map((e) => ({ id: slugify(e.date), text: e.title }));
    return [];
  });
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
    case "prompt":
      return [`> ${plain(b.text)}`];
    case "connect":
      return CONNECT_TABS.map((t) => `**${t.label}**: \`${t.command}\``);
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
    case "endpoints":
      return [
        `**${b.label}**`,
        ...b.rows.map((r) => `- [\`${r.method} ${r.path}\`](${docHref(r.href)}): ${r.description}`),
      ];
  }
}

/** The page as Markdown — what the copy button beside the H1 puts on the clipboard. */
export function pageToMarkdown(page: DocPage): string {
  const head = [`# ${page.title}`, page.description].filter(Boolean);
  return [...head, ...page.blocks.flatMap(blockText)].join("\n\n");
}
