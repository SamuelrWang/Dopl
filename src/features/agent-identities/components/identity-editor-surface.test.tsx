/**
 * THE EDITOR'S SURFACE RULINGS — A SOURCE READ, NOT A RENDER.
 *
 * ⚠ **A SECOND FILE FOR ONE COMPONENT, AND ONLY BECAUSE OF THE §1 LINE CAP**
 * (2026-09-08) — the same reason `server/service-writes-junction.test.ts`
 * exists. What lives HERE is every claim about CLASS STRINGS; what lives in
 * `identity-editor.test.tsx` is every claim about behaviour.
 *
 * Samuel's ruling for this page (2026-08-22) is that **nothing on it is pressed
 * in** — no `FIELD_WELL`, no `.concave-field`, no `.concave-track`, no
 * `SECTION_BOX_INSET`. That is a property of the CLASS STRINGS, not of the DOM:
 * jsdom loads no stylesheet, so a rendered assertion would pass against a
 * concave field and prove nothing. The same shape as the token-purity checks
 * elsewhere in this tree (`billing/components/billing-page-screen.test.tsx ›
 * what the page deliberately leaves out`).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Every shipped `.ts`/`.tsx` under `dir`. ⚠ TESTS ARE EXCLUDED: the suites here
 * name the strings they forbid, so a test asserting on itself is a false
 * positive by construction. ONE walker for both sweeps below — the sweep over
 * this feature and /home, and the repo-wide census — because two that drift
 * would disagree about what "a source file" is.
 */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.name === "node_modules" || entry.name === "dist") return [];
    if (entry.isDirectory()) return sources(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

describe("no concave surfaces", () => {
  // ⚠ SOURCE READ. jsdom loads no stylesheet, so the only honest place to pin a
  // SURFACE ruling is the class strings themselves.
  const ROOT = path.join(process.cwd(), "src", "features", "agent-identities");
  // ⚠ The UI half only. `server/` renders nothing and has no surface to get
  // wrong; sweeping it would make this suite fail for reasons that are not the
  // ruling, in a directory this page does not own.
  const UI_DIRS = ["components", "lib", "hooks", "client"];
  const FORBIDDEN = [
    "concave-field",
    "concave-track",
    "auth-field-3d",
    "FIELD_WELL",
    "SECTION_BOX_INSET",
    "SectionBox",
    // ⚠ ADDED 2026-09-01. `shared/ui/usage-meter.tsx › UsageMeter` IS a concave
    // surface — its whole recipe is a `.concave-track` well — so importing it
    // was a way to ship one past a sweep that only reads class STRINGS. Naming
    // the component closes that hole, and the sanctioned exception below is
    // what keeps the one Samuel ordered.
    "UsageMeter",
  ];

  /**
   * ⚠ THE SWEEP REACHES ACROSS TREES, AND IT HAS TO (2026-08-26, Q4 of
   * `docs/specs/home-agents-tab.plan.md`). The /home Agents face lives in the
   * SPA — a separate vitest project — but it renders THIS feature's panels and
   * cards, so a `SectionBox` there breaks the same ruling. This is a
   * `readFileSync` over SOURCE, not an import: the root project runs with
   * `process.cwd()` at the repo root, so the files resolve with no module
   * graph, no alias and no second config. **A mirrored sweep in the SPA suite
   * was the alternative and is worse** — two lists of forbidden recipes drift,
   * and the one that matters is whichever the author did not open.
   *
   * ⚠ **THE SWEEP IS /home's NOW, NOT JUST THE AGENTS FACE'S (2026-08-27).**
   * `knowledge-panels.tsx` joined it the day Samuel ruled the Knowledge
   * sections flat: they were `SectionBox` — a header strip over a CONCAVE inset
   * body — and are `shared/ui/section-panel.tsx › SectionPanel` on the page's
   * flat panel gray since. That is the same "nothing here is pressed in" rule
   * arriving on the second tab, so it is pinned the same way.
   *
   * ⚠ **DERIVED FROM THE DIRECTORY SINCE 2026-08-30, AND THE REASON IS A MISS.**
   * This was a HAND-TYPED LIST OF FIVE, under the sentence "a /home file that
   * renders a surface belongs in it" — and it did not contain
   * `pages/home/link-out-panel.tsx`, which renders a surface and was wearing
   * `FIELD_WELL`, the first entry in `FORBIDDEN`. **The enforcement mechanism
   * drifted from the ruling, not the ruling from the code**, and a list that
   * only a human adds to cannot catch the file the human did not think of. The
   * membership test is now the one the sentence always stated: every `.tsx` in
   * `pages/home/`, minus an explicit opt-out that has to say why.
   */
  const HOME_DIR = path.join(
    process.cwd(),
    "apps",
    "desktop-ui",
    "src",
    "pages",
    "home"
  );

  /**
   * ⚠ MAY ONLY EVER SHRINK, and each entry names a reason that is about the
   * file NOT BEING A SURFACE — never about it being inconvenient to fix.
   * `.test.tsx` files are excluded by the same rule `sources()` applies in this
   * tree: the suite names the strings it forbids, so a test asserting on itself
   * is a false positive by construction.
   */
  const HOME_NOT_SURFACES = new Set([
    // Render MACHINERY for the suites next to it — providers and fixtures, no
    // surface of its own. Deliberately not a `.test.tsx` name so vitest does
    // not collect it, which is why the extension filter cannot catch it.
    "home-test-harness.tsx",
  ]);

  /**
   * 🔒 **THE ONE SANCTIONED CONCAVE SURFACE ON /home (Samuel, 2026-09-01), AND
   * IT IS AN AMENDMENT TO THE RULING RATHER THAN A HOLE IN IT.**
   *
   * The Overview face's credit bar was built as an approximation of the billing
   * surface's — a hand-rolled track with a raised fill — precisely BECAUSE of
   * the no-concave rule. Samuel's correction is that the reference IS the spec:
   * the bar must be `billing/components/billing-usage-pane.tsx`'s "Credits"
   * meter (labelled "MCP credits" until the 2026-09-05 rename), which is
   * `shared/ui/usage-meter.tsx › UsageMeter`, which is a
   * `.concave-track`. A design reference cloned exactly beats a local surface
   * rule, and he said so after seeing the approximation.
   *
   * ⚠ **SCOPED TO ONE FILE AND ONE RECIPE.** Every other /home surface is still
   * swept, and this file is still swept for every OTHER forbidden string — the
   * exception is the pair, not the file. Widening it needs another ruling.
   */
  const HOME_CONCAVE_SANCTIONED: ReadonlyMap<string, string> = new Map([
    ["overview-sections.tsx", "UsageMeter"],
  ]);

  const HOME_FILES = readdirSync(HOME_DIR)
    .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
    .filter((name) => !HOME_NOT_SURFACES.has(name))
    .sort()
    .map((name) => path.join(HOME_DIR, name));

  const FILES = [...UI_DIRS.flatMap((dir) => sources(path.join(ROOT, dir))), ...HOME_FILES];

  it("finds source files to check (a silent empty sweep would pass forever)", () => {
    expect(FILES.length).toBeGreaterThan(5);
  });

  // ⚠ THE DERIVATION ITSELF IS ASSERTED. A scan that answered `[]` — a moved
  // directory, a changed extension convention — would make every /home case
  // below vacuously green, which is a quieter version of the miss that caused
  // the derivation in the first place.
  it("derives the /home surfaces, and reaches BOTH tabs' files", () => {
    expect(HOME_FILES.length).toBeGreaterThan(10);
    for (const name of ["knowledge-panels.tsx", "identity-panels.tsx", "link-out-panel.tsx"]) {
      expect(HOME_FILES).toContain(path.join(HOME_DIR, name));
    }
  });

  // …and the opt-out may not outlive its entries: a name that is no longer in
  // the directory is a comment claiming a fact.
  it.each([...HOME_NOT_SURFACES])("the opt-out entry %s still exists", (name) => {
    expect(existsSync(path.join(HOME_DIR, name))).toBe(true);
  });

  it.each(FILES)("%s wears no pressed-in recipe", (file) => {
    const source = readFileSync(file, "utf8");
    // Comments EXPLAIN the ruling by naming the classes it bans, so the check
    // runs over code lines only.
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    const sanctioned = HOME_CONCAVE_SANCTIONED.get(path.basename(file));
    for (const forbidden of FORBIDDEN) {
      // ⚠ ONE recipe is excused in ONE file, by name — see
      // `HOME_CONCAVE_SANCTIONED`. Everything else in that file is still swept.
      if (forbidden === sanctioned) continue;
      expect(code, `${file} must not use ${forbidden}`).not.toContain(forbidden);
    }
  });

  /**
   * ⚠ **THE EXCEPTION HAS TO BE LOAD-BEARING OR IT IS JUST A HOLE.** If the
   * credit bar ever stops using the billing meter, the carve-out must go with
   * it — otherwise the next surface to reach for `UsageMeter` in that file
   * inherits a permission nobody granted it.
   */
  it.each([...HOME_CONCAVE_SANCTIONED])(
    "the sanctioned concave surface %s really does use %s",
    (name, recipe) => {
      const file = path.join(HOME_DIR, name);
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, "utf8")).toContain(recipe);
    }
  );

  /**
   * 🔒 **THE CONCAVE SECTION RECIPE IS OFF THE DESKTOP (Samuel's ruling R-39,
   * 2026-09-17: flat wins; the web login page keeps concave for now).** The
   * `FORBIDDEN` sweep above covers this feature and /home; the ruling is wider,
   * so the wider half is a CENSUS of the two exports' consumers, repo-wide.
   *
   * ⚠ **A CENSUS AND NOT A BAN, BECAUSE THE WEB KEEPS CONCAVE.** Banning the
   * strings repo-wide would fail on the login page and the playground, which
   * Samuel exempted in as many words; listing the consumers fails the day a
   * DESKTOP surface takes one back, which is what the ruling forbids.
   * ⚠ **THE LIST MAY ONLY SHRINK**, and each entry names why it is not inertia.
   * This is where those reasons live — `shared/ui/section-box.tsx` points here
   * rather than restating them.
   */
  describe("the concave section recipe is off the desktop", () => {
    const REPO = process.cwd();

    const ALL = [
      ...sources(path.join(REPO, "src")),
      ...sources(path.join(REPO, "apps", "desktop-ui", "src")),
    ];

    /**
     * ⚠ BLOCK COMMENTS STRIPPED PROPERLY, not by line prefix — a converted file
     * EXPLAINS what it stopped wearing, by name, and `{/* … *\/}` in JSX puts
     * that name on a line a prefix filter never sees.
     */
    function wearers(recipe: string): string[] {
      return ALL.filter((file) => {
        const code = readFileSync(file, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .split("\n")
          .filter((line) => !/^\s*\/\//.test(line))
          .join("\n");
        return code.includes(recipe);
      })
        .map((file) => path.relative(REPO, file))
        .sort();
    }

    it("finds source to sweep (a silent empty census would pass forever)", () => {
      expect(ALL.length).toBeGreaterThan(500);
    });

    it("`SectionBox` is mounted by the WEB playground and nothing else", () => {
      expect(wearers("SectionBox")).toEqual([
        // The declaration itself.
        "src/shared/ui/section-box.tsx",
        // Web-only: `src/app/playground/page.tsx` is its only route.
        "src/features/playground/components/panes/members-pane.tsx",
      ].sort());
    });

    it("`SECTION_BOX_INSET` survives only where a ruling keeps it", () => {
      expect(wearers("SECTION_BOX_INSET")).toEqual([
        "src/shared/ui/section-box.tsx",
        // 🔒 FROZEN settings surfaces — INVARIANTS §15, pending Samuel's own
        // overhaul. The sweep does not reach in; it also does not forget them.
        "src/features/workspaces/components/workspace-danger-zone-core.tsx",
        "src/features/mcp-connect/components/connected-apps-section.tsx",
        "src/features/mcp-connect/components/remote-connect.tsx",
        "src/shared/layout/settings-modal/sections/delete-account.tsx",
        "apps/desktop-ui/src/components/settings-modal/account-actions.tsx",
        // 🔒 A COMPOSER PANEL, where the pressed-in stack is its own standing
        // ruling (2026-08-26: "FILL ONLY. The concave shadow stack is
        // deliberate and stays").
        "src/features/channels/components/composer-launch-panel.tsx",
      ].sort());
    });
  });

  /**
   * ⚠ THE RECIPE MOVED, THE RULE DID NOT (2026-08-27). `RAISED_INPUT` was
   * promoted out of `identity-editor-rows.tsx` into `shared/ui/wells.ts` when
   * the four /home dialogs standardised onto this page's face, so the assertion
   * follows it: the SHARED recipe must still be built from `RAISED_WELL`, and
   * this page's rows must still be wearing that recipe rather than a fork.
   */
  it("uses the kit's RAISED well for its inputs", () => {
    const wells = readFileSync(
      path.join(process.cwd(), "src", "shared", "ui", "wells.ts"),
      "utf8"
    );
    expect(wells).toContain("export const RAISED_INPUT = `${RAISED_WELL}");
    const rows = readFileSync(path.join(ROOT, "components", "identity-editor-rows.tsx"), "utf8");
    expect(rows).toContain("RAISED_INPUT");
  });

  /**
   * ⚠ THE SAME RULE, ARRIVING ON THE BUTTONS (Samuel, 2026-08-28). The dialog's
   * in-body controls — Add field, a row's Remove, the chip picker's
   * Attach/Add-team — hand-wrote THREE different heights and radii for one
   * class of control; they wear `shared/ui/open-scale-button.tsx`, the KB card
   * Open scale that /home's section buttons already carry. Source read for the
   * same reason as the sweep above: the pill is CSS, and jsdom loads none.
   *
   * ⚠ **WHAT THIS DELIBERATELY DOES NOT PIN** is the FOOTER. `DIALOG_BTN_*` is
   * the `StandardDialog` contract for both this dialog's pair and the Add-field
   * card's, and Delete is ink with no face at all by an older ruling of
   * Samuel's — a pill in either place would be this dialog closing differently
   * from every other one in the tree.
   */
  it("wears the kit's 26px pill on the buttons inside its body", () => {
    const rows = readFileSync(path.join(ROOT, "components", "identity-editor-rows.tsx"), "utf8");
    expect(rows).toContain("OpenScaleButton");
    expect(rows).toContain("OpenScaleIconButton");
    // A hand-written pill FACE is what the ruling replaced, and the kit's
    // module is the only place that declaration lives now. The static CHIP
    // keeps its own rounded badge — it is not a button and never was.
    expect(rows).not.toContain("btn-light");
  });
});
