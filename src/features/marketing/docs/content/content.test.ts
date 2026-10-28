import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CAPABILITY_IDS,
  CAPABILITY_RISK_TIER,
  ContextProfileSchema,
  ERROR_CODE_INFO,
  type CapabilityId,
  type Device,
} from "@dopl/contracts/device-sdk";
import { describe, expect, it } from "vitest";

import { createEvenG2Adapter } from "@/features/device-sdk/adapters/even-g2";
import { createSimulatorAdapter } from "@/features/device-sdk/adapters/simulator";

import { DOC_PAGES, DOC_SECTIONS, getDocPage, HOME_CARDS, HOME_LISTS, pageToMarkdown, statusOf } from "./index";
import { ERROR_ROWS } from "./pages-api";
import { CATEGORIES } from "./pages-categories";
import { CAPABILITY_ROWS } from "./pages-concepts";
import { AR_GLASSES_PROFILE } from "./pages-routing";
import type { CapabilityCard, DocBlock, DocPage } from "./types";

/**
 * The docs truth pass and structure: every page carries a status, nothing unbuilt reads as
 * available, every `/v1` path in a sample exists in the frozen contract, the device CATEGORY pages
 * share one shape and one capability card, and no Live badge exists without an adapter that
 * publishes the capability. The delivery side of Live (the dispatcher) is `built.test.ts`.
 */

/** Claims that are untrue on every page: unpublished packages, the unbuilt CLI and Python SDK, the planned host. */
const UNTRUE = [
  /api\.usedopl\.com/,
  /pip install/,
  /(npm (install|i)|yarn add|pnpm add|bun add) @dopl\//,
  /@dopl\/(client|cli)/,
  /dopl notify/,
];

const OPENAPI = readFileSync(join(process.cwd(), "docs/specs/device-sdk/openapi.yaml"), "utf8");
const NEXT_CONFIG = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
/** Top-level keys under `paths:` (two-space indent), relative to the `/v1` server URL. */
const CONTRACT_PATHS = [...OPENAPI.matchAll(/^ {2}(\/\S+):\s*$/gm)].map((m) => m[1]);
const CONTRACT_RES = CONTRACT_PATHS.map(
  (p) => new RegExp(`^${p.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+")}$`)
);

const G2 = "Even Realities G2";
const G2_CAPS = createEvenG2Adapter()
  .describe({} as never)
  .map((d) => d.capability);

/** Every code sample on a page: code blocks at any depth, capability cards, and the API aside. */
function codeOf(page: DocPage): string[] {
  const walk = (b: DocBlock): string[] => {
    switch (b.type) {
      case "code":
        return b.tabs.map((t) => t.code);
      case "capability":
        return [...b.code, ...b.response].map((t) => t.code);
      case "steps":
        return b.items.flatMap((s) => s.blocks.flatMap(walk));
      case "list":
        return b.items.flatMap((it) => (typeof it === "string" ? [] : (it.blocks ?? []).flatMap(walk)));
      default:
        return [];
    }
  };
  const aside = page.aside ? [...page.aside.request, ...page.aside.responses].map((t) => t.code) : [];
  return [...page.blocks.flatMap(walk), ...aside];
}

/** Page copy as Markdown with fenced code removed. */
function prose(page: DocPage): string {
  return pageToMarkdown(page).replace(/```[\s\S]*?```/g, "");
}

