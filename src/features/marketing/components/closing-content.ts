import { PERSONAL_MONTHLY_CREDITS } from "@/features/billing/credits";
import { MAX_PLAN_NAME, planNumber } from "@/features/billing/plans";
import { formatMoney, MAX_PRICE, PRO_PRICE, TEAM_SEAT_PRICE } from "@/features/billing/prices";

import { DOWNLOAD_URL, GET_STARTED_LABEL, GET_STARTED_URL } from "../constants";

/** Copy for the page's closing run: pricing summary, FAQ, final CTA, footer.
 *  Edit here only.
 *
 *  ⚠ Samuel's copy rule: plain sentences, no em or en dashes in visible copy,
 *  the same eyebrow + one heading line voice as control-section.tsx.
 *
 *  ⚠ Prices and credit counts are INTERPOLATED from features/billing, never
 *  typed (the same G4 rule pricing-content.tsx states): a restated figure is
 *  public pricing drift no test can see.
 *
 *  Facts checked 2026-10-20: permission levels = channels/components/
 *  permission-preset-row.tsx; agents = connect-section.tsx TABS + MORE_LOGOS;
 *  robots planned = devices-content.ts; SDK preview = sdk-section.tsx;
 *  desktop download = src/app/download (macOS build only). */

/** On-page anchors. The section ids in hero.tsx read these. */
export const ANCHORS = {
  identities: "identities",
  orchestration: "orchestration",
  connect: "connect",
  devices: "devices",
  developers: "developers",
  pricing: "pricing",
  faq: "faq",
} as const;

export const PRICING_SUMMARY_COPY = {
  eyebrow: "Pricing",
  heading: "Start free and upgrade when you need more",
  personalCta: "Go Pro",
} as const;

export type FaqItem = {
  q: string;
  a: string;
  link?: { label: string; href: string };
};

export const FAQ_COPY = {
  eyebrow: "FAQ",
  heading: "Questions, answered",
  items: [
    {
      q: "What is an agent identity?",
      a: "An identity is one role of you, like you as a coder or you as an admin assistant. It carries the knowledge, tools, and rules that role needs, so every agent you launch from it works the way you would.",
    },
    {
      q: "Which agents work with Dopl?",
      a: "Claude, ChatGPT, and Grok Bot connect in a few steps, and so do Gemini, Cursor, and many others. Any agent that supports MCP can connect to Dopl.",
    },
    {
      q: "Do I need smart glasses or a robot?",
      a: "No. Dopl works on its own on your computer. Display glasses are an optional way to see and answer your agents hands-free, and robots are coming later.",
    },
    {
      q: "What can my agents do without asking me?",
      a: "Every agent runs under a permission level you choose. Ask checks with you before edits and commands, Auto runs routine work and asks before riskier actions, and Full runs everything its tools allow. Sensitive steps always wait for your decision.",
    },
    {
      q: "Who can see my agents' activity?",
      a: "You can, along with the people you share a channel or workspace with. Anything you keep private stays visible only to you.",
    },
    {
      q: "How is this different from using Claude Code or ChatGPT directly?",
      a: "You keep using the agents you already have. Dopl gives all of them one place to work, lets them work together on the same task, and lets them reach you outside the chat window when they need you.",
    },
    {
      q: "How does pricing work?",
      a: `Every plan includes every feature, and usage is measured in credits. The free plan includes ${planNumber(PERSONAL_MONTHLY_CREDITS.free)} credits a month. Pro is ${formatMoney(PRO_PRICE)} a month for ${planNumber(PERSONAL_MONTHLY_CREDITS.pro)} credits, ${MAX_PLAN_NAME} is ${formatMoney(MAX_PRICE)} a month for ${planNumber(PERSONAL_MONTHLY_CREDITS.max)} credits, and teams pay ${formatMoney(TEAM_SEAT_PRICE)} per seat each month.`,
      link: { label: "See full pricing", href: "/pricing" },
    },
    {
      q: "Is there an API or SDK?",
      a: "Dopl works over MCP today, so any agent that speaks MCP can use it. TypeScript and Python SDKs are in preview, and you can join the waitlist in the Developers section above.",
    },
    {
      q: "What platforms does it run on?",
      a: "The desktop app runs on Mac. Your workspace is also available in the browser.",
    },
  ] as readonly FaqItem[],
} as const;

/** Final CTA heading: ONE sentence in two lines at one size, "You ×10. Start
 *  building digital" / "doppelgängers with Dopl today." The multiplier ticks
 *  through MULTIPLIERS once in view; the LAST is the resting frame (SSR, no JS,
 *  reduced motion). "×" is U+00D7. The break after LINE_START is forced on
 *  desktop (the most even split, measured) and dropped on narrow screens. */
const FINAL_CTA_MULTIPLIERS = ["×2", "×4", "×6", "×8", "×10"] as const;
const FINAL_CTA_LEAD = "You";
const FINAL_CTA_LINE_START = "Start building digital";
const FINAL_CTA_LINE_END = "doppelgängers with Dopl today.";

export const FINAL_CTA_COPY = {
  lead: FINAL_CTA_LEAD,
  multipliers: FINAL_CTA_MULTIPLIERS,
  lineStart: FINAL_CTA_LINE_START,
  lineEnd: FINAL_CTA_LINE_END,
  /** What screen readers hear: the final state, never the count. */
  heading: `${FINAL_CTA_LEAD} ${FINAL_CTA_MULTIPLIERS[FINAL_CTA_MULTIPLIERS.length - 1]}. ${FINAL_CTA_LINE_START} ${FINAL_CTA_LINE_END}`,
  primary: GET_STARTED_LABEL,
  secondary: "Download for Mac",
  secondaryHref: DOWNLOAD_URL,
} as const;

export type FooterLink = {
  label: string;
  href: string;
  /** Route handler, not a page: render a plain anchor, never next/link. */
  plain?: boolean;
  tag?: string;
};

/** ⚠ Only routes that exist (src/app) or on-page anchors. A Company column is
 *  left out on purpose: there is no about or contact route yet. */
export const FOOTER_COLUMNS: readonly { title: string; links: readonly FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Identities", href: `/#${ANCHORS.identities}` },
      { label: "Orchestration", href: `/#${ANCHORS.orchestration}` },
      { label: "Devices", href: `/#${ANCHORS.devices}` },
      { label: "Pricing", href: "/pricing" },
      { label: "Download", href: DOWNLOAD_URL, plain: true },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "MCP", href: `/#${ANCHORS.connect}` },
      { label: "SDK", href: `/#${ANCHORS.developers}`, tag: "Preview" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "FAQ", href: `/#${ANCHORS.faq}` },
      { label: "Get started", href: GET_STARTED_URL },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Services Agreement", href: "/services-agreement" },
      { label: "Privacy", href: "/privacy" },
    ],
  },
];

export const FOOTER_COPY = {
  tagline: "Your personal AI on every model and device.",
  copyright: "© 2026 Dopl. All rights reserved.",
} as const;
