import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomePageSkeleton } from "#/pages/home/home-skeleton";
import {
  HomeAgentPanelsSkeleton,
  HomeKnowledgePanelsSkeleton,
} from "#/pages/home/home-skeleton";
import { OverviewSkeleton } from "#/pages/overview/overview-skeleton";
import { ChannelsSkeleton } from "#/pages/channels/channels-skeleton";
import { AgentsPageSkeleton } from "#/pages/agents/agents-skeleton";
import { MembersPageSkeleton } from "#/pages/members/members-skeleton";
import {
  KnowledgeBaseSkeleton,
  KnowledgeHomeSkeleton,
} from "./knowledge-skeletons";

/**
 * THE POINT OF THESE SKELETONS IS THAT THEY MATCH THE PAGE (Samuel, 2026-08-28:
 * the generic ghosts were "way off"). So two kinds of assertion, and the second
 * is the one that keeps them true:
 *
 *   1. RENDER — each shape announces itself, paints blocks and no text.
 *   2. SOURCE — the geometry a skeleton shares with its page is the SAME
 *      EXPRESSION in both files. A skeleton that re-typed `290px` or
 *      `repeat(3, minmax(0, 1fr))` would drift the first time the page's grid
 *      was re-tuned, and drift silently: nothing renders wrong, it just stops
 *      being the page's shape. `readFileSync` over source, not an import,
 *      because a Tailwind arbitrary value is a STRING and a CSS-module class is
 *      a build artifact — neither is comparable any other way.
 */

const file = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/**
 * Source with comments removed. ⚠ NOT COSMETIC: these files EXPLAIN what they
 * replaced and why ("it was `PageLoading`", "the 232px rail"), so a scan over
 * raw text would fail on the very docblock that records the decision — and the
 * repair would be deleting the explanation. Block comments plus whole-line `//`
 * only; a trailing comment is left alone, which is safe because nothing pinned
 * below is ever written as one.
 */
const code = (rel: string) =>
  file(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const HOME_SKELETON = file("../../pages/home/home-skeleton.tsx");
const AGENTS_SKELETON = file("../../pages/agents/agents-skeleton.tsx");
const OVERVIEW_SKELETON = file("../../pages/overview/overview-skeleton.tsx");
const CHANNELS_SKELETON = file("../../pages/channels/channels-skeleton.tsx");
const MEMBERS_SKELETON = file("../../pages/members/members-skeleton.tsx");
const KNOWLEDGE_SKELETONS = file("./knowledge-skeletons.tsx");

/** A file in the SHARED tree (`src/`), which is where four of these pages live. */
const shared = (rel: string) => file(`../../../../../src/${rel}`);

function ghosts(container: HTMLElement) {
  return container.querySelectorAll('[data-slot="skeleton"]');
}

/** Every visible string on the surface. A skeleton's only text is `sr-only`. */
function visibleText(container: HTMLElement) {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".sr-only").forEach((node) => node.remove());
  return clone.textContent?.trim() ?? "";
}

const SHAPES = [
  ["home page", <HomePageSkeleton key="h" label="Opening home" />],
  [
    "home knowledge face",
    <HomeKnowledgePanelsSkeleton key="hk" label="Loading knowledge" />,
  ],
  ["home agents face", <HomeAgentPanelsSkeleton key="ha" label="Loading agents" />],
  ["opened knowledge base", <KnowledgeBaseSkeleton key="kb" label="Loading base" />],
  ["knowledge root", <KnowledgeHomeSkeleton key="kh" label="Loading knowledge" />],
  ["overview", <OverviewSkeleton key="o" label="Loading overview" />],
  ["channels", <ChannelsSkeleton key="c" label="Loading channels" />],
  ["agents page", <AgentsPageSkeleton key="a" label="Loading agents" />],
  ["members page", <MembersPageSkeleton key="m" label="Loading members" />],
] as const;

