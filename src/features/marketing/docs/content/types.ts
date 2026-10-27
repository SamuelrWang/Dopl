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
  | "speaker"
  | "watch"
  | "car"
  | "robot"
  | "quickstart"
  | "api"
  | "security";

export type HttpMethod = "GET" | "POST" | "DELETE";

export interface CodeTab {
  label: string;
  code: string;
}

export interface DocParam {
  name: string;
  type: string;
  required?: boolean;
  /** `header`, `path`, `body` … shown beside the type. */
  location?: string;
  description: Rich;
}

export interface ListItem {
  text: Rich;
  /** Blocks nested under the item (a code group under "Install for your runtime:"). */
  blocks?: DocBlock[];
}

/** One row of an endpoint table: the monospace path links to its page. */
export interface EndpointRow {
  method: HttpMethod;
  path: string;
  /** Page slug under `/docs/`. */
  href: string;
  description: string;
}

export type DocBlock =
  | { type: "p"; text: Rich }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  /** A thin-bordered callout with an icon. */
  | { type: "quote"; text: Rich }
  | { type: "list"; ordered?: boolean; items: (Rich | ListItem)[] }
  | {
      type: "cards";
      items: {
        icon: DocIcon;
        title: string;
        description: Rich;
        href: string;
      }[];
    }
  | { type: "steps"; items: { title: string; blocks: DocBlock[] }[] }
  /** A copyable instruction in a white window ("Copy this instruction into your agent"). */
  | { type: "prompt"; text: Rich }
  /** The Claude / Codex / Cursor / SDK connect window (`../components/docs-interactive.tsx`). */
  | { type: "connect" }
  | { type: "code"; tabs: CodeTab[] }
  | { type: "hero"; label: string; lines: string[] }
  | { type: "endpoint"; method: HttpMethod; path: string }
  | { type: "params"; title: string; params: DocParam[] }
  | { type: "table"; columns: string[]; rows: Rich[][] }
  | {
      type: "changelog";
      entries: { date: string; title: string; description: Rich }[];
    }
  /** A labelled endpoint table ("Intents", "Devices"): path link left, description right. */
  | { type: "endpoints"; label: string; rows: EndpointRow[] };

/** A sidebar section. A page belongs to exactly one; inside it the sidebar shows that section. */
export type DocSectionId = "quickstart" | "api" | "security" | "pricing" | "changelog" | "use-cases" | "devices";

/** The request/response code on an API Reference page, beside the fields. */
export interface ApiAside {
  title: string;
  request: CodeTab[];
  responses: CodeTab[];
}

export interface DocPage {
  /** Path under `/docs/`, e.g. `use-cases/show`. */
  slug: string;
  section: DocSectionId;
  /** The page's group, shown beside its title in search results. */
  group: string;
  title: string;
  description: string;
  blocks: DocBlock[];
  aside?: ApiAside;
}

export interface NavLink {
  label: string;
  /** Path under `/docs/`. */
  slug: string;
}

export interface NavGroup {
  /** Omitted for a section's leading, untitled rows. */
  title?: string;
  links: NavLink[];
}

export interface DocSection {
  id: DocSectionId;
  title: string;
  /** On the docs home sidebar: one row (`item`), or a heading with its pages beneath (`group`). */
  home: "item" | "group";
  groups: NavGroup[];
}
