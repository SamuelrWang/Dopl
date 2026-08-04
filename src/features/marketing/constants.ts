/** Static copy for the landing page (Lattice reference clone). */

export const BRAND = "Dopl";

export const NAV_LINKS = ["Product", "Services", "Career", "Pricing", "About"] as const;

/**
 * THE LANDING PAGE HAS ONE CALL TO ACTION, AND IT NOW GOES THROUGH THE ACCOUNT.
 *
 * It was "Download", pointing straight at the dmg: the login buttons had already
 * left the page, because Dopl is a desktop app and the web app is being retired
 * (docs/migration-research/website-retirement-plan.md). This is the next move,
 * not a reversal of that one — the button is still ONE button, it just captures
 * the account first (the Wispr Flow pattern):
 *
 *   Get Started → /login (sign in or sign up) → /get-started (the dmg starts
 *   downloading, with install steps) → open the app → sign in there.
 *
 * WHY THE EXTRA HOP IS WORTH IT. A download that begins at an anonymous click is
 * unmeasurable and unrecoverable: nobody knows whether the installer was ever
 * opened, and there is no address to follow up on when it wasn't. An account
 * created BEFORE the download makes install drop-off a thing you can see and
 * write to, and turns the funnel into three countable hops. The user signs in
 * once more inside the app afterwards, which they were always going to do.
 *
 * `/download` IS STILL THE DOWNLOAD, and still public. `/get-started` uses it —
 * it is the stable, README-able, tweetable path and nothing about it changed.
 */
export const GET_STARTED_LABEL = "Get Started";

/**
 * Where "Get Started" goes. `/login` IS the signup surface: the same screen
 * carries "Don't have an account? Sign up" (email + password, confirmed by
 * mail), a magic link that creates the account on first use, and Google/GitHub
 * OAuth that auto-provisions on first sign-in. There is no separate `/signup`
 * route and no mode param to pass — the audit that removed `signup` from
 * RESERVED_WORKSPACE_SLUGS (S-13) recorded the same fact.
 */
export const GET_STARTED_URL = "/login";

export const MENU_LABEL = "Menu";

export const HERO = {
  /** Rendered as two lines, matching the reference line break. */
  headlineLines: ["Ontologies to Bridge", "Agents and Teams"] as const,
  subhead:
    "We bring ideas to life by combining years of experiences of our very talented team.",
  primaryCta: GET_STARTED_LABEL,
} as const;

/**
 * The download, as a stable same-origin path. No longer a landing-page CTA —
 * `/get-started` is what fires it now, on mount and from its retry link.
 *
 * This was a hardcoded github.com URL naming a `Dopl-arm64.dmg` asset that has
 * never existed — electron-builder stamps the version into the file name, so the
 * button 404'd. `src/app/download/route.ts` resolves the real asset out of the
 * release feed and redirects; `src/shared/version/mac-download.ts` is the why.
 */
export const DOWNLOAD_URL = "/download";

export interface DeckPanel {
  id: string;
  eyebrow: string;
  label: string;
  /** Short feature description shown in the expanded panel (rolling out per tab). */
  blurb?: string;
}

/** Stacked deck panels under the hero. Front = active; rest fan to the right. */
export const DECK_PANELS: readonly DeckPanel[] = [
  {
    id: "ontology",
    eyebrow: "01",
    label: "Ontology",
    blurb:
      "Your team's intelligence, structured. Objects, attributes, and edges — one live graph your agents read, write, and act through.",
  },
  {
    id: "knowledge",
    eyebrow: "02",
    label: "Knowledge",
    blurb:
      "What your team knows, as objects in the graph. Agents pull the right doc into context instead of guessing.",
  },
  {
    id: "skills",
    eyebrow: "03",
    label: "Skills",
    blurb:
      "How your team does things — procedures agents load and follow. Written once, versioned, linked into the ontology.",
  },
  {
    id: "chats",
    eyebrow: "04",
    label: "Chats",
    blurb:
      "What your agents have said and decided. Every conversation archived, searchable, and feeding back into the graph.",
  },
  {
    id: "workflows",
    eyebrow: "05",
    label: "Workflows",
    blurb:
      "Multi-step runs your agents execute end-to-end — grounded in the same ontology, so every step knows the context.",
  },
];

/** Seconds the top slider takes to cross a panel before auto-advancing. */
export const DECK_DURATION_S = 8;

