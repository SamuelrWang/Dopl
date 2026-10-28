import { CONNECT_ROWS, CURSOR_INSTALL_URL } from "./connect";
import { DOC_SECTIONS } from "./nav";
import { API_PAGES } from "./pages-api";
import { CATEGORY_PAGES } from "./pages-categories";
import { CONCEPT_PAGES } from "./pages-concepts";
import { GUIDE_PAGES } from "./pages-guides";
import { OVERVIEW_PAGES } from "./pages-overview";
import { ROUTING_PAGES } from "./pages-routing";
import { CHANGELOG_PAGES, SDK_PAGES } from "./pages-sdks";
import { DOC_STATUS_LABEL } from "./types";
import type { CapabilityCard, DocBlock, DocPage, DocSection, DocStatus } from "./types";

export { CONNECT_ROWS, CURSOR_INSTALL_URL, DOC_SECTIONS, DOC_STATUS_LABEL };
export { DOCS_HOME_COPY, HOME_CARDS, HOME_CORE, HOME_DEVICES } from "./home";
export type * from "./types";

/** The docs home (`src/app/docs/home/page.tsx`); bare `/docs` 308s here — `next.config.ts › redirects`. */
export const DOCS_HOME = "home";

export const DOC_PAGES: DocPage[] = [
  ...OVERVIEW_PAGES,
  ...CATEGORY_PAGES,
  ...CONCEPT_PAGES,
  ...ROUTING_PAGES,
  ...GUIDE_PAGES,
  ...API_PAGES,
  ...SDK_PAGES,
  ...CHANGELOG_PAGES,
];

const BY_SLUG = new Map(DOC_PAGES.map((p) => [p.slug, p]));

export function getDocPage(slug: string): DocPage | undefined {
  return BY_SLUG.get(slug);
}

/** The status of the page a nav slug points at. */
export function statusOf(slug: string): DocStatus | undefined {
  return BY_SLUG.get(slug.split("#")[0])?.status;
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

/** A capability card's anchor: its title and capability, so a receive and a send card never collide. */
export function capabilityAnchor(card: Pick<CapabilityCard, "title" | "capability">): string {
  return slugify(`${card.title} ${card.capability}`);
}

/** The page's anchors, listed under it in the sidebar: headings, capability cards, field groups, changelog entries. */
export function tableOfContents(page: DocPage): { id: string; text: string }[] {
  return page.blocks.flatMap((b) => {
    if (b.type === "h2" || b.type === "h3") return [{ id: slugify(b.text), text: b.text }];
    if (b.type === "capability") return [{ id: capabilityAnchor(b), text: b.title }];
    if (b.type === "params") return [{ id: slugify(b.title), text: b.title }];
    if (b.type === "changelog") return b.entries.map((e) => ({ id: slugify(e.date), text: e.title }));
    return [];
  });
}

/** Strip the inline marks to plain text, keeping link URLs. */
function plain(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1");
}

const label = (s: DocStatus | null) => (s ? DOC_STATUS_LABEL[s] : "Not supported");

function capabilityText(c: CapabilityCard): string[] {
  return [
    `### ${c.title} (\`${c.capability}\`)`,
    plain(c.what),
    `**Limits**\n${c.limits.map((l) => `- ${plain(l)}`).join("\n")}`,
    `**Permission**: ${c.tier}. ${plain(c.permission)}`,
    ...c.code.map((t) => `\`\`\`${t.label}\n${t.code}\n\`\`\``),
    ...c.response.map((t) => `Response ${t.label}:\n\`\`\`json\n${t.code}\n\`\`\``),
    `**Supported on**\n${c.support.map((m) => `- ${m.model}: ${label(m.status)}${m.note ? `. ${plain(m.note)}` : ""}`).join("\n")}`,
  ];
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
      return [
        ...CONNECT_ROWS.map((r) => `**${r.comment}**: \`${r.copy}\``),
        `**Cursor one-click install**: ${CURSOR_INSTALL_URL}`,
      ];
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
        [
          `| ${b.columns.join(" | ")} |`,
          `| ${b.columns.map(() => "---").join(" | ")} |`,
          ...b.rows.map((r) => `| ${r.map(plain).join(" | ")} |`),
        ].join("\n"),
      ];
    case "models":
      return [
        b.items.map((m) => `- **${m.name}** (${m.status === "coming_soon" ? "Planned" : DOC_STATUS_LABEL[m.status]}): ${m.reach}`).join("\n"),
        ...(b.unsupported?.length ? [`Not supported yet: ${b.unsupported.join(", ")}.`] : []),
      ];
    case "support":
      return [
        [
          `| Capability | ${b.models.join(" | ")} |`,
          `| --- | ${b.models.map(() => "---").join(" | ")} |`,
          ...b.rows.map((r) => `| \`${r.capability}\` | ${r.cells.map(label).join(" | ")} |`),
        ].join("\n"),
      ];
    case "capability":
      return capabilityText(b);
    case "changelog":
      return b.entries.map((e) => `## ${e.date}: ${e.title}\n${plain(e.description)}`);
    case "flow":
      return [b.items.map((it, i) => `${i + 1}. **${it.title}**: ${it.detail}`).join("\n")];
  }
}

/** The page as Markdown — what the copy button beside the H1 puts on the clipboard. */
export function pageToMarkdown(page: DocPage): string {
  const head = [`# ${page.title}`, `Status: ${DOC_STATUS_LABEL[page.status]}`, page.description].filter(Boolean);
  return [...head, ...page.blocks.flatMap(blockText)].join("\n\n");
}
