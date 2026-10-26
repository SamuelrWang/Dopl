// The Activity rail's LAYOUT and CARD invariants (item 8, 2026-10-24: identities 3/4 left, Activity
// 1/4 right, one small white card per running agent).
//
// Source reads, not renders: jsdom performs no layout, so a rendered assertion about column widths
// would be theatre. The geometry was measured in a real engine (PORTING.md › Item 8); what is pinned
// here is the rule that geometry follows, plus the fixture widths it depends on.
import { describe, expect, it } from "vitest";
import { readCode, readSource } from "@/shared/testing/source-text";
import { SEED_IDENTITIES } from "../data";
import { activeEverywhere, pageFeed } from "./identity-page-data";
import { AGENT_COLOR_KEYS } from "@/shared/lib/agent-colors";
import { agentColorKey } from "./identity-activity-panel";

const PANEL = readCode(new URL("./identity-activity-panel.tsx", import.meta.url));
const PANELS = readCode(new URL("../home/identity-panels.tsx", import.meta.url));
// ⚠ The layout and card faces are hand-written CSS, not Tailwind: the dev server compiles only
// the utilities that existed when it booted. Asserting on the TSX alone pins the wrong artifact.
// Read RAW (the block's marker is a comment), then strip comments so prose about selectors can
// neither satisfy nor fail a check.
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const RAW_CSS = readSource(new URL("../../ui-staging/staging.css", import.meta.url));
const MARKER = RAW_CSS.indexOf("THE IDENTITIES PAGE RAIL");
const CSS = stripComments(RAW_CSS);
const RULES = stripComments(RAW_CSS.slice(RAW_CSS.lastIndexOf("/*", MARKER)));

/** Just the `@container` block, up to its own top-level closing brace. */
function containerBlock(): string {
  const start = RULES.indexOf("@container");
  return RULES.slice(start, RULES.indexOf("\n}\n", start) + 2);
}

