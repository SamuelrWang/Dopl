// Nothing on the identities surfaces is pressed in. A source read, not a render: the ruling lives
// in class strings and jsdom loads no stylesheet. Negative pins read `readCode`, because the
// docblocks name the recipes they forbid.

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCode } from "@/shared/testing/source-text";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));

/** Every shipped `.ts`/`.tsx` under `dir`; tests are excluded because they name the strings they forbid. */
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
  const ROOT = path.join(REPO, "src", "features", "agent-identities");
  // The UI half only: `server/` renders nothing.
  const UI_DIRS = ["components", "lib", "hooks", "client"];
  const FORBIDDEN = [
    "concave-field",
    "concave-track",
    "auth-field-3d",
    "FIELD_WELL",
    "SECTION_BOX_INSET",
    "SectionBox",
    // `shared/ui/usage-meter.tsx › UsageMeter` is a `.concave-track` well behind a component name.
    "UsageMeter",
  ];

  // The SPA's /home renders this feature's panels, so the sweep reads that tree's source too (one
  // list of recipes, not a mirrored SPA copy). Every `.tsx` in `pages/home/` is derived, not listed.
  const HOME_DIR = path.join(REPO, "apps", "desktop-ui", "src", "pages", "home");

  // May only shrink; each entry must be a file that is not a surface.
  const HOME_NOT_SURFACES = new Set([
    // Test render machinery with no surface; not a `.test.tsx` name, so the extension filter misses it.
    "home-test-harness.tsx",
  ]);

  // The one sanctioned concave surface: the credit bar clones the billing pane's `UsageMeter`.
  // The exception is the (file, recipe) pair; the file is still swept for everything else.
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

  // A derivation that answered `[]` would make every /home case vacuously green.
  it("derives the /home surfaces, and reaches BOTH tabs' files", () => {
    expect(HOME_FILES.length).toBeGreaterThan(10);
    for (const name of ["knowledge-panels.tsx", "identity-panels.tsx", "link-out-panel.tsx"]) {
      expect(HOME_FILES).toContain(path.join(HOME_DIR, name));
    }
  });

  it.each([...HOME_NOT_SURFACES])("the opt-out entry %s still exists", (name) => {
    expect(existsSync(path.join(HOME_DIR, name))).toBe(true);
  });

  it.each(FILES)("%s wears no pressed-in recipe", (file) => {
    const code = readCode(file);
    const sanctioned = HOME_CONCAVE_SANCTIONED.get(path.basename(file));
    for (const forbidden of FORBIDDEN) {
      if (forbidden === sanctioned) continue;
      expect(code, `${file} must not use ${forbidden}`).not.toContain(forbidden);
    }
  });

  // The carve-out must go when the credit bar stops using the meter, or it is just a hole.
  it.each([...HOME_CONCAVE_SANCTIONED])(
    "the sanctioned concave surface %s really does use %s",
    (name, recipe) => {
      const file = path.join(HOME_DIR, name);
      expect(existsSync(file)).toBe(true);
      expect(readCode(file)).toContain(recipe);
    }
  );

  // A repo-wide census, not a ban: the web keeps the concave recipe, the desktop may not take it
  // back. The lists may only shrink, and each entry says why it stays (`shared/ui/section-box.tsx`
  // points here).
  describe("the concave section recipe is off the desktop", () => {
    const ALL = [
      ...sources(path.join(REPO, "src")),
      ...sources(path.join(REPO, "apps", "desktop-ui", "src")),
    ];

    // Code only: a converted file's comments name what it stopped wearing.
    function wearers(recipe: string): string[] {
      return ALL.filter((file) => readCode(file).includes(recipe))
        .map((file) => path.relative(REPO, file))
        .sort();
    }

    it("finds source to sweep (a silent empty census would pass forever)", () => {
      expect(ALL.length).toBeGreaterThan(500);
    });

    it("`SectionBox` is mounted by the WEB playground and nothing else", () => {
      expect(wearers("SectionBox")).toEqual([
        "src/shared/ui/section-box.tsx",
        // Web-only: mounted only by `src/app/playground/page.tsx`.
        "src/features/playground/components/panes/members-pane.tsx",
      ].sort());
    });

    it("`SECTION_BOX_INSET` survives only where a ruling keeps it", () => {
      expect(wearers("SECTION_BOX_INSET")).toEqual([
        "src/shared/ui/section-box.tsx",
        // Frozen settings surfaces (INVARIANTS §15).
        "src/features/workspaces/components/workspace-danger-zone-core.tsx",
        "src/features/mcp-connect/components/connected-apps-section.tsx",
        "src/features/mcp-connect/components/remote-connect.tsx",
        "src/shared/layout/settings-modal/sections/delete-account.tsx",
        "apps/desktop-ui/src/components/settings-modal/account-actions.tsx",
      ].sort());
    });
  });

  // The shared recipe must stay built from `RAISED_WELL`, and the rows must wear it rather than a fork.
  it("uses the kit's RAISED well for its inputs", () => {
    const wells = readCode(new URL("../../../shared/ui/wells.ts", import.meta.url));
    expect(wells).toContain("export const RAISED_INPUT = `${RAISED_WELL}");
    const rows = readCode(new URL("./identity-editor-rows.tsx", import.meta.url));
    expect(rows).toContain("RAISED_INPUT");
  });

  // In-body controls (a row's Remove, the chip picker's Add) wear `shared/ui/open-scale-button.tsx`;
  // the footer is the form-dialog kit's and is pinned in `identity-editor.test.tsx`.
  it("wears the kit's 26px pill on the buttons inside its body", () => {
    const rows = readCode(new URL("./identity-editor-rows.tsx", import.meta.url));
    expect(rows).toContain("OpenScaleButton");
    expect(rows).toContain("OpenScaleIconButton");
    // A hand-written pill face is what the kit replaced.
    expect(rows).not.toContain("btn-light");
  });
});
