// @vitest-environment jsdom
/**
 * (2026-09-17) The hero demo's /home chrome is the product's UI, not a look-alike.
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
import { cleanup, render, screen, within } from "@testing-library/react";
import { PAGE_ACTION_BTN } from "@/shared/ui/page-action-button";
import {
  HOME_CARD_FACE,
  HOME_CARD_FACE_SELECTED,
} from "@/shared/ui/home-card-marks";
import { PANEL_WELL_ON_PANEL } from "@/shared/ui/panel-well";
import { HOME_TABS } from "@/features/home/tabs";
import { HOME_CHANNEL_WELLS } from "@/features/channels/components/home-channel-wells";
import { DemoChannelList, DemoHomeHeader } from "./demo-home-chrome";
import { DemoScene } from "./demo-scene";
import { HOME_ROW_ID, homeRowsAt } from "./demo-home-rows";
import { stepIndex } from "./demo-steps";
import { messagesAt } from "./demo-data";

const CHROME_SRC = "src/features/marketing/components/banner-demo/demo-home-chrome.tsx";
const ROWS_SRC = "src/features/marketing/components/banner-demo/demo-home-rows.ts";

/** The header's list-width cell, as a `closest` selector — the same one
 *  `relationship-list.test.tsx` uses against the real page. */
const CELL = ".w-\\[var\\(--home-list-w\\)\\]";

/** The scene at its last beat, where every row and every mark is on stage. */
const rows = () => homeRowsAt(stepIndex("hold"));

afterEach(cleanup);

describe("the header strip is /home's, control for control", () => {
  it("🔒 heads the list column with `New channel` and closes the row with `Profile`", () => {
    render(<DemoHomeHeader />);

    // Asserted against the CONSTANT, not a class list typed here, so a restyle of
    // the page action moves this case with it rather than breaking it.
    const create = screen.getByText("New channel");
    const profile = screen.getByText("Profile");
    for (const el of [create, profile]) {
      expect(el.className).toBe(PAGE_ACTION_BTN);
    }
    // (2026-09-15) The pill's left edge lands on the channel rows'; the
    // operator's control is not in that cell.
    expect(create.closest(CELL)).not.toBeNull();
    expect(profile.closest(CELL)).toBeNull();
    expect(create.className).not.toMatch(/w-full/);
  });

  it("🔒 names the five faces `HOME_TABS` names, in its order, on `Channel`", () => {
    render(<DemoHomeHeader />);
    // The product's own set, so a sixth or relabelled face reaches this scene
    // without an edit.
    const labels = HOME_TABS.map((tab) => tab.label);
    expect(labels).toContain("Channel");
    for (const label of labels) expect(screen.getByText(label)).toBeTruthy();
    // And no marketing list of its own — the old one outlived two renames.
    expect(screen.queryByText("Chat")).toBeNull();
  });

  it("🔒 renders the search pill OPEN, which is what /home renders", () => {
    const { container } = render(<DemoHomeHeader />);
    const pill = container.querySelector(".search-expand");
    // The closed 36px face is still the kit's; this scene is not its caller
    // (`pages/home/home-search.test.ts` carries both halves).
    expect(pill?.getAttribute("data-open")).toBe("true");
    expect(within(pill as HTMLElement).getByText("Search…")).toBeTruthy();
  });

  it("🚫 nothing in the chrome is focusable, and no face is re-spelled", () => {
    const src = readFileSync(CHROME_SRC, "utf8");
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    // The slot is decorative and `aria-hidden`; a control a screen reader can
    // still reach inside it is worse than a visible one.
    expect(code).not.toContain("<button");
    expect(code).not.toContain("<input");
    // The anti-copy fence: every face in this file arrives by import, and a
    // literal kit recipe is the drift the extraction was made to stop.
    expect(code).not.toMatch(/"auth-btn-3d[ "]/);
    expect(code).not.toContain("rounded-[14px]");
  });
});

