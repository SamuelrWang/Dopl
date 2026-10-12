/**
 * **PROSE EVICTED FROM A PUSHED SURFACE MUST STILL REACH AN AGENT** (ASK 9,
 * channel seq #4461, 2026-10-12).
 *
 * ⚠ **A MOVE AND A DELETION LOOK IDENTICAL TO EVERY OTHER GATE IN THIS PACKAGE.**
 * The schema budget only measures what is PUSHED, so cutting a rule out of
 * `posture`'s description makes that gate greener; the doctrine budget only
 * measures SIZE, so it is satisfied whether the bytes that arrived say anything
 * or not. Nothing else in the tree would notice if the rule had simply been
 * deleted to buy room for `cites` — which is exactly what this file refuses.
 *
 * ⚠ **PHRASES, NOT LENGTHS.** Each assertion names a RULE an agent needs in order
 * not to be wrong: that a posture is a request and not a setting, what the two
 * axes accept, and that `chain: "on"` is refused outright rather than quietly
 * narrowed. A length check would pass over 600 characters of anything.
 *
 * ⚠ **BOTH TOOL SETS**, because the doctrine is built per set and a rule that
 * reached only one of them would be missing for half the clients.
 */

import { describe, it, expect } from "vitest";
import { withToolSet } from "../call-ref.js";
import { channelDoctrine, doctrineSection } from "./channel-doctrine.js";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema.js";

/** The one section a caller is served when they ask for the arguments. */
const fieldsOf = (set: "legacy" | "granular") =>
  withToolSet(set, () => doctrineSection("fields"));

/** Every pushed `.describe()`, concatenated — what a client reads at handshake. */
const argProse = (set: "legacy" | "granular") =>
  withToolSet(set, () =>
    Object.values(CHANNEL_INPUT_SHAPE)
      .map((arg) => arg.description ?? "")
      .join("\n"),
  );

describe.each(["legacy", "granular"] as const)(
  "the posture rules survived the move to FIELDS (%s)",
  (set) => {
    it("🔒 a posture is a REQUEST, and the clamp sentence says so", () => {
      // The rule an agent is most likely to get wrong: it asks, the operator's
      // machine decides. Pinned by phrase in `channel-ops-agent-mode.test.ts`
      // before the move, and here after it.
      expect(fieldsOf(set)).toContain(
        "narrows whatever you ask for to their own ceiling and never widens past it",
      );
    });

    it("🔒 both axes' accepted values are still stated", () => {
      const fields = fieldsOf(set);
      expect(fields).toContain("ask | auto | full");
      expect(fields).toContain("auto_inbound");
      // The runtime-word escape hatch, which the enum alone does not explain.
      expect(fields).toMatch(/runtime's own word/);
    });

    it("🔒 `chain: \"on\"` is REFUSED, not narrowed — the surprise is the point", () => {
      // An agent that believes "on" degrades gracefully writes a launch that
      // fails. This sentence is the whole reason `chain` had a description.
      expect(fieldsOf(set)).toMatch(/REFUSED/);
      expect(fieldsOf(set)).toContain("inherit");
    });

    it("🔒 and the citation rule it was moved to pay for is there too", () => {
      const fields = fieldsOf(set);
      expect(fields).toContain("cites");
      // The ruling's five points, each by its own phrase.
      expect(fields).toMatch(/TYPED NUMBER DOES NOT/);
      expect(fields).toMatch(/\bseq\b/);
      expect(fields).toContain("REFUSED");
      expect(fields).toMatch(/cross-channel is refused/i);
    });

    it("🔒 the pushed surface still POINTS at it — a pull nobody knows about is a deletion", () => {
      // The one sentence left on the param has to send a reader somewhere, or the
      // rules are pulled and unfindable.
      const prose = argProse(set);
      expect(prose).toContain("how much freedom to ASK FOR");
      expect(prose).toContain("see FIELDS");
    });

    it("🔒 the moved prose is NOT still pushed — otherwise nothing was paid", () => {
      // The other half of the ratchet: if the clamp sentence is in both places the
      // schema never shrank and `cites` was never paid for.
      expect(argProse(set)).not.toContain(
        "narrows whatever you ask for to their own ceiling",
      );
    });

    it("🔒 the whole document still carries both, however it is assembled", () => {
      // `doctrineSection` serves one section; this is the same claim against the
      // full pull, so a future re-sectioning cannot drop either rule silently.
      const whole = withToolSet(set, channelDoctrine);
      expect(whole).toContain("narrows whatever you ask for");
      expect(whole).toContain("cites");
    });
  },
);
