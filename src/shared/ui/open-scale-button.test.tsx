// @vitest-environment jsdom
/**
 * THE SMALL PILL BUTTON — the face both shapes share, and the one property a
 * multi-word label needs.
 *
 * ⚠ THE SECOND DESCRIBE IS A SOURCE READ, for the reason
 * `section-panel.test.tsx › the /home ground` gives: the face is a CSS-module
 * rule and jsdom loads no stylesheet, so a rendered assertion reports the same
 * nothing whether the rule is there or not. A wrapping label is invisible to
 * every layout-free renderer there is — it can only be pinned at the source.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { OpenScaleButton, OpenScaleIconButton } from "./open-scale-button";

afterEach(cleanup);

const face = () =>
  readFileSync(
    path.join(process.cwd(), "src", "shared", "ui", "open-scale-button.module.css"),
    "utf8"
  );

/**
 * One rule's DECLARATIONS, by selector — comments stripped.
 *
 * 🔴 ⚠ NOT DEFENSIVE, LOAD-BEARING. This file's rules carry rationale comments
 * that name the properties they argue for, so an unstripped read matches the
 * PROSE and passes with the declaration gone — measured in the sibling pin
 * (`features/knowledge/components/knowledge-v2/layout-rules.test.ts › rule`),
 * where exactly that made three assertions vacuous.
 */
function rule(css: string, selector: string): string {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const at = bare.indexOf(`${selector} {`);
  expect(at).toBeGreaterThan(-1);
  return bare.slice(at, bare.indexOf("}", at));
}

describe("the two shapes are ONE face", () => {
  it("composes the kit elevation and the shared pill on both", () => {
    render(
      <>
        <OpenScaleButton>New file</OpenScaleButton>
        <OpenScaleIconButton aria-label="Settings">x</OpenScaleIconButton>
      </>
    );
    const labelled = screen.getByRole("button", { name: "New file" });
    const square = screen.getByRole("button", { name: "Settings" });

    for (const btn of [labelled, square]) {
      expect(btn.className).toContain("btn-light");
      expect(btn.className).toContain("openScale");
      expect(btn.getAttribute("type")).toBe("button");
    }
    // The square is the pill PLUS a modifier — never a second face.
    expect(square.className).toContain("openScaleIcon");
    expect(labelled.className).not.toContain("openScaleIcon");
  });
});

describe("🔒 a pill is ONE line", () => {
  /**
   * 🔒 SAMUEL'S LIVE REVIEW, 2026-08-28: "New file" rendered as "New / file" in
   * the knowledge folder rail. The face is a FIXED 26px height, so a wrapped
   * label is not a cramped button — it is a second line drawn outside the
   * button's own face.
   *
   * ⚠ PINNED IN THE SHARED RECIPE, NOT AT THE CALL SITE. Four callers survived
   * without this because every label was one word; the fix belongs where the
   * height is declared, or the next multi-word caller rediscovers it.
   */
  it("never wraps its label", () => {
    expect(rule(face(), ".openScale")).toContain("white-space: nowrap");
  });

  it("never lets a flex parent squeeze it instead", () => {
    // Nowrap alone converts a wrap into a CLIP. Both, or neither is a fix.
    expect(rule(face(), ".openScale")).toContain("flex-shrink: 0");
  });
});
