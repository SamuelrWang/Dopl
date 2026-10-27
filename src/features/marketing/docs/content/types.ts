/**
 * The developer docs (`/docs/**`) as DATA. Every page is a `DocPage` of typed blocks; the
 * renderer (`../components/docs-blocks.tsx`) owns all markup, so editing copy never means
 * editing JSX. Inline text takes three marks only: `code`, **bold** and [label](href).
 */

/** A string with inline marks (see the file header). */
export type Rich = string;

/** Card icons by name — mapped to lucide glyphs in the renderer, so content stays data. */
export type DocIcon =
  | "show"
  | "ask"
  | "notify"
  | "connect"
  | "route"
  | "glasses"
  | "phone"
  | "notch"
  | "desktop"
  | "key"
  | "shield"
  | "layers"
  | "activity"
  | "code"
  | "test";

export type HttpMethod = "GET" | "POST" | "DELETE";

export interface CodeTab {
  label: string;
  code: string;
}

export interface DocParam {
  name: string;
  type: string;
  required?: boolean;
  /** `header`, `path`, `body` … shown as a second chip. */
  location?: string;
  description: Rich;
}

export interface ListItem {
  text: Rich;
  /** Blocks nested under the item (a code group under "Install for your runtime:"). */
  blocks?: DocBlock[];
}

export type DocBlock =
  | { type: "p"; text: Rich }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "quote"; text: Rich }
  | { type: "list"; ordered?: boolean; items: (Rich | ListItem)[] }
  | {
      type: "cards";
      items: { icon: DocIcon; title: string; description: Rich; href: string }[];
    }
  | { type: "steps"; items: { title: string; blocks: DocBlock[] }[] }
  /** A copyable instruction in a white window ("Copy this instruction into your agent"). */
  | { type: "prompt"; text: Rich }
  /** The `dopl-mcp` connect window (`../components/docs-interactive.tsx › DocsConnect`). */
  | { type: "connect" }
  | { type: "code"; tabs: CodeTab[] }
  | { type: "hero"; label: string; lines: string[] }
  | { type: "endpoint"; method: HttpMethod; path: string }
  | { type: "params"; title: string; params: DocParam[] }
  | { type: "table"; columns: string[]; rows: Rich[][] }
  | { type: "changelog"; entries: { date: string; title: string; description: Rich }[] }
  /** A chain of hairline boxes joined by arrows (the Overview's "how it works" diagram). */
  | { type: "flow"; label: string; items: { title: string; detail: string }[] };

export type DocTabId = "about" | "api" | "sdks" | "changelog";

/**
 * Whether what a page describes works today. ⚠ The truth source is the status table in
 * `docs/specs/device-sdk/SPEC-v1.md` §4: a page is `live` only when everything it tells a
 * reader to do works in production now. `beta` works with known limits; `coming_soon` is
 * planned and must be phrased as planned (no install commands, no "available").
 */
export type DocStatus = "live" | "beta" | "coming_soon";

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  live: "Live",
  beta: "Beta",
  coming_soon: "Coming soon",
};

/** The sticky right column on an API Reference page: request, then responses by status. */
export interface ApiAside {
  title: string;
  request: CodeTab[];
  responses: CodeTab[];
}

export interface DocPage {
  /** Path under `/docs/`, e.g. `use-cases/show`. */
  slug: string;
  tab: DocTabId;
  /** The small gray line above the H1 (the page's sidebar group). */
  group: string;
  title: string;
  description: string;
  /** Rendered as a badge beside the H1 and on the page's sidebar row. */
  status: DocStatus;
  blocks: DocBlock[];
  aside?: ApiAside;
}

export interface NavLink {
  label: string;
  /** Path under `/docs/`, optionally with a `#fragment`. */
  slug: string;
  method?: HttpMethod;
  /** Nested rows — the row renders a chevron and expands. */
  children?: NavLink[];
}

export interface NavGroup {
  title: string;
  links: NavLink[];
}

export interface DocTab {
  id: DocTabId;
  label: string;
  /** Where the tab lands. */
  slug: string;
  groups: NavGroup[];
}
