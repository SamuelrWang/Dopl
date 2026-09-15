/**
 * 🔒 THE RAW AGENT ID IS NEVER USER-VISIBLE (Samuel, 2026-08-27; **SHARPENED 2026-09-15**) — a
 * SOURCE SWEEP.
 *
 * An agent id is an eight-character machine token (`main/agent-id.js`, `^[a-z][a-z0-9]{7}$`).
 * Every surface that shows an agent shows its DISPLAY NAME instead: the operator's own name from
 * `main/agent-names.js`, falling back to `New Agent`. `agents-model-identity.ts ›
 * agentDisplayName` is that one resolution and every surface runs it.
 *
 * ⚠ **THE `#<id>` FALLBACK IS GONE AND ITS DEFENCE WENT WITH IT.** This file used to say the
 * fallback was *"a NAME the operator was shown at launch and accepted, not a raw id leaking
 * through"* — true only because the launch dialog PREFILLED the field with it, which is itself
 * the thing Samuel asked to stop: *"for new agents, right now it auto fills the name with the
 * ID. The name should be blank … if a user launches an agent with no name, just give it the
 * name, New Agent."* The defence and the defect were one mechanism, so both are removed and the
 * interpolation ban below is now unconditional.
 *
 * ⚠ **AND THE EXEMPTION WAS WHERE IT LEAKED FROM.** `attribution-pill.tsx` was excused from the
 * interpolation ban below, on the 2026-08-31 reading that `` `#${agentId}` `` was a name — so the
 * TRANSCRIPT, the surface an operator reads most, rendered the raw id under a green sweep for a
 * fortnight. **A sweep with a named exemption tests the exemption's argument, not the rule**, and
 * that argument was the one Samuel later withdrew. There is no exemption now.
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
      // ⚠ **NO EXEMPTION SINCE 2026-09-15.** `attribution-pill.tsx` was excused here while its
      // `` `#${agentId}` `` was ruled a name; Samuel withdrew that ruling, and the pill now asks
      // `shared/lib/agent-name.ts › agentFaceName` like everything else. The header carries why
      // an exempted file is the one place a sweep cannot see.
      expect(box, `${file} interpolated the raw id into a string`).not.toMatch(
        /\$\{\s*agentId\s*\}/
      );
    }
  });

  it("🔒 the unnamed FACE has one source, and the two surfaces that faked it ask for it", () => {
    // ⚠ **THE STRING WAS WRITTEN OUT TWICE AND THAT WAS THE BUG** (2026-09-15).
    // `agents-model.ts` and `attribution-pill.tsx` each carried their own `` `#${agentId}` ``,
    // and a third reader had since appeared on the SERVER (`home/server/overview-tally.ts`,
    // falling back to `channel_sessions.name`, which IS the id). Three copies of one face is how
    // one of them goes on leaking after the other two are fixed; `shared/lib/agent-name.ts` is
    // the one source, and it is shared with the server precisely because the server had its own.
    //
    // ⚠ **THIS IS A POSITIVE ASSERTION RATHER THAN A BAN ON THE WORDS, AND THE ATTEMPT THAT WAS
    // NOT IS WORTH RECORDING.** A blanket `not.toMatch(/"New Agent"/)` over every surface failed
    // on `composer-toolbar.tsx`, whose `label="New Agent"` is the LAUNCH BUTTON (INVARIANTS §11
    // names it) — a different thing that happens to be the same two words. A sweep that cannot
    // tell a button's label from an agent's face would be answered by renaming one of them,
    // which is the tail wagging the product.
    expect(
      codeOf("attribution-pill.tsx"),
      "the transcript pill stopped asking for the shared face"
    ).toContain("agentFaceName(");
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