describe("every per-page skeleton", () => {
  it.each(SHAPES)("%s announces itself and paints a shape, not copy", (_name, el) => {
    const { container } = render(el);
    const status = container.querySelector('[role="status"]');

    expect(status).not.toBeNull();
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".sr-only")?.textContent).toBeTruthy();
    expect(visibleText(container)).toBe("");
    expect(ghosts(container).length).toBeGreaterThan(5);
  });

  it.each(SHAPES)("%s composes the ONE pulse recipe, never a local clone", (_n, el) => {
    const { container } = render(el);
    // Every animated block is the kit atom: as many `animate-pulse` nodes as
    // there are `data-slot="skeleton"` nodes, and each one hidden from readers.
    const pulses = container.querySelectorAll(".animate-pulse");
    expect(pulses.length).toBe(ghosts(container).length);
    ghosts(container).forEach((node) => {
      expect(node).toHaveAttribute("aria-hidden", "true");
    });
  });

  it.each(SHAPES)("%s stands inside the reduced-motion surface", (_n, el) => {
    // ⚠ The opt-out is a scoped rule keyed on the surface class
    // (`skeletons.module.css`); the CSS never runs in jsdom, so what is pinned
    // here is that the class is ON the announcing element — the only thing this
    // suite can know, and the thing a refactor would drop.
    const { container } = render(el);
    const status = container.querySelector('[role="status"]');
    expect(status?.className).toMatch(/surface/);
  });
});

