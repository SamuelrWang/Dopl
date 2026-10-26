// @vitest-environment jsdom
/**
 * THE AGENT SETTINGS ROWS' TYPE FACE — weight, underline and the value face, and nothing else.
 *
 * Its own file for `settings-agent-harness.tsx`'s reason: the cases split by what they are ABOUT —
 * `settings-tab-agent.test.tsx` keeps the rows' behaviour; this one is the FACE.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { agentView } from "./settings-agent-harness";

afterEach(cleanup);

const noop = () => {};

/**
 * A MEASUREMENT OVER THE WHOLE BLOCK, NOT A LIST OF ROWS: every row is one recipe
 * (`settings-agent-rows.tsx › SettingRow`) and every value one face (`select-menu.tsx ›
 * BARE_TRIGGER_FACE`, which the folder path wears too), so a row added later is in scope.
 */
describe("the Agent Settings rows — the identity look's face", () => {
  /** The desktop-only rows too, so the Working folder path is in scope. */
  const FOLDER = { label: "~/Downloads", custom: true, busy: false, onChoose: noop, onClear: noop };

  /** Every setting's NAME: the row's first column. */
  const names = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLElement>("[data-settings-row] > span:first-child > span")];

  /** Every setting's VALUE control: menus and the folder path, never "Use default" or the help eye. */
  const values = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLButtonElement>("[data-settings-row] button")].filter(
      (b) => b.textContent !== "Use default" && !b.getAttribute("aria-label")?.startsWith("What ")
    );

  it("names are regular weight (Samuel, 2026-09-10: unbold the labels)", () => {
    const { container } = agentView({ folder: FOLDER });
    expect(names(container).length).toBeGreaterThanOrEqual(4);
    for (const name of names(container)) {
      expect(name.className).not.toMatch(/\bfont-(medium|semibold|bold)\b/);
    }
  });

  it("every value is the bare face: the value and a chevron, no pill and no fill", () => {
    const { container } = agentView({ folder: FOLDER });
    expect(values(container).length).toBeGreaterThanOrEqual(4);
    for (const value of values(container)) {
      expect(value.className).toContain("text-caption");
      expect(value.className).not.toMatch(/(^|\s)(bg-|border(\s|$)|border-)/);
    }
  });

  it("no label and no value is underlined, at rest or on hover or on focus", () => {
    const { container } = agentView({ folder: FOLDER });
    const lined = [...container.querySelectorAll<HTMLElement>("*")]
      .filter((el) => /(^|\s|:)(underline|decoration-)/.test(el.className))
      .map((el) => `${el.tagName}:${el.textContent?.slice(0, 32)}`);
    expect(lined).toEqual([]);
  });
});
