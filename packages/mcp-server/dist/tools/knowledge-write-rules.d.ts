/**
 * 🔒 **THE KB AUTHORING RULES, AS THEY ARE ENFORCED AT AN AGENT'S WRITE**
 * (Samuel's ruling 2026-09-18, option A on the fix list's Q1).
 *
 * ⚠ **TWO ARE REFUSALS AND TWO ARE NUDGES, AND THE SPLIT IS THE RULING.** An
 * AGENT save is REFUSED when the entry has no real summary, and when a long
 * body carries no `##` headings; cross-references and supersession markers are
 * nudged. **A HUMAN TYPING IN THE APP IS NEVER BLOCKED** — that half of the
 * ruling lives where humans write (the web/desktop editor), and nothing in this
 * package can reach a person, which is exactly why the refusals belong here.
 *
 * ⚠ **WHY A REFUSAL AND NOT A LOUDER NUDGE.** Wave 4 measured the cost of a
 * rule nothing enforces: 18,000 characters read to extract 900 on a base whose
 * eight long entries carried no headings, and the only reproducible wrong turn
 * in the trial came from one-word excerpts ("Fuel.", "Rates."). A nudge stapled
 * to a success is a rule the agent has already decided it does not need.
 *
 * ⚠ **EVERY REFUSAL IS ONE LINE AND NAMES EXACTLY WHAT TO ADD**, in the
 * `reason=` / `retry=` shape every other refusal on this surface uses — an
 * agent that cannot tell what would satisfy the rule invents headings or drops
 * the write, which is the risk the ruling's option (b) was weighed against.
 *
 * ⚠ **NONE OF THIS IS PUSHED.** These strings are PER-CALL
 * (`write-result-budget.test.ts`), not in the 48,791 served on connection; the
 * standing form of the rules rides `knowledge-doctrine.ts`, which is PULLED.
 */
/**
 * **THE EXCERPT RULE.** Refuse an absent, empty, one-word, or title-restating
 * summary. Returns the refusal line, or `null` when the excerpt is real.
 *
 * ⚠ **THE THREE FAILING SHAPES ARE THE RULING'S, NOT A LENGTH.** Wave 4's own
 * recommendation added "shorter than roughly 40 characters"; that is NOT
 * enforced here, because a short excerpt that states the answer value outright
 * ("$3.18/gal base peg") is the BEST excerpt the trial measured, and a length
 * floor would refuse it. Empty, one word, and "the title again" are the shapes
 * with no legitimate case.
 */
export declare function excerptRefusal(excerpt: string | null | undefined, title: string): string | null;
/**
 * **THE HEADINGS RULE.** A long body with no `##` at all is refused.
 *
 * ⚠ **ONLY ON A WHOLE-BODY WRITE, AND THAT IS NOT A LOOPHOLE.** With
 * `section=`, `body` is one section's new content and the entry's real body is
 * the server's merge of it — a body this process never sees, so a length test
 * here would refuse on the wrong document. The sectioned path keeps the
 * post-write nudge (`knowledge-sections.ts › unsectionedNudge`), which measures
 * the merged result; and a caller passing `section=` has by construction
 * addressed a heading.
 */
export declare function unsectionedRefusal(body: string, section: string | undefined): string | null;
/**
 * **THE CROSS-REFERENCE NUDGE** (Wave 4 b4 — it hit all four runs). A pointer
 * that names a document class and no path is a correct sentence an agent cannot
 * act on: four agents recovered four different ways, one of them by explicit
 * luck.
 *
 * ⚠ **A NUDGE, NOT A REFUSAL** — the ruling names two refusals and this is not
 * one of them, and a prose test strict enough to refuse on would refuse real
 * writing.
 */
export declare function crossRefNudge(body: string): string | null;
/**
 * **THE SUPERSESSION NUDGE** (Wave 4 b5). This is the rule the trial proves
 * **already works**: both Poor agents skipped the 2024 decoy and answered
 * correctly with no metadata help at all, purely because the superseding entry
 * OPENED by saying it replaced it. One called it *"the single best piece of
 * signposting in the base"*.
 *
 * ⚠ **POSITION IS THE WHOLE RULE.** A body that says it supersedes something in
 * paragraph nine has told a reader who already paid for paragraphs one to
 * eight. So a body whose FIRST line carries the marker passes silently, and one
 * that carries it lower down is nudged to move it — and to mark the superseded
 * entry's excerpt, which is the belt-and-braces half the Good base also had.
 */
export declare function supersessionNudge(body: string): string | null;