describe("the channel column is the product's three wells over the product's row", () => {
  it("🔒 draws every well in `HOME_CHANNEL_WELLS`, empty or not, at the on-panel fill", () => {
    const { container } = render(
      <DemoChannelList rows={rows()} selectedId={HOME_ROW_ID} />
    );
    for (const well of HOME_CHANNEL_WELLS) {
      expect(screen.getByRole("heading", { name: well.label })).toBeTruthy();
    }
    // `PANEL_WELL_ON_PANEL`, not `PANEL_WELL`: this column stands on
    // `--home-panel`, so the default fill would be gray on the same gray.
    const boxes = [...container.querySelectorAll("section")];
    expect(boxes).toHaveLength(HOME_CHANNEL_WELLS.length);
    for (const box of boxes) expect(box.className).toBe(PANEL_WELL_ON_PANEL);
  });

  it("🔒 gives the live channel the black card and everything else the white one", () => {
    render(<DemoChannelList rows={rows()} selectedId={HOME_ROW_ID} />);
    const live = screen.getByText("q4-outbound").closest("button");
    expect(live?.className).toContain(HOME_CARD_FACE_SELECTED);
    expect(live?.className).not.toContain(HOME_CARD_FACE);

    const other = screen.getByText("renewals-q3").closest("button");
    expect(other?.className).toContain(HOME_CARD_FACE);
    expect(other?.className).not.toContain(HOME_CARD_FACE_SELECTED);
  });

  it("🔒 shows the marks the row can carry, and the solo row's description", () => {
    render(<DemoChannelList rows={rows()} selectedId={HOME_ROW_ID} />);
    // The `@ N` pill and the dot are exclusive — one row takes each.
    expect(screen.getByTitle("2 unread mentions")).toBeTruthy();
    expect(screen.getByLabelText("Unread messages")).toBeTruthy();
    expect(screen.getAllByText("Link out").length).toBeGreaterThan(0);
    // (2026-09-15) A solo channel's description takes line two, in italic — the
    // faces' alternative in that one slot, never stacked with them.
    const solo = screen.getByText(/Friday sweep of the pipeline/);
    expect(solo.className).toContain("italic");
  });

  it("🚫 no row carries a last-message preview, and none has a leading glyph", () => {
    const rowsNow = rows();
    // The fact is enforced by the TYPE — `HomeChannelRowFacts` has no slot for a
    // preview — so the honest pin is on the data this scene authors.
    for (const row of rowsNow) {
      expect(Object.keys(row)).not.toContain("lastLine");
      expect(Object.keys(row)).not.toContain("subline");
    }
    // (2026-09-01) No identity glyph in the leading slot: a channel is not a DM
    // and must not be dressed as one.
    const code = readFileSync(ROWS_SRC, "utf8");
    expect(code).not.toContain("Bot");
  });

  it("🔒 files every row into a well the product's own set declares", () => {
    const ids = new Set(HOME_CHANNEL_WELLS.map((well) => well.id));
    for (const row of rows()) expect(ids.has(row.well)).toBe(true);
  });
});

describe("the column tracks the scripted conversation", () => {
  it("🔒 stamps the live row with the transcript's newest message", () => {
    const step = stepIndex("agent-msg-3");
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
 * aside's class list and the box `AgentControls` would have drawn around the
 * stats; everything else is an import.
 */
describe("the agent view is the product's panel, minus what needs a bridge", () => {
  const VIEW_SRC =
    "src/features/marketing/components/banner-demo/demo-agent-view.tsx";
  const PANEL_SRC = "src/features/channels/components/agent-panel.tsx";
  // `AgentStats` lives outside the panel: the window held a second copy, and
  // collapsing them into one declaration had to be a split (§1 cap).
  const STATS_SRC = "src/features/channels/components/agent-stats.tsx";

  it("🔒 imports the header and the stats rather than re-declaring them", () => {
    const view = readFileSync(VIEW_SRC, "utf8");
    expect(view).toMatch(/AgentPanelHeader,\s*\n\s*agentSentMessages,/);
    expect(view).toContain("import { AgentStats } from");
    expect(view).toContain("<AgentPanelHeader agent={agent} onClose={onClose} />");
    expect(view).toContain("<AgentStats agent={agent} />");
    // And no transcriptions — bidirectional, or this passes on a file that grew
    // the copies back beside the imports.
    expect(view).not.toContain("<header");
    expect(view).not.toContain("UsageMeter");
    expect(view).not.toContain("AgentLiveness");
  });

  it("🔒 …and each really has ONE declaration, in the file the demo names", () => {
    for (const [name, src] of [
      ["AgentPanelHeader", PANEL_SRC],
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
  const scene = () => render(<DemoScene step={stepIndex("hold")} />);

  it("🔒 the info column is Info · Threads · Agents · Settings, in channel view", () => {
    const { container } = scene();
    const tabs = [...container.querySelectorAll('[role="tab"]')].map(
      (t) => t.textContent ?? ""
    );
    // The five FACE tabs are the header's; the four after them are the column's.
    expect(tabs.slice(-4)).toEqual(["Info", "Threads0", "Agents3", "Settings"]);
    // And the thread column is not there — `channelPaneTabs` drops Threads in
    // thread view and `ThreadInfoTab` heads itself "Thread info".
    expect(screen.queryByText("Thread info")).toBeNull();
    expect(screen.queryByText("Parties")).toBeNull();
  });

  it("🔒 the Info tab is the account card's four sections, in Samuel's order", () => {
    scene();
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

  it("🔒 the composer addresses NOBODY BY DRAWING NOTHING, and carries the Bot glyph", () => {
    const { container } = scene();
    // 🔒 ⚠ **THIS ASSERTED THE RETIRED COPY UNTIL 2026-09-22.** It required the recipient line to
    // SAY "nobody"; Samuel's ruling is the opposite — *"show an arrow pointing to nobody, just
    // have no arrow basically … if there is no addressee just have it be nothing"* — and
    // `composer-recipients.tsx` returns null on an empty reach. The demo renders the REAL
    // composer, so the scene followed the product and this case was the only thing still
    // defending the old behaviour. `REACH_NOBODY` survives as an EXPORT that nothing renders
    // (that file's docblock says why), so a pin on the constant would not have caught this.
    expect(screen.queryByLabelText("Recipients")).toBeNull();
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
    // And no overflow bite: `AvatarStack` prints `+N` past its cap.
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
