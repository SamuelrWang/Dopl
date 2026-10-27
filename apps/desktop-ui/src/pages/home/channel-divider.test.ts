/**
 * THE SKINNED PANE'S DIVIDERS ARE THE KIT HAIRLINE. `split-resize-handle.tsx` centres the resize
 * pill on half of `--channel-divider-w`, falling back to 1px — the kit's `border-l` — so the skin
 * must not widen a structural divider without declaring that variable beside it. It declares
 * neither: the pane, its dividers and the pill all agree at 1px. Both kit copies, because the
 * skin sits outside `@layer components` and the drift gate does not compare it (F-074).
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const HERE = import.meta.dirname;
const REPO = resolve(HERE, "../../../../..");

const COPIES: [string, string][] = [
  ["web", "src/app/globals.css"],
  ["desktop", "apps/desktop-ui/src/styles/kit.css"],
];

/** The file with comments stripped, so a commented example cannot satisfy this. */
const code = (rel: string) =>
  readFileSync(resolve(REPO, rel), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule block that selects on the skin. */
const skinRules = (css: string) =>
  css.split("}").filter((chunk) => chunk.includes("[data-frame-skin]"));

describe.each(COPIES)("%s: the account palette skin keeps the hairline", (_host, rel) => {
  it("widens no divider", () => {
    for (const block of skinRules(code(rel))) {
      expect(block).not.toMatch(/border-(left|bottom)-width/);
    }
  });

  it("so it declares no divider width for the resize pill either", () => {
    expect(code(rel)).not.toContain("--channel-divider-w");
  });

  it("still repaints the dividers in the panel line", () => {
    const block = skinRules(code(rel)).find((b) => b.includes(".border-border-default"));
    expect(block).toContain("border-color: var(--home-panel-line)");
  });
});

/** The rule is inert without the attribute: /home's record pane (page and ghost share
 *  `HomeFrame`) and the workspace channels page wear it. */
describe("the hosts that wear the skin", () => {
  it.each([
    "src/features/home/components/shell/home-frame.tsx",
    "src/features/channels/components/channels-core.tsx",
  ])("%s carries data-frame-skin", (rel) => {
    expect(readFileSync(resolve(REPO, rel), "utf-8")).toContain("data-frame-skin");
  });

  it("and the page module fences no second copy", () => {
    expect(code("src/features/home/components/shell/home.module.css")).not.toContain(":global(");
  });
});
