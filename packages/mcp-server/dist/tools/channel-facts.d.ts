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
 * The longest a single value may render. ⚠ THE VALUES A CALLER HAS TO COPY MUST
 * FIT WHOLE — that is the whole constraint, and the number is derived from the
 * LONGEST of them rather than guessed:
 *   - a UUID thread or message id — 36
 *   - an `@agent-<id>` handle — 14
 *   - **a LEGACY ad-hoc thread id, `task-<channel uuid>-<seq>` — 45**
 *
 * ⚠ **IT WAS 40 AND THAT WAS A DATA-LOSS BUG** (found 2026-09-02 by the suite
 * that pins this file). A legacy id clipped at 40 keeps `task-` plus the channel
 * uuid — the part EVERY ad-hoc id in one channel shares — and drops the trailing
 * seq, which is the only half that distinguishes them. Two different exchanges
 * rendered byte-identical lines. It is also precisely the id a caller must echo
 * back on every post to keep an inherited exchange from forking, and a caller
 * that INHERITED it has no other copy. (`channel-render-threads.ts › shortRef`
 * exists for the same reason and abbreviates from the OTHER end.)
 */
export declare const FACT_VALUE_MAX = 48;
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
