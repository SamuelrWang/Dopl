// @vitest-environment jsdom
/**
 * 🔒 **THE HERO DEMO'S /home CHROME IS THE PRODUCT'S UI, NOT A LOOK-ALIKE**
 * (Samuel, 2026-09-17: *"in the main demo/first glass window demo spot, we need
 * to overhaul it to match the new UI of the home space. The current version is
 * based on an outdated UI/UX."*).
 *
 * ⚠ **WHAT THIS SUITE IS FOR, AND IT IS NOT "the demo renders".** The scene it
 * replaced looked right on the day it was written and was a year of rulings
 * behind by the time anyone noticed: the header still put a face where the
 * "New channel" pill goes, the search pill was the CLOSED 36px face, the column
 * was a flat list of rows with a leading glyph and a last-message preview — every
 * one of those a thing Samuel had since deleted from /home. **A screenshot cannot
 * catch that and neither can a render test.** So every case below pins the scene
 * to a SHARED DECLARATION — the same constant or component the SPA page renders —
 * and fails when the demo grows a copy of one instead.
 *
 * ⚠ **BIDIRECTIONAL WHERE IT MATTERS**: the deleted things are asserted ABSENT,
 * because a suite that only checks what is present passes on a scene that grew
 * the old chrome back beside the new.
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
import { HOME_ROW_ID, homeRowsAt } from "./demo-home-rows";
import { stepIndex } from "./demo-steps";
import { messagesAt } from "./demo-data";

const CHROME_SRC = "src/features/marketing/components/banner-demo/demo-home-chrome.tsx";
const ROWS_SRC = "src/features/marketing/components/banner-demo/demo-home-rows.ts";

/** The header's list-width CELL, as a `closest` selector — the same one
 *  `relationship-list.test.tsx` uses against the real page. */
const CELL = ".w-\\[var\\(--home-list-w\\)\\]";

/** The scene at its last beat, where every row and every mark is on stage. */
const rows = () => homeRowsAt(stepIndex("hold"));

afterEach(cleanup);

describe("the header strip is /home's, control for control", () => {
  it("🔒 heads the list column with `New channel` and closes the row with `Profile`", () => {
    render(<DemoHomeHeader />);

    // ⚠ ASSERTED AGAINST THE CONSTANT, NOT AGAINST A CLASS LIST TYPED HERE.
    // `PAGE_ACTION_BTN` is the SPA's own declaration, so a restyle of the page
    // action moves this case with it rather than breaking it.
    const create = screen.getByText("New channel");
    const profile = screen.getByText("Profile");
    for (const el of [create, profile]) {
      expect(el.className).toBe(PAGE_ACTION_BTN);
    }
    // The pill's LEFT edge lands on the channel rows'; the operator's control
    // is NOT in that cell (Samuel, 2026-09-15).
    expect(create.closest(CELL)).not.toBeNull();
    expect(profile.closest(CELL)).toBeNull();
    expect(create.className).not.toMatch(/w-full/);
  });

  it("🔒 names the five faces `HOME_TABS` names, in its order, on `Channel`", () => {
    render(<DemoHomeHeader />);
    // ⚠ THE PRODUCT'S OWN SET — a sixth face or a relabelled one reaches this
    // scene without an edit, which is the whole reason it is imported.
    const labels = HOME_TABS.map((tab) => tab.label);
    expect(labels).toContain("Channel");
    for (const label of labels) expect(screen.getByText(label)).toBeTruthy();
    // 🚫 AND THE SET THIS SCENE USED TO CARRY IS GONE — it was a marketing list
    // of three ("Chat", "Knowledge", "Agents") that outlived two renames.
    expect(screen.queryByText("Chat")).toBeNull();
  });

  it("🔒 renders the search pill OPEN, which is what /home renders", () => {
    const { container } = render(<DemoHomeHeader />);
    const pill = container.querySelector(".search-expand");
    // The CLOSED 36px face is still the kit's; this scene stopped being its
    // caller on 2026-09-17 (`pages/home/home-search.test.ts` carries both halves).
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
    // ⚠ THE ANTI-COPY FENCE. Every face in this file arrives by import — a
    // literal kit recipe here is the drift the extraction was made to stop.
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
    // ⚠ `PANEL_WELL_ON_PANEL`, not `PANEL_WELL`: this column stands ON
    // `--home-panel`, so the default fill would be gray on the same gray
    // (Samuel: *"there's no gray background on this at all"*).
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
    // The `@ N` pill and the dot are EXCLUSIVE — one row takes each.
    expect(screen.getByTitle("2 unread mentions")).toBeTruthy();
    expect(screen.getByLabelText("Unread messages")).toBeTruthy();
    expect(screen.getAllByText("Link out").length).toBeGreaterThan(0);
    // 🔒 A SOLO channel's DESCRIPTION takes line two, in italic (2026-09-15) —
    // the faces' alternative in that one slot, never stacked with them.
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
    // 🔒 NO IDENTITY GLYPH IN THE LEADING SLOT (Samuel, 2026-09-01): a channel is
    // not a DM and must not be dressed as one. The scene used to draw a `Bot`
    // glyph, an avatar stack or a face there, by roster size.
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
    // ⚠ AND ONLY THE LIVE ROW MOVES — the others are other conversations, and
    // nothing is happening in them.
    const early = homeRowsAt(stepIndex("channel-base"));
    const late = homeRowsAt(stepIndex("hold"));
    for (const [i, row] of early.entries()) {
      if (row.id === HOME_ROW_ID) continue;
      expect(row.at).toBe(late[i].at);
    }
  });
});

/**
 * 🔑 **THE AGENT VIEW MOUNTS THE PANEL'S OWN PARTS.** It transcribed the header
 * and the stats until 2026-09-17, and both had drifted — the real header had
 * grown the effective-model clause and the ended-agent pill, the real stats a
 * third clause. What the wrapper may still state is the ASIDE's class list and
 * the box `AgentControls` would have drawn around the stats; everything else is
 * an import.
 */
describe("the agent view is the product's panel, minus what needs a bridge", () => {
  const VIEW_SRC =
    "src/features/marketing/components/banner-demo/demo-agent-view.tsx";
  const PANEL_SRC = "src/features/channels/components/agent-panel.tsx";

  it("🔒 imports the header and the stats rather than re-declaring them", () => {
    const view = readFileSync(VIEW_SRC, "utf8");
    expect(view).toMatch(/AgentPanelHeader,\s*\n\s*AgentStats,/);
    expect(view).toContain("<AgentPanelHeader agent={agent} onClose={onClose} />");
    expect(view).toContain("<AgentStats agent={agent} />");
    // 🚫 AND THE TRANSCRIPTIONS ARE GONE — bidirectional, or this passes on a
    // file that grew the copies back beside the imports.
    expect(view).not.toContain("<header");
    expect(view).not.toContain("UsageMeter");
    expect(view).not.toContain("AgentLiveness");
  });

  it("🔒 …and the panel really exports both, from ONE declaration each", () => {
    const panel = readFileSync(PANEL_SRC, "utf8");
    for (const name of ["AgentPanelHeader", "AgentStats"]) {
      const declared = panel.match(
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
