/**
 * THE HOVER LIFT EVERY CARD FACE WEARS — one recipe, two consumers, and the
 * reason it is a module rather than a copied string.
 *
 * 🔒 **SAMUEL, 2026-09-21:** *"when I hover over a card, this needs to be for
 * the agents page and the knowledge page. It should translate up a bit more and
 * have a slightly more visible shadow. Right now ... the agents cards and the
 * knowledge cards don't have the same animation. They should have the same
 * animation."*
 *
 * ⚠ **THEY REALLY WERE TWO DIFFERENT ANIMATIONS, NOT TWO TUNINGS OF ONE.**
 * Knowledge lifted `translateY(-1px)` with `0 1px 2px / 0 8px 20px` at 5%;
 * Agents did **not move at all** — it was `transition-shadow` with a shadow-only
 * change — so the two faces disagreed about whether a card rises on hover, which
 * is the thing he noticed before any number.
 *
 * ⚠ **TWO CONSUMERS IN TWO LANGUAGES, WHICH IS WHY THE VALUES LIVE HERE:**
 *   - `src/features/agent-identities/components/identity-section.tsx` — a
 *     Tailwind arbitrary-value class string.
 *   - `src/features/knowledge/components/knowledge-v2/knowledge-v2.module.css ›
 *     .card:hover` — a CSS module, which cannot import a TS constant.
 * A CSS-module class is a build artifact and a Tailwind arbitrary is a string,
 * so neither is comparable to the other at runtime. `card-lift.test.ts` is
 * therefore a SOURCE scan that reads both files and fails when they drift —
 * bidirectionally, the same idiom `frame-skeletons.test.tsx` uses for the
 * skeleton geometry. **Change the numbers HERE, then in the module, in one
 * commit; the test names the other file when you forget.**
 *
 * ⚠ **THE CARD'S RESTING SHADOW IS NOT HERE.** The two faces rest differently
 * on purpose — Knowledge on its own `.card` shadow, Agents on the kit's
 * `.bento` — and he asked for the HOVER to match, not the resting state.
 */

/** How far a card rises. ⚠ Was `-1px` on Knowledge and nothing on Agents. */
export const CARD_LIFT_Y = "-3px";

/** The lifted shadow: a tight contact pair plus the wide ambient one. */
export const CARD_LIFT_SHADOW =
  "0 2px 4px rgba(0, 0, 0, 0.07), 0 12px 28px rgba(0, 0, 0, 0.10)";

/**
 * ⚠ `transform` AND `box-shadow`, NOT `transition-shadow` ALONE — that was the
 * Agents face's bug: the class transitioned only the shadow, so even once it had
 * a transform it would have SNAPPED. Kept at the `.card` transition's own 0.14s
 * ease so the two faces move at one speed.
 */
export const CARD_LIFT_TRANSITION = "transition-[transform,box-shadow] duration-[0.14s] ease-out";

/**
 * The Tailwind consumer's whole hover recipe. ⚠ Arbitrary values may not
 * contain spaces, so the shadow's are escaped with `_` — that is Tailwind's own
 * spelling, and `card-lift.test.ts` compares the UNESCAPED form against the CSS
 * module so the two cannot drift behind the escaping.
 */
export const CARD_LIFT_CLASS = [
  CARD_LIFT_TRANSITION,
  `hover:-translate-y-[${CARD_LIFT_Y.replace("-", "")}]`,
  `hover:shadow-[${CARD_LIFT_SHADOW.replace(/, /g, ",").replace(/ /g, "_")}]`,
].join(" ");
