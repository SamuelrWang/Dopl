// @vitest-environment jsdom
/**
 * THE AGENT SETTINGS BLOCK'S TYPE FACE — weight and underline, and nothing else.
 *
 * ⚠ ITS OWN FILE FOR `settings-agent-harness.tsx`'s REASON, not a new one:
 * `settings-tab.test.tsx` is over the 500-line cap already (INVARIANTS §1), and the
 * harness exists precisely so a new agent-half suite splits off instead of growing
 * it. The cases split by what they are ABOUT — that file keeps the rows, profiles
 * and folder BEHAVIOUR; this one is the FACE.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { agentView } from "./settings-agent-harness";

afterEach(cleanup);

const noop = () => {};

/**
 * 🔒 NOTHING IN THE AGENT SETTINGS BLOCK IS BOLD OR UNDERLINED (Samuel, 2026-09-10):
 * *"unbold these things: Runtime Default, Tool use Bypass, Messaging Automatic,
 * Model Sonnet 5, Tool access Full access, Working Folder ~/Downloads, Launch agents
 * In every channel. also remove the underline."*
 *
 * ⚠ IT IS A MEASUREMENT OVER THE WHOLE BLOCK, NOT A LIST OF ROWS — the same shape as
 * `› a settings panel, not documentation` above. Every row here is built from ONE
 * recipe (`settings-agent-rows.tsx › SettingRow`) whose value is one `SelectMenu`
 * face (`select-menu.tsx › TRIGGER_FACE.text`), so a sweep goes red for a row nobody
 * thought to name — including a row added later.
 * ⚠ THE HEADING IS DELIBERATELY EXCLUDED: "Agent Settings" is a `PanelHeading` and
 * is NOT in his list, so it keeps its weight, and a sweep that included it could
 * only be satisfied by unbolding something he did not ask for.
 */
describe("the Agent Settings rows — no bold, no underline", () => {
  /** The desktop-only rows too, so the Working Folder path is in scope. */
  const FOLDER = { label: "~/Downloads", custom: true, busy: false, onChoose: noop, onClear: noop };

  /** Every node inside the block except the `PanelHeading`'s own `<h2>`, which is
   *  NOT in his list and keeps its `font-semibold`. */
  const blockNodes = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLElement>("*")].filter((el) => el.tagName !== "H2");

  it("no label and no value wears a bold weight", () => {
    const { container } = agentView({ folder: FOLDER });
    const bold = blockNodes(container)
      .filter((el) => /\bfont-(medium|semibold|bold)\b/.test(el.className))
      .map((el) => `${el.tagName}:${el.textContent?.slice(0, 32)}`);
    // ⚠ "Use default" is a small ACTION BUTTON, not a label or a value, and it is
    // not in his list — it keeps `font-medium`.
    expect(bold.filter((d) => !d.includes("Use default"))).toEqual([]);
  });

  it("no label and no value is underlined, at rest or on hover or on focus", () => {
    const { container } = agentView({ folder: FOLDER });
    const lined = blockNodes(container)
      .filter((el) => /(^|\s|:)(underline|decoration-)/.test(el.className))
      .map((el) => `${el.tagName}:${el.textContent?.slice(0, 32)}`);
    expect(lined).toEqual([]);
  });
});