describe("the page is two columns: identities 3/4, Activity 1/4", () => {
  it("the panels file puts the identities in the main column and Activity in the aside, after it", () => {
    const main = PANELS.indexOf('className="uis-idp-main"');
    const aside = PANELS.indexOf('className="uis-idp-aside"');
    const activity = PANELS.indexOf("<IdentityActivityPanel");
    expect(main).toBeGreaterThan(-1);
    expect(aside).toBeGreaterThan(main);
    expect(activity).toBeGreaterThan(aside);
    // Every left-side section is still mounted, before the rail.
    for (const piece of ["<IdentityPageHead", "<IdentityControls", "<SharedIdentitySection", "<PrivateIdentitySection"]) {
      const at = PANELS.indexOf(piece);
      expect(at, piece).toBeGreaterThan(main);
      expect(at, piece).toBeLessThan(aside);
    }
  });

  it("finds the rail block in staging.css", () => {
    expect(MARKER).toBeGreaterThan(-1);
  });

  it("splits 3fr | 1fr at a pane-width container query, and stacks below it", () => {
    expect(RULES).toContain("container-type: inline-size");
    expect(RULES).toContain("@container (min-width: 760px)");
    expect(RULES).toContain("grid-template-columns: minmax(0, 3fr) minmax(0, 1fr)");
  });

  it("switches a CHILD of the container, never the container itself", () => {
    // A container query cannot style its own container: the first version did, and stayed one column.
    const query = containerBlock();
    expect(query).not.toMatch(/\.uis-idp-layout\s*\{/);
    expect(query).toMatch(/\.uis-idp-cols\s*\{[^}]*display: grid/);
  });

  it("gives each column its own scroll in the two-column form", () => {
    const query = containerBlock();
    expect(query).toMatch(/\.uis-idp-aside\s*\{[^}]*overflow-y: auto/);
  });

  it("scopes every rule to .uis-window (staging.css is global to every playground route)", () => {
    const selectors = RULES.match(/^[^{}@]+(?=\{)/gm) ?? [];
    expect(selectors.length).toBeGreaterThan(5);
    for (const sel of selectors) {
      for (const part of sel.split(",")) expect(part.trim(), part).toMatch(/^\.uis-window /);
    }
  });

  it("retires item 7's six-column event grid, which a quarter rail cannot hold", () => {
    expect(CSS).not.toContain("uis-idp-act-");
    expect(PANEL).not.toContain("uis-idp-act-");
    expect(PANEL).not.toContain("grid-cols-");
    expect(PANEL).not.toContain("col-span-");
  });
});

describe("one compact white card per running agent", () => {
  it("is the DESIGN-LANGUAGE agent card face: white, hairline, 12px, the one soft shadow", () => {
    const card = RULES.slice(RULES.indexOf(".uis-window .uis-idp-run {"));
    const decl = card.slice(0, card.indexOf("}"));
    expect(decl).toContain("background: #ffffff");
    expect(decl).toContain("border: 1px solid var(--border-default)");
    expect(decl).toContain("border-radius: 12px");
    expect(decl).toContain("box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 6px 16px rgba(0, 0, 0, 0.04)");
  });

  it("rings the run face in the agent's colour, and the status pill's dot is green only when working", () => {
    expect(PANEL).toContain("ring={agentColorKey(run.agent)}");
    expect(PANEL).toMatch(/state === "working" \? "bg-success"/);
  });

  it("does not print the channel (Samuel: it does not need to say what channel it is in)", () => {
    const card = PANEL.slice(PANEL.indexOf("function RunCard"), PANEL.indexOf("export function agentColorKey"));
    expect(card).not.toContain("run.channel");
    expect(card).toContain("run.thread");
  });

  it("derives a stable agent colour key from the bank", () => {
    for (const run of activeEverywhere(SEED_IDENTITIES)) {
      const key = agentColorKey(run.agent);
      expect(AGENT_COLOR_KEYS).toContain(key);
      expect(agentColorKey(run.agent)).toBe(key);
    }
  });
});

describe("the fixtures fit the rail without truncating a name", () => {
  // Measured 2026-10-24 at a 1440px staging window: card 211px, name track 118–125px. At
  // `--text-small` 600 that is ~16 characters; a longer fixture name should fail HERE first.
  const NAME_BUDGET_CHARS = 16;

  it("Active now — every running agent's name is inside the card's name track", () => {
    const runs = activeEverywhere(SEED_IDENTITIES);
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) expect(run.agent.length, run.agent).toBeLessThanOrEqual(NAME_BUDGET_CHARS);
  });

  it("Recent — has rows to show, each with a sentence", () => {
    const rows = pageFeed(SEED_IDENTITIES, 50);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.did.length).toBeGreaterThan(0);
  });
});

describe("item 9: all white, no wells, a grey chip behind each section title", () => {
  const WHITE = RULES.slice(RULES.indexOf(".uis-window .uis-idp-layout {\n  background"));

  it("paints the pane white", () => {
    expect(WHITE).toMatch(/\.uis-idp-layout\s*\{\s*background: #ffffff/);
  });

  it("strips every SectionPanel well on this page, hooked on the kit's own attribute", () => {
    const rule = WHITE.slice(WHITE.indexOf(".uis-window .uis-idp-layout [data-section-panel] {"));
    const decl = rule.slice(0, rule.indexOf("}"));
    expect(decl).toContain("background: transparent");
    expect(decl).toContain("padding: 0");
  });

  it("puts the grey on the title only: a snug chip, padding on a content-width h2", () => {
    const rule = WHITE.slice(WHITE.indexOf("[data-section-panel] > div:first-child > h2 {"));
    const decl = rule.slice(0, rule.indexOf("}"));
    expect(decl).toContain("background: #f5f5f5");
    expect(decl).toContain("border-radius: 8px");
    // Never a full-width bar.
    expect(decl).not.toContain("width");
    expect(decl).not.toContain("display: block");
  });

  it("separates sections by the column gap now the wells are gone", () => {
    expect(WHITE).toMatch(/\.uis-idp-aside\s*\{\s*gap: 28px/);
  });
});

