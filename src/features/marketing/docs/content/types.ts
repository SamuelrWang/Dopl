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
  | "headphones"
  | "phone"
  | "desktop"
  | "speaker"
  | "car"
  | "robot"
  | "quickstart"
  | "api"
  | "security"
  | "code";

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

/**
 * Whether what a page (or one model's support for one capability) describes works today. A page
 * or badge is `live` only when everything it tells a reader to do works in production now, and a
 * `live` model badge must be backed by the adapter's `describe()` AND its wired dispatcher
 * (`content.test.ts`). `beta` works with known limits; `coming_soon` is planned and must be
 * phrased as planned.
 */
export type DocStatus = "live" | "beta" | "coming_soon";

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  live: "Live",
  beta: "Beta",
  coming_soon: "Coming soon",
};

/** One model's support for one capability, with the badge and an optional one-line note. */
export interface ModelSupport {
  model: string;
  status: DocStatus;
  note?: Rich;
}

/**
 * One capability, in the one card every device category uses (`pages-categories.ts ›
 * capabilityCard`): what it does and when, limits, permission and tier, code, an example
 * response, and which models support it.
 */
export interface CapabilityCard {
  /** A C3 capability id (`@dopl/contracts/device-sdk › CAPABILITY_IDS`). */
  capability: string;
  title: string;
  /** What it does and when to use it. */
  what: Rich;
  limits: Rich[];
  /** The C3 default tier, and what the consent screen and policy do with it. */
  tier: string;
  permission: Rich;
  /** TypeScript (`@dopl/sdk`) and cURL. */
  code: CodeTab[];
  response: CodeTab[];
  support: ModelSupport[];
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
  /** The Claude / Codex / Cursor connect window (`../components/docs-interactive.tsx`). */
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
  /** A chain of hairline boxes joined by arrows (the Overview's "how it works" diagram). */
  | { type: "flow"; label: string; items: { title: string; detail: string }[] }
  /**
   * A device category's model cards: each model, how Dopl reaches it and its best status, then
   * the brands Dopl does not reach yet.
   */
  | { type: "models"; items: { name: string; reach: string; status: DocStatus }[]; unsupported?: string[] }
  /** A model × capability grid of status badges (under a device category's model cards). */
  | { type: "support"; models: string[]; rows: { capability: string; cells: (DocStatus | null)[] }[] }
  | ({ type: "capability" } & CapabilityCard);

/** A sidebar section. A page belongs to exactly one; inside it the sidebar shows that section. */
export type DocSectionId = "quickstart" | "devices" | "core" | "api" | "sdks" | "security" | "pricing" | "changelog";

/** The request/response code on an API Reference page, beside the fields. */
export interface ApiAside {
  title: string;
  request: CodeTab[];
  responses: CodeTab[];
}

export interface DocPage {
  /** Path under `/docs/`, e.g. `devices/display-glasses`. */
  slug: string;
  section: DocSectionId;
  /** The page's group, shown beside its title in search results. */
  group: string;
  title: string;
  description: string;
  /** Rendered as a badge beside the H1 and on the page's sidebar row when it is not live. */
  status: DocStatus;
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
