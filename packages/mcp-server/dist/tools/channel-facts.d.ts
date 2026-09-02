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
import type { LaunchDirective } from "@dopl/client";
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
/**
 * THE DELIVERY VERDICT, as a token — what the server did with a message, which
 * IS the acknowledgement (2026-09-02, A9's keystone contract).
 *
 * ⚠ **TWO FIELDS, ONE FACT, AND THE SECOND ONE IS THE TENSE.** `delivery` alone
 * is the server's write-time PREDICTION over the sessions it could see; once the
 * operator's machine reports back, `deliveryAt` carries the stamp and the same
 * word becomes what actually HAPPENED. A caller that reads only the word cannot
 * tell a forecast from a receipt, and the forecast is the one it must not act on
 * as if a machine had answered — so the prediction is rendered `woken?` and the
 * receipt `woken`, one character carrying the whole distinction.
 *
 * ⚠ `undefined` (the field never printed) means THIS SERVER DOES NOT COMPUTE ONE
 * — a deployment older than `20260912120000_channel_delivery_verdict`. That is
 * not `none`: `none` is a verdict, an absent field is the absence of one, and
 * collapsing them tells a caller nobody was reachable when nobody was asked.
 */
export declare function deliveryFact(delivery: string | null | undefined, deliveryAt: string | null | undefined): string | undefined;
/**
 * **THE RESOLVED POSTURE, AS FACTS — AND THE NULL CASE IS THE WHOLE POINT.**
 *
 * ⚠ `null` MEANS "NOT REPORTED". It does not mean "unclamped" and it is never
 * the requested value echoed back. The desktop CLAMPS a requested posture to the
 * operator's own stored ceiling without being obliged to say so, so an
 * orchestrator told "you got what you asked for" on the strength of an empty
 * column would size its next instruction for room the agent does not have —
 * exactly the reading this function exists to refuse. ⚠ SO THE FALLBACK IS THE
 * WORD `not reported`, NOT A GUESS: echoing `startToolMode` back would produce a
 * value that is right whenever nothing was clamped and confidently wrong
 * precisely when it mattered.
 *
 * ⚠ THE SHAPE IS FIXED — `posture=<tools>/<messages> chain=on|off` — because it
 * is read by a model choosing its next action, and a line that changes shape
 * between calls gets parsed by guesswork. ⚠ `-` FOR AN AXIS THAT WAS NOT
 * REPORTED EVEN WHEN THE OTHER ONE WAS: partial is a real shape, and filling the
 * gap from the REQUEST would put an unconfirmed value beside a confirmed one,
 * indistinguishable.
 *
 * ⚠ **RENDERED AS TWO FACTS RATHER THAN A PARAGRAPH** (T10 ∩ T24). The reason a
 * caller must not read silence as success is standing doctrine and lives in
 * `channel-doctrine.ts`; what only THIS call can say is the two values.
 */
export declare function postureFacts(d: LaunchDirective): Record<string, FactValue>;
/**
 * **WHAT THE SERVER PERMITTED** — A9's G6/G7/G8 half of the same question, and
 * the reason it is SEPARATE fields rather than a better `posture=` (2026-09-02).
 *
 * ⚠ **THREE GROUPS, NOT TWO SPELLINGS OF ONE.** `start*` is what was ASKED,
 * `applied*` is what the MACHINE reported, and `resolved*` is what the SERVER
 * allowed to be asked. G6's rule — *"your operator's machine narrows what you
 * ask; it never widens"* — was enforced on the desktop alone, so an offline or
 * older machine narrowed nothing and reported nothing: `posture=not reported`
 * was the whole answer, and it was indistinguishable from "nothing was clamped".
 * The server's clamp happens either way, which is exactly why it is worth a
 * field of its own rather than being folded into the machine's echo.
 *
 * ⚠ **SILENT WHEN THE SERVER RECORDED NO CEILING**, which is every channel today
 * (F-449: the columns have no editing surface yet). An `allowed=-/-` on every
 * launch would be a line of noise claiming a decision nobody made.
 *
 * ⚠ **`model=` IS AN ECHO AND NEVER A REFUSAL** (G8). It prints only when the
 * server resolved the request to a DIFFERENT canonical id than the caller typed
 * — the case the caller cannot otherwise see. A model this build does not
 * recognise resolves to `null` and still reaches the machine; the silence there
 * is the honest answer, and `directive.model` above already says what was asked.
 */
export declare function allowedFacts(d: LaunchDirective): Record<string, FactValue>;