describe("the /home shapes are /home's own geometry", () => {
  it("sizes the list column and indents the header from ONE width var", () => {
    const { container } = render(<HomePageSkeleton />);
    expect(container.querySelector(".w-\\[var\\(--home-list-w\\)\\]")).not.toBeNull();
    expect(container.querySelector(".pl-\\[var\\(--home-list-w\\)\\]")).not.toBeNull();
    // The generic page ghost's giveaway — a centred document column /home has
    // never had.
    expect(container.querySelector(".max-w-\\[960px\\]")).toBeNull();
  });

  it("draws the record pane as a bordered column, not a floating card", () => {
    const { container } = render(<HomePageSkeleton />);
    expect(container.querySelector(".border-home-panel-line")).not.toBeNull();
    expect(container.querySelector(".bento")).toBeNull();
  });

  it("ghosts the three-face selector without offering anything to press", () => {
    const { container } = render(<HomePageSkeleton />);
    expect(container.querySelector(".seg-track")).not.toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("keeps both faces on the panel hook the record pane repaints through", () => {
    for (const el of [
      <HomeKnowledgePanelsSkeleton key="k" />,
      <HomeAgentPanelsSkeleton key="a" />,
    ]) {
      const { container } = render(el);
      expect(container.querySelectorAll("[data-section-panel]")).toHaveLength(2);
    }
  });
});

describe("skeleton grids REUSE the real page's grid, they do not restate it", () => {
  /**
   * ⚠ THE HOME KNOWLEDGE GRID IS `home.module.css › .kbCards` ITSELF. That rule
   * owns the 3 columns, the 224px row height, the 14px gap and the 1080px
   * step-down, plus the `--kv-*` rebinds the card reads. Restating any of it in
   * the skeleton is the drift this pins.
   */
  it("the /home Knowledge ghost mounts the page's own .kbCards", () => {
    const page = file("../../pages/home/knowledge-panels.tsx");
    expect(page).toContain("home.kbCards");
    expect(HOME_SKELETON).toContain("home.kbCards");

    const { container } = render(<HomeKnowledgePanelsSkeleton />);
    expect(container.querySelectorAll('[class*="kbCards"]').length).toBe(2);
    expect(container.querySelectorAll('[class*="kbCell"]').length).toBeGreaterThan(0);
  });

  /**
   * ⚠ A TAILWIND ARBITRARY VALUE CANNOT BE IMPORTED, so the agents grid is one
   * copied string in two skeletons — and this is what keeps the copy honest.
   */
  it("the Agents ghosts carry TemplateGrid's grid class verbatim", () => {
    const TEMPLATE_GRID =
      "grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-2.5";
    const section = file(
      "../../../../../src/features/agent-templates/components/template-section.tsx"
    );

    expect(section).toContain(TEMPLATE_GRID);
    expect(HOME_SKELETON).toContain(TEMPLATE_GRID);
    expect(AGENTS_SKELETON).toContain(TEMPLATE_GRID);
  });

  /**
   * ⚠ BOTH KNOWLEDGE SHAPES READ THE VIEW'S OWN MODULE — `.cardGrid` (3×244px),
   * `.baseHead` (52px), `.rail` (232px), `.detailPane`. No number from that
   * module is retyped here, so the ghost follows a re-tune of the real view.
   */
  it("the knowledge ghosts mount knowledge-v2's own classes", () => {
    expect(KNOWLEDGE_SKELETONS).toContain(
      'from "@/features/knowledge/components/knowledge-v2/knowledge-v2.module.css"'
    );
    for (const cls of [
      "kv.cardGrid",
      "kv.baseHead",
      "kv.rail",
      "kv.detailPane",
      // The info face's own scroll body — 12px gap, 12px pad. The ghost carried
      // `px-6 pt-6 gap-5` (the PRE-2026-08-28 document face) until 2026-08-30.
      "kv.infoBody",
    ]) {
      expect(KNOWLEDGE_SKELETONS).toContain(cls);
    }
    // …and nothing re-states the geometry those rules own.
    const body = code("./knowledge-skeletons.tsx");
    expect(body).not.toContain("232px");
    expect(body).not.toContain("244px");
  });

  /**
   * ⚠ THE OPENED BASE'S TWO SECTIONS ARE WELLS, and the level decides the face:
   * they are drawn inside the shell's white `.pageCard` (or /home's record
   * pane), so they take `SECTION_PANEL_GROUND` exactly as `detail/meta-card.tsx`
   * and `detail/overview-contents.tsx` do. Flat shimmer blocks resolved into a
   * gray panel appearing under the reader.
   */
  it("the opened-base ghost grounds its info sections as SECTION_PANEL wells", () => {
    expect(KNOWLEDGE_SKELETONS).toContain("SECTION_PANEL_GROUND");
    expect(
      shared("features/knowledge/components/knowledge-v2/detail/meta-card.tsx")
    ).toContain("SECTION_PANEL_GROUND");

    const { container } = render(<KnowledgeBaseSkeleton />);
    expect(container.querySelectorAll("[data-section-panel]")).toHaveLength(2);
  });

  /**
   * ⚠ THE OVERVIEW GHOST IS FOUR TAILWIND STRINGS THE PAGE ALREADY OWNS, and
   * none of them can be imported: three are arbitrary values or grid templates
   * typed inline in the modules, the fourth is the plot-height constant. So the
   * pin is a byte-share, module by module. Re-tune the real grid and this fails
   * on the same commit rather than on screen three weeks later.
   */
  it("the overview ghost byte-shares the page's own grids and column", () => {
    const page = file("../../pages/overview/index.tsx");
    const stats = file("../../pages/overview/stat-cards.tsx");
    const period = file("../../pages/overview/period-stats.tsx");
    const chart = file("../../pages/overview/activity-chart.tsx");

    for (const [source, geometry] of [
      // The centred column and its scroll box.
      [page, "mx-auto flex max-w-5xl flex-col gap-4"],
      [page, "px-6 pt-6 pb-10"],
      // The uneven bottom row — 48/52, not two halves.
      [page, "grid grid-cols-[48fr_52fr] gap-3"],
      // Four equal stat cards.
      [stats, "grid grid-cols-4 gap-3"],
      // The period group's inset well, and the two cards inside it.
      [period, "rounded-[14px] border border-border-default bg-bg-inset p-3.5"],
      [period, "mt-3 grid grid-cols-2 gap-3"],
    ] as const) {
      expect(source).toContain(geometry);
      expect(OVERVIEW_SKELETON).toContain(geometry);
    }

    // The plot is `activity-chart.tsx`'s own height constant, not a guess.
    expect(chart).toContain('const PLOT_HEIGHT_CLASS = "h-40"');
    expect(OVERVIEW_SKELETON).toContain("h-40 ");
  });

  /**
   * ⚠ THE CHANNELS GHOST IS THE SURFACE'S OWN COLUMN AND ROW METRICS. The
   * composer offset is the one piece that CAN be imported — `COMPOSER_BOTTOM`
   * exists precisely because the channel and agent composers must sit at one
   * height — so the ghost imports it and the rest is byte-shared.
   */
  it("the channels ghost byte-shares the surface's columns, rows and composer", () => {
    const sidebar = shared("features/channels/components/channels-v2/sidebar.tsx");
    const rows = shared("features/channels/components/channels-v2/sidebar-rows.tsx");
    const header = shared("features/channels/components/channels-v2/bits.tsx");
    const pane = shared("features/channels/components/channels-v2/message-pane.tsx");
    const composer = shared("features/channels/components/channels-v2/composer.tsx");

    for (const [source, geometry] of [
      [sidebar, "flex w-[260px] shrink-0 flex-col border-r border-border-default"],
      [sidebar, "flex h-[52px] shrink-0 items-center gap-2 px-3"],
      [sidebar, "flex flex-col gap-px px-2"],
      // The section header's strip — `pt-3`, not the `pt-4` this ghost carried.
      [header, "flex items-center gap-1 px-3 pb-1 pt-3"],
      [pane, "flex h-[56px] shrink-0 items-center gap-1.5 border-b border-border-default px-4"],
      [pane, "px-8 py-5"],
      // The composer CARD — and it takes no row gap of its own.
      [composer, "raised-tab flex flex-col rounded-[14px] px-[13px] py-[11px]"],
      [composer, 'cn("relative shrink-0 px-4 pt-1", COMPOSER_BOTTOM)'],
    ] as const) {
      expect(source).toContain(geometry);
      expect(CHANNELS_SKELETON).toContain(geometry);
    }

    // One row shell, one height, one indent pair.
    expect(rows).toContain("h-[36px]");
    expect(rows).toContain('const DEPTH_PAD = ["pl-2", "pl-5"]');
    expect(CHANNELS_SKELETON).toContain("h-[36px]");
    expect(CHANNELS_SKELETON).toContain('indented ? "pl-5" : "pl-2"');
    // The offset is IMPORTED, never retyped.
    expect(CHANNELS_SKELETON).toContain("COMPOSER_BOTTOM");
    expect(code("../../pages/channels/channels-skeleton.tsx")).not.toContain("pb-4");
  });

  /**
   * ⚠ THE MEMBERS GHOST IS A GRID CELL, NOT A FIXED LIST WIDTH — which is the
   * whole difference between it and the `TwoPaneListSkeleton` it replaced, and
   * the reason the template is pinned rather than reviewed. The roster cards
   * mount `SECTION_CARD` itself, so their face cannot drift at all.
   */
  it("the members ghost mounts the page's grid template and SECTION_CARD", () => {
    const view = shared("features/members/components/members-v2/members-v2-view.tsx");
    const GRID =
      "page-float grid grid-cols-[minmax(380px,42fr)_minmax(0,58fr)] antialiased";

    expect(view).toContain(GRID);
    expect(MEMBERS_SKELETON).toContain(GRID);

    expect(MEMBERS_SKELETON).toContain(
      'from "@/features/members/components/members-v2/bits"'
    );
    expect(MEMBERS_SKELETON).toContain("SECTION_CARD");
    // The generic ghost's giveaways — a fixed list width and a document measure.
    const body = code("../../pages/members/members-skeleton.tsx");
    expect(body).not.toContain("372");
    expect(body).not.toContain("max-w-[760px]");
  });

  it("the knowledge ghosts keep the two dividers /home's .frame selects on", () => {
    const { container } = render(<KnowledgeBaseSkeleton />);
    expect(container.querySelector(".border-b.border-border-default")).not.toBeNull();
    expect(container.querySelector(".border-l.border-border-default")).not.toBeNull();
  });

  it("drops the page float on an embedded mount — no panel on a panel", () => {
    const { container: floated } = render(<KnowledgeBaseSkeleton />);
    const { container: embedded } = render(<KnowledgeBaseSkeleton embedded />);
    expect(floated.querySelector(".page-float")).not.toBeNull();
    expect(embedded.querySelector(".page-float")).toBeNull();
  });
});

describe("the wrong ghosts are gone, and only those", () => {
  const PAGES = [
    "../../pages/home/index.tsx",
    "../../pages/home/knowledge-panels.tsx",
    "../../pages/home/agent-panels.tsx",
    "../../pages/home/knowledge-base-view.tsx",
    "../../pages/overview/index.tsx",
    "../../pages/channels/index.tsx",
    "../../pages/agents/index.tsx",
    "../../pages/knowledge/index.tsx",
    "../../pages/members/index.tsx",
  ];

  it.each(PAGES)("%s loads through its own shape, not PageLoading", (rel) => {
    expect(code(rel)).not.toContain("PageLoading");
  });

  /**
   * ⚠ AND IT IS THE SHAPE FOR *THAT* SURFACE. Losing `PageLoading` is half the
   * change; the other half is that each gate now names the skeleton built from
   * its own layout, so a copy-paste of the wrong one is caught here rather than
   * on screen.
   */
  it.each([
    ["../../pages/home/index.tsx", "HomePageSkeleton"],
    ["../../pages/home/knowledge-panels.tsx", "HomeKnowledgePanelsSkeleton"],
    ["../../pages/home/agent-panels.tsx", "HomeAgentPanelsSkeleton"],
    ["../../pages/home/knowledge-base-view.tsx", "KnowledgeBaseSkeleton"],
    ["../../pages/overview/index.tsx", "OverviewSkeleton"],
    ["../../pages/channels/index.tsx", "ChannelsSkeleton"],
    ["../../pages/agents/index.tsx", "AgentsPageSkeleton"],
    ["../../pages/knowledge/index.tsx", "KnowledgeHomeSkeleton"],
    ["../../pages/members/index.tsx", "MembersPageSkeleton"],
  ])("%s mounts %s", (rel, symbol) => {
    expect(code(rel)).toContain(`<${symbol}`);
  });

  /**
   * ⚠ /agents HAS TWO GATES AND ONE SHAPE (2026-08-28). The workspace resolve
   * is this package's; the template read belongs to `agent-templates-core.tsx`,
   * which is Next-free and cannot import from here — so the seam passes its
   * shape down a SLOT. Without this the second frame reverted to the shared
   * page ghost and the page swapped skeletons mid-load.
   */
  it("hands the agents core the SAME shape its page gate paints", () => {
    const page = code("../../pages/agents/index.tsx");
    expect(page).toContain("loadingSkeleton={<AgentsPageSkeleton");

    const core = code(
      "../../../../../src/features/agent-templates/components/agent-templates-core.tsx"
    );
    expect(core).toContain("loadingSkeleton");
    // ⚠ AND THE WEB TREE IS UNCHANGED: a host that passes nothing still gets
    // the shared ghost. The slot is additive, never a removal.
    expect(core).toContain("<PageShellSkeleton label=\"Loading agents\" />");
  });

  /**
   * ⚠ /members HAS TWO GATES AND ONE SHAPE (2026-08-30), for the reason /agents
   * does: the workspace resolve is this package's, the roster read belongs to
   * `members-v2-view.tsx` in the shared tree, and that file cannot import from
   * here. Without the slot the second frame reverted to `TwoPaneListSkeleton`
   * and the page swapped skeletons mid-load.
   */
  it("hands the members view the SAME shape its page gate paints", () => {
    const page = code("../../pages/members/index.tsx");
    expect(page).toContain("loadingSkeleton={<MembersPageSkeleton");

    const view = code(
      "../../../../../src/features/members/components/members-v2/members-v2-view.tsx"
    );
    expect(view).toContain("loadingSkeleton");
    // ⚠ ADDITIVE, NEVER A REMOVAL: a host that passes nothing keeps the shared
    // ghost, so the shared tree's other future mounts are unchanged.
    expect(view).toContain("<TwoPaneListSkeleton");
  });

  /** The knowledge page is TWO surfaces at one route, and it ghosts both. */
  it("the knowledge page keeps a shape per mode", () => {
    const page = code("../../pages/knowledge/index.tsx");
    expect(page).toContain("<KnowledgeHomeSkeleton");
    expect(page).toContain("<KnowledgeBaseSkeleton");
  });

  /**
   * ⚠ REPLACE THE WRONG ONES, DO NOT MULTIPLY THEM. `PageLoading` is still THE
   * loading state of every page that has no shape of its own (settings, boot,
   * the pop-out windows, onboarding, chats, skills, ontology) — a skeleton wave
   * that left it unused would have been a wave that quietly grew a per-page
   * spinner everywhere. ⚠ **MEMBERS LEFT THIS LIST ON 2026-08-30** and is
   * asserted in `PAGES` above instead; it is the only move, so re-derive the
   * rest rather than inheriting them:
   * `grep -rln PageLoading apps/desktop-ui/src/pages`.
   */
  it("leaves PageLoading standing for the pages that share one shape", () => {
    for (const rel of [
      "../../pages/settings/index.tsx",
      "../../pages/boot/index.tsx",
      "../../pages/chats/index.tsx",
      "../../pages/skills/index.tsx",
      "../../pages/ontology/index.tsx",
    ]) {
      expect(code(rel)).toContain("PageLoading");
    }
  });
});
