// @vitest-environment jsdom
/**
 * The hero demo's record pane is the product's UI, not a look-alike.
 *
 * This suite is not "the demo renders". The scene it replaced looked right the day
 * it was written and was a year of rulings behind by the time anyone noticed —
 * something no screenshot and no render test can catch. So every case pins the
 * scene to a SHARED DECLARATION, the same constant or component the SPA page
 * renders, and fails when the demo grows a copy of one instead.
 *
 * Bidirectional where it matters: deleted things are asserted ABSENT, because a
 * suite that only checks what is present passes on a scene that grew the old
 * chrome back beside the new.
 */

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { PAGE_ACTION_BTN } from "@/shared/ui/page-action-button";
import { HOME_CHANNEL_WELLS } from "@/features/channels/components/home-channel-wells";
import { DemoScene } from "./demo-scene";
import { HOME_ROW_ID, homeRowsAt } from "./demo-home-rows";
import { stepIndex, type StepId } from "./demo-steps";
import {
  messagesAt,
} from "./demo-transcript";

const ROWS_SRC = "src/features/marketing/components/banner-demo/demo-home-rows.ts";

/** The scene at its last beat, where every row and every mark is on stage. */
const rows = () => homeRowsAt(stepIndex("hold"));

afterEach(cleanup);

describe("the demo's channel rows", () => {
  it("🚫 no row carries a last-message preview, and none has a leading glyph", () => {
    for (const row of rows()) {
      expect(Object.keys(row)).not.toContain("lastLine");
      expect(Object.keys(row)).not.toContain("subline");
    }
    // A channel is not a DM and must not be dressed as one.
    expect(readFileSync(ROWS_SRC, "utf8")).not.toContain("Bot");
  });

  it("🔒 files every row into a well the product's own set declares", () => {
    const ids = new Set(HOME_CHANNEL_WELLS.map((well) => well.id));
    for (const row of rows()) expect(ids.has(row.well)).toBe(true);
  });
});

describe("the column tracks the scripted conversation", () => {
  it("🔒 stamps the live row with the transcript's newest message", () => {
    const step = stepIndex("split-2");
    const script = messagesAt(step);
    const live = homeRowsAt(step).find((row) => row.id === HOME_ROW_ID);
    expect(live?.at).toBe(script[script.length - 1]?.createdAt);
    // Only the live row moves — nothing is happening in the others.
    const early = homeRowsAt(stepIndex("channel-base"));
    const late = homeRowsAt(stepIndex("hold"));
    for (const [i, row] of early.entries()) {
      if (row.id === HOME_ROW_ID) continue;
      expect(row.at).toBe(late[i].at);
    }
  });
});

/**
 * The agent view mounts the panel's own parts. The wrapper may state only the
 * aside's class list; everything else is an import.
 */
describe("the agent view is the product's panel, minus what needs a bridge", () => {
  const VIEW_SRC =
    "src/features/marketing/components/banner-demo/demo-agent-view.tsx";
  const HEADER_SRC = "src/features/channels/components/agent-panel-header.tsx";
  const CONTROLS_SRC = "src/features/channels/components/agent-panel-controls.tsx";
  const STATS_SRC = "src/features/channels/components/agent-stats.tsx";

  it("🔒 imports the header, the controls box and the stats rather than re-declaring them", () => {
    const view = readFileSync(VIEW_SRC, "utf8");
    expect(view).toContain("import { AgentPanelHeader } from");
    expect(view).toContain("import { AgentControls } from");
    expect(view).toContain("import { AgentStats } from");
    expect(view).toContain("<AgentPanelHeader agent={agent} face={face} onClose={onClose} />");
    expect(view).toContain("<AgentStats agent={agent} color={color} />");
    // And no transcriptions — bidirectional, or this passes on a file that grew
    // the copies back beside the imports.
    expect(view).not.toContain("<header");
    expect(view).not.toContain("ThinMeter");
    expect(view).not.toContain("StatusPill");
    expect(view).not.toMatch(/\bborder-b\b/);
  });

  it("🔒 …and each really has ONE declaration, in the file the demo names", () => {
    for (const [name, src] of [
      ["AgentPanelHeader", HEADER_SRC],
      ["AgentControls", CONTROLS_SRC],
      ["AgentStats", STATS_SRC],
    ] as const) {
      const declared = readFileSync(src, "utf8").match(
        new RegExp(`^export function ${name}\\b`, "gm")
      );
      expect(`${name}: ${declared?.length ?? 0}`).toBe(`${name}: 1`);
    }
  });

  it("🔒 hands the stream the agent's colour and its live verdict", () => {
    const view = readFileSync(VIEW_SRC, "utf8");
    expect(view).toContain("color={color}");
    expect(view).toContain("liveness={agentLiveness(agent)}");
  });
});

