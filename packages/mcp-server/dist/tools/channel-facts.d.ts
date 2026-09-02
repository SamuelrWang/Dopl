/**
 * THE TERSE WRITE RESULT — ONE line of `key=value` facts about the call that was
 * just made, and nothing else (T10/T12, 2026-09-02).
 *
 * ⚠ WHY IT EXISTS. A `post` result used to carry ~2.5–3.5k characters: the
 * addressing paragraph, the thread-linkage paragraph, the five causes a tag
 * resolves to nobody, the main-room sparseness bar, the await lecture and its
 * stop rule. All of it was STANDING DOCTRINE — true before the call and true
 * after it — re-transmitted per write. It now lives once in
 * `channel-doctrine.ts`, and what a result carries is what only THIS call can
 * say: what the server did with the message it was handed.
 *
 * ⚠ THE DIVIDING LINE, because it is the one thing to get right here. A FACT is
 * something the server observed about this call and the caller cannot derive:
 * the seq it was given, whether the thread tag survived the write, how many
 * readers the mention resolver stamped, what the machine answered. A RULE is
 * true of every call and belongs in the doctrine. **A fact whose paragraph moved
 * to the doctrine keeps its VERDICT here, as a token** — `tags=0/2` is the whole
 * of "your tag reached nobody", and the five causes are one `op="help"` away.
 * Dropping the verdict with the paragraph would delete the only signal that
 * catches a silent delivery failure (INVARIANTS §10).
 *
 * ⚠ A VALUE WITH A SPACE IS QUOTED, so the `key=value` pairs stay parseable and
 * no operator- or peer-chosen name (a template name, a tool label) can invent a
 * field by containing `something=`.
 *
 * ⚠ VALUES ARE BOUNDED, SO A LINE'S LENGTH DEPENDS ONLY ON ITS FIELD COUNT.
 * {@link FACT_VALUE_MAX} clips every value, so a line can never exceed
 * `head + Σ(key + 1 + FACT_VALUE_MAX + 1)` — **no peer- or caller-authored
 * string can blow a result up**, which is the property that matters, and
 * `channel-facts.test.ts` pins it.
 *
 * ⚠ **THAT IS NOT THE SAME AS "ALWAYS ≤ {@link WRITE_RESULT_MAX_CHARS}", AND
 * SAYING SO WOULD BE A LIE THIS FILE CANNOT KEEP.** Nine maximal fields exceed
 * 300 on their own. The 300 is a budget over what the OPS ACTUALLY SEND — the
 * ops use 5-9 short fields, and `tool-budget.test.ts` proves each op's fullest
 * ordinary result against real fixtures. **So an op that adds a tenth field, or
 * one whose value is routinely long, must re-check that suite** — the renderer
 * stops any single value running away, and the budget test is what holds the
 * number.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (`parity.test.ts`) and the removed-vocabulary source scan
 * (`channel-law.test.ts`).
 */
/**
 * THE BUDGET FOR ONE WRITE RESULT. ⚠ From the spec's own acceptance line —
 * "every write result ≤300 chars" — and pinned as a test rather than left as an
 * intention, because prose grows back one honest sentence at a time.
 */
export declare const WRITE_RESULT_MAX_CHARS = 300;
/**
 * The longest a single value may render. ⚠ Chosen so that even a result carrying
 * eight maximal fields stays inside {@link WRITE_RESULT_MAX_CHARS}; a UUID (36)
 * and an `@agent-<id>` handle (14) both fit whole, which is the point — the
 * values a caller has to COPY are never the ones that get clipped.
 */
export declare const FACT_VALUE_MAX = 40;
/** A value nobody reported, or that does not apply to this call. ⚠ NEVER zero. */
export declare const NOT_APPLICABLE = "-";
/**
 * What a fact may be. ⚠ `null`/`undefined`/`""` all render {@link NOT_APPLICABLE}
 * rather than being omitted: a missing KEY makes a reader wonder whether the
 * server forgot to look, where a dash says it looked and there was nothing.
 */
export type FactValue = string | number | boolean | null | undefined;
/**
 * THE ONE WRITE-RESULT RENDERER: a head verb, then `key=value` pairs in the
 * order given.
 *
 * ⚠ ORDER IS THE CALLER'S AND IS MEANINGFUL — the identifier a follow-up call
 * needs (a seq, an agent handle) goes first, so a reader that stops at the first
 * pair has the useful half.
 *
 * @example factsLine("posted", { seq: 858, thread: undefined, addressed: false })
 *          // → "posted seq=858 thread=- addressed=no"
 */
export declare function factsLine(head: string, fields: Record<string, FactValue>): string;
/**
 * HOW A TAG LANDED, as a token. ⚠ `resolved/attempted` and nothing else: the
 * five reasons a member handle resolves to nobody are standing doctrine and this
 * server can distinguish none of them, so a paragraph here would be five guesses
 * on every post. `0/2` is the verdict; `op="help"` is the explanation.
 *
 * ⚠ AGENT HANDLES ARE NOT COUNTED HERE and must never be: they are resolved on
 * the operator's own machine, never by the server's mention resolver, so a
 * fraction over them would report a stamp nobody was ever going to make. They
 * ride the `wake=` field instead — a statement of what was WRITTEN, not of what
 * arrived.
 */
export declare function tagFact(resolved: number, attempted: number): string | undefined;
