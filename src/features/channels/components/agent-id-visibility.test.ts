/**
 * 🔒 THE RAW AGENT ID IS NEVER USER-VISIBLE (Samuel, 2026-08-27) — a SOURCE SWEEP.
 *
 * An agent id is an eight-character machine token (`main/agent-id.js`, `^[a-z][a-z0-9]{7}$`).
 * Every surface that shows an agent shows its DISPLAY NAME instead: the operator's own name from
 * `main/agent-names.js`, falling back to `Agent #<id>` — which is a NAME the operator was shown at
 * launch and accepted, not a raw id leaking through. `agents-model.ts › agentDisplayName` is that
 * one resolution and every surface runs it.
 *
 * ⚠ IT SHIPPED WRONG ON THREE SURFACES AT ONCE, which is why this is a sweep and not three cases:
 * the pop-out's OS window title read "Dopl — aczfk4p8", its header read "rpa6kq24", and the direct
 * composer's placeholder read "Message rpa6kq24". One helper (`agentDisplayId`) was reached from
 * six call sites, and nothing said it must not be.
 *
 * ⚠ THE ONE EXCEPTION IS THE AGENT'S OWN OUTPUT. If an agent writes its id into a message, that
 * is the agent identifying itself and the transcript renders what it wrote. This sweep is about
 * CHROME the product composes.
 *
 * ⚠ SOURCE, NOT RENDER, for the reason every sweep in this tree gives: the surfaces mount in
 * different trees under different bridges, and a render test for each would be four harnesses
 * asserting one rule. What holds is that no component calls the id-only helper.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dirname;

/** Every component in this directory — the surfaces that render agent chrome. */
const SURFACES = readdirSync(HERE).filter(
  (f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f)
);

/** Code only — a comment naming the banned helper is how this rule is EXPLAINED. */
const codeOf = (f: string): string =>
  readFileSync(join(HERE, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

describe("no surface renders a raw agent id", () => {
  it("finds the surfaces to sweep (a silent empty sweep passes forever)", () => {
    expect(SURFACES.length).toBeGreaterThan(20);
  });

  it.each(SURFACES)("%s calls no id-only display helper", (file) => {
    // ⚠ `agentDisplayId` ANSWERS THE RAW ID and is `agentDisplayName`'s internal fallback only.
    // A component reaching it puts eight machine characters where a person's eye expects a name.
    expect(codeOf(file), `${file} renders the raw id — use agentDisplayName`).not.toContain(
      "agentDisplayId("
    );
  });

  it("no surface puts the id where text goes", () => {
    // ⚠ THE HELPER BAN ABOVE IS NOT THE WHOLE RULE, and `bits.tsx › AgentChip` is why. It never
    // called `agentDisplayId` — it took an `agentId` prop of its own and printed it verbatim in a
    // mono span, left over from the 2026-08-22 multiplayer chip that `attribution-pill.tsx` has
    // since replaced. The prop had NO caller (`mentions-list.tsx` mounts it bare), so the sweep
    // stayed green over a component that renders eight machine characters the moment anyone
    // passes them.
    //
    // ⚠ IT BANS RENDERING THE ID, NEVER HOLDING IT. Almost every surface here takes an `agentId`
    // legitimately — it is the third coordinate of every session op (`agent-composer.tsx` sends
    // to it, `agent-panel.tsx` addresses it, `agent-window.tsx` keys on it) — so a ban on the
    // PROP would forbid the wiring the whole feature runs on. Measured: that version failed on
    // `agent-composer.tsx`, which renders no id at all. The two shapes below are TEXT positions.
    for (const file of SURFACES) {
      const box = codeOf(file);
      // A JSX text child — literally what the chip did: `<span …>{agentId}</span>`.
      expect(box, `${file} renders the raw id as text`).not.toMatch(/>\s*\{\s*agentId\b/);
      // ⚠ THE PILL IS THE ONE EXEMPTION, because its interpolation IS the display name.
      // `attribution-pill.tsx › attributionName` builds `Agent #<id>` — the same string
      // `agents-model.ts › agentDisplayName` falls back to — which §11 states is a NAME the
      // operator accepted at launch, not an id leaking through.
      if (file === "attribution-pill.tsx") continue;
      expect(box, `${file} interpolated the raw id into a string`).not.toMatch(
        /\$\{\s*agentId\s*\}/
      );
    }
  });

  it("the three surfaces that shipped it wrong resolve the NAME", () => {
    // Named individually so a failure says which surface regressed, not "the sweep broke".
    for (const [file, what] of [
      ["agent-window.tsx", "the pop-out's title, header and composer placeholder"],
      ["agent-panel.tsx", "the slide-out's header and composer placeholder"],
      ["thread-info-tab.tsx", "the thread Info tab's agent rows"],
    ] as const) {
      expect(codeOf(file), `${what} stopped resolving the display name`).toContain(
        "agentDisplayName("
      );
    }
  });
});