/**
 * (2026-09-17) The record pane is /home's channel record, not a thread. What it
 * replaced was a thread view — breadcrumb header, thread-scoped info column, a
 * composer addressed to a thread. Every case pins one half of the correction and
 * the ABSENCE of what it replaced.
 */
describe("the record pane plays /home's channel record", () => {
  const scene = (id: StepId = "hold") => render(<DemoScene step={stepIndex(id)} />);

  it("🔒 the info column is Info · Threads · Agents · Tasks · Settings, in channel view", () => {
    const { container } = scene();
    const tabs = [...container.querySelectorAll('[role="tab"]')].map(
      (t) => t.textContent ?? ""
    );
    // The five FACE tabs are the header's; the five after them are the column's.
    expect(tabs.slice(-5)).toEqual(["Info", "Threads3", "Agents6", "Tasks1", "Settings"]);
    // And the thread column is not there — `channelPaneTabs` drops Threads in
    // thread view and `ThreadInfoTab` heads itself "Thread info".
    expect(screen.queryByText("Thread info")).toBeNull();
    expect(screen.queryByText("Parties")).toBeNull();
  });

  it("🔒 the Info tab is the account card's four sections, in Samuel's order", () => {
    // Before the tasks beat asks the column for its Tasks tab.
    scene("concurrent-4");
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual([
      "Channel info",
      "Channel activity",
      "Mentions",
      "Members",
    ]);
    // The card's four fixed rows (2026-09-15; Last activity deleted).
    for (const row of ["Name", "Description", "Creator", "Created"]) {
      expect(screen.getByText(row)).toBeTruthy();
    }
    // …and the one ACTION on the tab, under the roster it changes.
    expect(screen.getByText("Add person").className).toBe(PAGE_ACTION_BTN);
  });

  it("🔒 the composer addresses NOBODY BY SAYING SO, and carries the Bot glyph", () => {
    const { container } = scene();
    // 🔒 ⚠ **THIS CASE HAS NOW FLIPPED TWICE, SO READ THE WHOLE ARC BEFORE EDITING IT.** It
    // required the line to SAY "nobody" until 2026-09-22; the 2026-09-20 ruling (*"just have
    // it be nothing"*) inverted it to "draws nothing"; and Samuel reversed that on 2026-10-11
    // (#3166) — the blank row was invisible in the very case it taught, and because the
    // working pills lived INSIDE the element it deleted, an unaddressed draft took them down
    // with it. The face is `→ @nobody` again and the line renders at every state.
    // ⚠ THE DEMO RENDERS THE REAL COMPOSER, which is why this scene keeps following the
    // product rather than pinning a copy of it. Assert the FACE, not the absence: a pin on
    // `REACH_NOBODY` alone never caught either flip, because the constant survived both.
    expect(screen.getByLabelText("Recipients").textContent ?? "").toContain(
      "@nobody"
    );
    // `composer-toolbar.tsx` draws the Bot only on `newAgent?.canLaunch`, so a
    // scene that passed nothing rendered a browser's composer.
    for (const label of ["New Agent", "New thread", "Mention", "Emoji"]) {
      expect(
        container.querySelector(`[aria-label="${label}"]`)
      ).not.toBeNull();
    }
  });

  it("🚫 every face in the scene is a photograph, never an initial or a `+N`", () => {
    const { container } = scene();
    const srcs = [...container.querySelectorAll("img")].map((i) =>
      i.getAttribute("src")
    );
    // Three avatars and three workspace icons, all bundled `public/` assets.
    expect(srcs.filter((s) => s?.startsWith("/img/avatars/")).length)
      .toBeGreaterThan(5);
    // (2026-09-17) The rail is image tiles — `WorkspaceGlyph` initials a
    // workspace only when it has no icon.
    for (const icon of DEMO_RAIL_ICONS) expect(srcs).toContain(icon);
    // And no overflow bite: `IdentityStack` prints `+N` past its cap.
    expect(container.textContent).not.toMatch(/\+\d/);
  });
});

/** The three bundled images the rail's workspace tiles wear. Asserted, not
 *  imported: a list that came from the component could not fail when the
 *  component stops passing them. */
const DEMO_RAIL_ICONS = [
  "/img/dev-clouds.jpg",
  "/img/framework-banner.jpg",
  "/img/site_thumbnail.jpg",
];