const pathsIn = (text: string) => [...text.matchAll(/\/v1(\/[^\s'"`?)\\]+)/g)].map((m) => m[1]);
const cardsOf = (page: DocPage) => page.blocks.filter((b): b is DocBlock & { type: "capability" } => b.type === "capability");
const categoryPage = (slug: string) => getDocPage(`devices/${slug}`)!;

describe("docs content status", () => {
  it("gives every page a known status", () => {
    for (const page of DOC_PAGES) expect(["live", "beta", "coming_soon"], page.slug).toContain(page.status);
  });

  it("never claims an unpublished package, the planned host or an unbuilt SDK", () => {
    for (const page of DOC_PAGES) {
      const md = pageToMarkdown(page);
      for (const pattern of UNTRUE) expect(md, `${page.slug} matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it("keeps the deployed Device SDK pages in beta and pricing coming soon", () => {
    for (const page of DOC_PAGES.filter((p) => p.section === "api" || /^(concepts|guides)\//.test(p.slug))) {
      expect(page.status, page.slug).toBe("beta");
    }
    for (const slug of ["quickstart", "sdks/typescript", "sdks/project-mcp"]) expect(getDocPage(slug)?.status, slug).toBe("beta");
    expect(getDocPage("sdks/hosted-mcp")?.status).toBe("live");
    expect(getDocPage("pricing")?.status).toBe("coming_soon");
  });

  it("puts the status line in the copied Markdown", () => {
    expect(pageToMarkdown(getDocPage("pricing")!)).toContain("Status: Coming soon");
  });
});

describe("docs structure", () => {
  const links = DOC_SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.links));

  it("points every sidebar row at a page, and lists every page once", () => {
    for (const link of links) expect(statusOf(link.slug), link.slug).toBeDefined();
    expect(new Set(links.map((l) => l.slug)).size).toBe(links.length);
    const listed = new Set(links.map((l) => l.slug));
    for (const page of DOC_PAGES) expect(listed.has(page.slug), page.slug).toBe(true);
  });

  it("puts every page in the section whose sidebar lists it", () => {
    for (const section of DOC_SECTIONS) {
      for (const link of section.groups.flatMap((g) => g.links)) expect(getDocPage(link.slug)?.section, link.slug).toBe(section.id);
    }
  });

  it("points the home cards and lists at pages and sections that exist", () => {
    for (const c of HOME_CARDS) expect(getDocPage(c.slug), c.slug).toBeDefined();
    for (const list of HOME_LISTS) {
      const section = DOC_SECTIONS.find((s) => s.id === list.section)!;
      for (const l of section.groups.flatMap((g) => g.links)) expect(list.icons[l.slug], l.slug).toBeDefined();
    }
  });

  it("links only to pages that exist", () => {
    for (const page of DOC_PAGES) {
      for (const m of pageToMarkdown(page).matchAll(/\]\(\/docs\/([^)#\s]+)/g)) {
        expect(getDocPage(m[1]), `${page.slug} links to ${m[1]}`).toBeDefined();
      }
      for (const b of page.blocks) if (b.type === "cards") for (const c of b.items) expect(getDocPage(c.href), c.href).toBeDefined();
    }
  });

  it("redirects every slug that left the docs to a page that exists", () => {
    const removed = [
      "start-here",
      "use-cases/show",
      "use-cases/ask",
      "use-cases/notify",
      "use-cases/connect-devices",
      "use-cases/routing",
      "devices/even-realities-g2",
      "devices/mentra",
      "devices/meta",
      "devices/meta-ray-ban",
      "devices/google-home",
      "devices/home-assistant",
      "devices/phone",
      "devices/phone-push",
      "devices/apple-watch",
      "devices/desktop",
      "devices/mac-notch",
      "devices/cars",
    ];
    const rules = [...NEXT_CONFIG.matchAll(/\{ source: "\/docs\/([^"]+)", destination: "\/docs\/([^"]+)"/g)].map((m) => ({
      source: new RegExp(`^${m[1].replace(/:\w+\(([^)]+)\)/g, "($1)").replace(/:\w+/g, "[^/]+")}$`),
      destination: m[2],
    }));
    for (const slug of removed) {
      expect(getDocPage(slug), slug).toBeUndefined();
      const rule = rules.find((r) => r.source.test(slug));
      expect(rule, slug).toBeDefined();
      expect(getDocPage(rule!.destination) ?? (rule!.destination === "home" || undefined), `${slug} → ${rule!.destination}`).toBeDefined();
    }
  });
});

describe("docs copy", () => {
  it("writes no em or en dashes", () => {
    for (const page of DOC_PAGES) expect(pageToMarkdown(page), page.slug).not.toMatch(/[–—]/);
  });

  it("uses no spaced hyphen as punctuation in prose", () => {
    for (const page of DOC_PAGES) expect(prose(page), page.slug).not.toMatch(/\S - \S/);
  });

  it("names directions from the agent's side, never bare input and output headings", () => {
    for (const page of DOC_PAGES) {
      for (const b of page.blocks) if (b.type === "h2") expect(b.text, page.slug).not.toMatch(/^(Inputs?|Outputs?)$/);
    }
  });
});

describe("device categories", () => {
  it("lists every category at the top of the Devices section, display glasses and smart home included", () => {
    const devices = DOC_SECTIONS.find((s) => s.id === "devices")!;
    const slugs = devices.groups.flatMap((g) => g.links.map((l) => l.slug));
    expect(slugs).toEqual(["devices", ...CATEGORIES.map((c) => `devices/${c.slug}`)]);
    expect(slugs).toEqual(expect.arrayContaining(["devices/display-glasses", "devices/smart-home"]));
    expect(DOC_SECTIONS.findIndex((s) => s.id === "devices")).toBeLessThan(DOC_SECTIONS.findIndex((s) => s.id === "core"));
  });

  it("gives every category the same shape: models, then receives, then sends", () => {
    for (const c of CATEGORIES) {
      const h2 = categoryPage(c.slug).blocks.flatMap((b) => (b.type === "h2" ? [b.text] : []));
      expect(h2, c.slug).toEqual(["Models", "What your agent receives", "What your agent can send"]);
      expect(categoryPage(c.slug).blocks.some((b) => b.type === "support"), c.slug).toBe(true);
    }
  });

  it("uses one card shape for every capability, with contract ids and tiers", () => {
    const keys = (c: CapabilityCard) => Object.keys(c).sort().join(",");
    const all = CATEGORIES.flatMap((c) => cardsOf(categoryPage(c.slug)));
    expect(all.length).toBeGreaterThan(20);
    const shape = keys(all[0]);
    for (const card of all) {
      expect(keys(card), card.title).toBe(shape);
      expect(CAPABILITY_IDS, card.capability).toContain(card.capability);
      expect(card.tier, card.capability).toBe(CAPABILITY_RISK_TIER[card.capability as CapabilityId]);
      expect(card.limits.length, card.title).toBeGreaterThan(0);
      expect(card.support.length, card.title).toBeGreaterThan(0);
      expect(card.response.length, card.title).toBeGreaterThan(0);
      const labels = card.code.map((t) => t.label);
      expect(labels, card.title).toEqual(card.capability.startsWith("input.") ? ["Planned"] : ["TypeScript", "cURL"]);
    }
  });

  it("badges Live only where the adapter publishes the capability, and only on Even G2", () => {
    for (const c of CATEGORIES) {
      for (const card of cardsOf(categoryPage(c.slug))) {
        for (const m of card.support.filter((s) => s.status === "live")) {
          expect(m.model, `${c.slug} ${card.capability}`).toBe(G2);
          expect(G2_CAPS, card.capability).toContain(card.capability);
          expect(card.capability.startsWith("input."), card.capability).toBe(false);
        }
      }
    }
    const liveG2 = cardsOf(categoryPage("display-glasses")).filter((card) => card.support.some((s) => s.model === G2 && s.status === "live"));
    expect([...new Set(liveG2.map((c) => c.capability))].sort()).toEqual(G2_CAPS.filter((c) => !c.startsWith("input.")).sort());
    expect(categoryPage("display-glasses").status).toBe("live");
    for (const c of CATEGORIES.filter((x) => x.slug !== "display-glasses")) expect(categoryPage(c.slug).status, c.slug).toBe("coming_soon");
  });

  it("shows Google Home in smart home, output only and not live", () => {
    const page = categoryPage("smart-home");
    const cards = cardsOf(page);
    const gh = cards.filter((card) => card.support.some((s) => s.model === "Google Home"));
    expect(gh.length).toBeGreaterThan(0);
    for (const card of gh) for (const s of card.support.filter((x) => x.model === "Google Home")) expect(s.status).toBe("coming_soon");
    const receives = CATEGORIES.find((c) => c.slug === "smart-home")!.receives;
    for (const spec of receives) expect(spec.support.map((s) => s.model)).not.toContain("Google Home");
    expect(pageToMarkdown(page)).toMatch(/Google Home is output only/);
  });

  it("runs every planned category's calls against a simulated device of its kind", () => {
    const sim = createSimulatorAdapter();
    for (const c of CATEGORIES) {
      const caps = new Set(c.kinds.flatMap((kind) => sim.describe({ kind } as Device).map((d) => d.capability)));
      for (const spec of [...c.receives, ...c.sends].filter((s) => s.call !== "event" && s.call !== "answer" && s.call !== "device")) {
        expect(caps.has(spec.capability), `${c.slug} ${spec.capability}`).toBe(true);
      }
    }
  });
});

describe("docs against the frozen contracts", () => {
  it("reads the contract's paths", () => {
    expect(CONTRACT_PATHS).toContain("/users/{external_user_id}/deliver");
    expect(CONTRACT_PATHS.length).toBeGreaterThanOrEqual(9);
  });

  it("only uses /v1 paths that exist in openapi.yaml, in prose and in code", () => {
    let seen = 0;
    for (const page of DOC_PAGES) {
      for (const text of [pageToMarkdown(page), ...codeOf(page)]) {
        for (const path of pathsIn(text)) {
          seen += 1;
          expect(
            CONTRACT_RES.some((re) => re.test(path)),
            `${page.slug} uses /v1${path}, which is not in openapi.yaml`
          ).toBe(true);
        }
      }
    }
    expect(seen).toBeGreaterThan(40);
  });

  it("has an API reference page for every contract path", () => {
    const documented = DOC_PAGES.flatMap((p) => p.blocks.flatMap((b) => (b.type === "endpoint" ? [b.path] : [])));
    for (const path of CONTRACT_PATHS) expect(documented, path).toContain(`/v1${path}`);
    expect(documented.join(" ")).not.toMatch(/\/(show|ask|notify|endpoints)\b/);
  });

  it("states every capability's default tier as the contracts do", () => {
    const stated = CAPABILITY_ROWS.flatMap(([, ids, tier]) => ids.map((id) => [id, tier] as const));
    expect(stated.map(([id]) => id).sort()).toEqual([...CAPABILITY_IDS].sort());
    for (const [id, tier] of stated) expect(tier, id).toBe(CAPABILITY_RISK_TIER[id as keyof typeof CAPABILITY_RISK_TIER]);
  });

  it("lists every error code with its contract status, type and retry flag", () => {
    expect(ERROR_ROWS.map(([code]) => code).sort()).toEqual(Object.keys(ERROR_CODE_INFO).sort());
    for (const [code, status, type, retryable] of ERROR_ROWS) {
      const info = ERROR_CODE_INFO[code as keyof typeof ERROR_CODE_INFO];
      expect({ status, type, retryable }, code).toEqual({ status: info.status, type: info.type, retryable: info.retryable });
    }
  });

  it("shows a context profile the contract accepts", () => {
    expect(ContextProfileSchema.safeParse(AR_GLASSES_PROFILE).success).toBe(true);
  });
});
