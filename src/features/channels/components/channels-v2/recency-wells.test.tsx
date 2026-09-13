// @vitest-environment jsdom
/**
 * THE MODULE THE AGENTS TAB AND THE THREADS TAB SHARE (extracted 2026-09-13, when
 * Samuel asked for *"the same gray backgrounds that we added to the Agents tab"* on
 * the Threads tab).
 *
 * ⚠ **THIS SUITE DELIBERATELY DOES NOT RE-TEST THE WELLS' BEHAVIOUR.** The spans,
 * `wellFor`'s boundaries, the chevron's rotation, the one-transition unmount, the
 * `PANEL_WELL` face and the corrupt-write fallback are pinned once each, through a
 * real surface, in `agents-wells.test.tsx` and `threads-tab.test.tsx`. A third copy
 * of those assertions would be one more place to update and no more coverage.
 *
 * WHAT IS PINNED HERE IS THE **EXTRACTION** — the three properties that only exist
 * because there are now TWO readers, and that no single-surface suite can state:
 *
 *  - **THE KEY IS A PARAMETER, NOT A CONSTANT.** Two surfaces, two
 *    `localStorage` keys, no shared state: collapsing **Earlier** over agents must
 *    not collapse it over threads. Were `useRecencyWells` to ignore its argument
 *    and read one hard-coded key, BOTH consumer suites would still pass — each one
 *    only ever mounts its own surface.
 *  - **THE BUCKETS ARE EXHAUSTIVE, SO NO ITEM CAN BE DROPPED BY ARITHMETIC.** Every
 *    item the caller hands in comes out in exactly one well, the undated one
 *    included.
 *  - **NOTHING HERE SORTS.** The caller's order is the server's order (§5: the
 *    Threads list is never re-sorted, because §9's clip is measured against it) and
 *    it has to survive the grouping pass.
 *  - **AND THE AGENTS TAB RE-EXPORTS THIS MACHINERY RATHER THAN HOLDING A COPY** —
 *    asserted by IDENTITY, which is the only form of the claim that a second
 *    implementation cannot satisfy.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  RECENCY_WELLS,
  RecencyWell,
  RecencyWells,
  wellFor,
  type RecencyWellItem,
} from "./recency-wells";
import {
  AGENT_WELLS,
  AGENT_WELLS_STORAGE_KEY,
  AgentWell,
  wellFor as agentsWellFor,
} from "./agents-wells";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 13, 12, 0, 0);

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

/** One item per well, plus one this read could not date. */
const SPREAD: RecencyWellItem[] = [
  { key: "a", at: NOW - HOUR, node: <p>alpha</p> },
  { key: "b", at: NOW - 3 * DAY, node: <p>bravo</p> },
  { key: "c", at: NOW - 12 * DAY, node: <p>charlie</p> },
  { key: "d", at: NOW - 90 * DAY, node: <p>delta</p> },
  { key: "e", at: null, node: <p>echo</p> },
];

/** Every well, open — three of the four are collapsed by default and a collapsed
 *  well holds no content at all. */
function openAll() {
  for (const well of RECENCY_WELLS) {
    const row = screen.queryByRole("button", { name: well.label });
    if (row && row.getAttribute("aria-expanded") === "false") fireEvent.click(row);
  }
}

describe("recency-wells — the module the two surfaces share", () => {
  it("takes its storage key as a PARAMETER: two surfaces do not share an open state", () => {
    const first = render(
      <RecencyWells items={SPREAD} storageKey="dopl.test.one" now={NOW} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Recent" }));
    expect(JSON.parse(window.localStorage.getItem("dopl.test.one")!)).toMatchObject({
      recent: false,
    });
    // ⚠ THE OTHER SURFACE'S KEY WAS NOT WRITTEN — this is the assertion that fails
    // if the hook ever ignores its argument.
    expect(window.localStorage.getItem("dopl.test.two")).toBeNull();
    first.unmount();

    render(<RecencyWells items={SPREAD} storageKey="dopl.test.two" now={NOW} />);
    expect(
      screen.getByRole("button", { name: "Recent" }).getAttribute("aria-expanded")
    ).toBe("true");
  });

  it("files every item in exactly one well — the four spans are exhaustive", () => {
    render(<RecencyWells items={SPREAD} storageKey="dopl.test.spread" now={NOW} />);
    openAll();
    // ⚠ NOTHING IS DROPPED AND NOTHING IS DOUBLED: `getByText` throws on both.
    for (const text of ["alpha", "bravo", "charlie", "delta", "echo"]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    // …and the undated one is in the well that is OPEN by default.
    const recent = screen.getByRole("heading", { name: "Recent" }).closest("section")!;
    expect(within(recent).getByText("echo")).toBeTruthy();
  });

  it("keeps the CALLER'S order inside a well — the grouping pass never sorts", () => {
    // ⚠ SUPPLIED YOUNGEST-LAST ON PURPOSE: a sort by recency would reverse this,
    // and the server's own activity order is what both surfaces must preserve.
    render(
      <RecencyWells
        storageKey="dopl.test.order"
        now={NOW}
        items={[
          { key: "z", at: NOW - 5 * HOUR, node: <p>zulu</p> },
          { key: "y", at: NOW - 3 * HOUR, node: <p>yankee</p> },
          { key: "x", at: NOW - HOUR, node: <p>xray</p> },
        ]}
      />
    );
    const recent = screen.getByRole("heading", { name: "Recent" }).closest("section")!;
    expect(recent.textContent).toBe("Recentzuluyankeexray");
  });

  it("is the machinery the Agents tab RE-EXPORTS, not a second copy of it", () => {
    // ⚠ BY IDENTITY. A re-implementation with the same names would pass every
    // behavioural assertion in `agents-wells.test.tsx` and fail these three.
    expect(AGENT_WELLS).toBe(RECENCY_WELLS);
    expect(AgentWell).toBe(RecencyWell);
    expect(agentsWellFor).toBe(wellFor);
    // ⚠ AND THE TWO KEYS ARE DISTINCT STRINGS, stated here where both are in scope.
    expect(AGENT_WELLS_STORAGE_KEY).toBe("dopl.agents.wells");
  });
});
