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
const KNOWLEDGE_SKELETONS = file("./knowledge-skeletons.tsx");

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
    for (const cls of ["kv.cardGrid", "kv.baseHead", "kv.rail", "kv.detailPane"]) {
      expect(KNOWLEDGE_SKELETONS).toContain(cls);
    }
    // …and nothing re-states the geometry those rules own.
    const body = code("./knowledge-skeletons.tsx");
    expect(body).not.toContain("232px");
    expect(body).not.toContain("244px");
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

  /** The knowledge page is TWO surfaces at one route, and it ghosts both. */
  it("the knowledge page keeps a shape per mode", () => {
    const page = code("../../pages/knowledge/index.tsx");
    expect(page).toContain("<KnowledgeHomeSkeleton");
    expect(page).toContain("<KnowledgeBaseSkeleton");
  });

  /**
   * ⚠ REPLACE THE WRONG ONES, DO NOT MULTIPLY THEM. `PageLoading` is still THE
   * loading state of every page that has no shape of its own (settings, boot,
   * the pop-out windows, onboarding, chats, members, skills, ontology) — a
   * skeleton wave that left it unused would have been a wave that quietly
   * grew a per-page spinner everywhere.
   */
  it("leaves PageLoading standing for the pages that share one shape", () => {
    expect(code("../../pages/settings/index.tsx")).toContain("PageLoading");
    expect(code("../../pages/boot/index.tsx")).toContain("PageLoading");
  });
});
