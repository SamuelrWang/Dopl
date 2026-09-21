/**
 * **THE PULLED DOCTRINE'S OWN BUDGET** for `dopl_channel` (slice A6b,
 * 2026-09-02).
 *
 * ⚠ **A THIRD BUDGET, AND IT IS BUDGETED DIFFERENTLY FROM THE OTHER TWO ON
 * PURPOSE.** A tool's DESCRIPTION (`tool-budget.test.ts`) and its INPUT SCHEMA
 * (`channel-schema-budget.test.ts`) are PUSHED: every connected client pays for
 * them on every connection, including the sessions that never call the tool, so
 * their ratchets only ever move down. `channel-doctrine.ts` is PULLED — nobody
 * pays for it until an agent asks — which is exactly why it needed a gate of its
 * own: prose evicted from the two pushed surfaces lands HERE, and an unmeasured
 * destination is not a diet, it is a relocation.
 *
 * ⚠ **AND WHY IT IS ITS OWN FILE**, the reason `channel-schema-budget.test.ts`
 * gives: `tool-budget.test.ts` belongs to the budget-gates slice, and a
 * per-slice assertion file is what keeps two waves from colliding on merge.
 */

import { describe, it, expect } from "vitest";
import {
  CHANNEL_DOCTRINE,
  DOCTRINE_SECTIONS,
  DOCTRINE_SECTION_NAMES,
  doctrineSection,
  type DoctrineSection,
} from "./channel-doctrine.js";

/**
 * ⚠ **32,728 → 8,997 ON 2026-09-02 (slice B8), AND IT IS A REWRITE RATHER THAN
 * A TRIM.** The document had become the destination for every paragraph evicted
 * from a PUSHED string — `REFUSALS` alone was 5,765 characters, `CHANNEL_OWN_AGENTS`
 * 4,873, `AWAITING` 3,914 on a hold that is now a knob on `read` — and an
 * unmeasured destination is not a diet, it is a relocation. It is re-sectioned
 * to the five ops and cut to CONTRACTS: what the nouns mean, what each op
 * promises, and the rule behind an argument whose `.describe()` may only carry
 * its contract. Fourteen sections became seven.
 *
 * ⚠ **{@link DOCTRINE_SECTION_MAX_CHARS} IS STILL THE ONE THAT GOVERNS COST**,
 * because a typical pull is ONE section; both are ratchets in both directions —
 * growing past a number fails, and shrinking below one without lowering it
 * fails too. ⚠ The largest section is now the LAW, which is the one section
 * whose size is capped for a second reason in `channel-law.test.ts`.
 */
// ⚠ **8,960 → 9,446 (2026-09-03), A RISE, AND HERE IS THE TRADE THAT LICENSES
// IT.** The `waiting` section (600 chars, its own tighter cap in
// `channel-doctrine.ts › WAITING_MAX_CHARS`) is where the ~1.4k of re-arm
// doctrine that used to ride EVERY hold result now lives — pulled once instead
// of pushed per empty hold, forever, to say nothing new. **A rise of 600 here
// against ~1,400 off every hold result is the design**; the READ section paid
// ~130 of it back by deleting the hold prose the new section states properly.
// A rise with no matching fall is prose laundering, and this is the gate for it.
// ⚠ **9,446 → 9,428 (2026-09-04, −18): THE ADDRESSING LINE SAYS MORE AND COSTS
// LESS.** MODEL's "WHO A MESSAGE IS FOR" now carries the READ line's new arrow
// vocabulary AND the rule that a person who names nobody is still answered
// (RR3's arms 3 and 4) — paid for by deleting its restatement of "anything
// threaded into an exchange you are a party to is yours", which the LAW block
// already says as "ACT ON ... messages in a THREAD you are a party to".
// **A rule that had two homes now has one, and the second was the expensive one.**
const DOCTRINE_MAX_CHARS = 12_591; // ⚠ **12,235 -> 12,591 (2026-09-21, +356): THE MCP LAUNCH RUNTIME FIELD (U9), AND IT IS RECORDED RATHER THAN FUNDED — READ THE NEXT FOUR SENTENCES BEFORE ACCEPTING IT.** 🔒 The defect it closes, verbatim from `docs/plans/2026-09-21-001-fix-codex-runtime-parity-plan.md`: *a live MCP launch carrying `model: "codex"` was accepted but started a Claude Sonnet agent, because the MCP contract has no runtime field and an unknown model falls through to the default adapter.* ⚠ **WHAT A CALLER CANNOT DERIVE IS THE WHOLE COST**: that `runtime` and `model` are TWO fields and neither selects the other, and that an unavailable runtime is REFUSED rather than swapped — which is the OPPOSITE of `model`'s own silent-fallback rule one field up, so an agent generalising from its neighbour would plan for the wrong outcome. ⚠ **THE TRIM CAME FIRST AND THE STANDING RULE WAS MOVED, WHICH IS THIS GATE'S OWN INSTRUCTION**: the full asymmetry lives in `channel-doctrine.ts > MANAGE` (PULLED), and the pushed describe was cut to one clause per fact — what it is, what it is not, what omitting means, what an unavailable one does. ⚠ **AND TWO CHEAPER SHAPES WERE REFUSED.** (a) A `z.enum(["claude","codex","cursor"])` is not cheaper AND is wrong: the roster is the operator's DESKTOP REGISTRY and moves with a desktop release, so the enum would refuse a runtime a newer machine already ships. (b) Overloading `model` IS the defect. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **11,643 → 12,235 (2026-09-18, +592, third pass): `@desktop` — AN ADDRESS THAT DID NOT EXIST ANYWHERE BEFORE.** Samuel's ruling on the external-session group tag adds two rules a caller cannot derive from any schema: MODEL gains the THREE AUDIENCES (a person short and plain, an agent complete, `@desktop` complete and agent-style) beside its own "WHO A MESSAGE IS FOR" arrow vocabulary, and READ gains the outside-session contract — you see every message, nothing is filtered, act on the two marks, UNTAGGED IS NOT NOT-FOR-YOU, and tell agents you task to reply `to=@desktop`. ⚠ **THE AUDIENCE RULE WAS WRITTEN INTO `send` FIRST AND MOVED, AND THE SECTION RATCHET IS WHAT MOVED IT** — `send` went to 3,827 against {@link DOCTRINE_SECTION_MAX_CHARS} 3,600, and raising a STRUCTURAL cap to fit a rule that belongs in `model` (whose whole subject is who a message is for) would have been the laundering this file exists to catch. `send` is unchanged at 3,573; `model` absorbed it with headroom to spare. ⚠ **+592 IS RECORDED, NOT FUNDED, AND THE REASON IS THE SAME ONE THE COLOUR WAVE AND THE UNIQUENESS RULE GAVE**: this behaviour is NEW rather than relocated, so there is no pushed fall to point at — the schema is untouched by this pass and `SERVED_TOTAL_CEILING` does not move. ⚠ **AND THE SECOND HALF IS THE EXPENSIVE ONE ON PURPOSE.** The READ paragraph is read by the one caller class that cannot be taught any other way: an outside session has no start card, no launch body and no operator briefing — the doctrine is the only place it can be told that untagged traffic may still be its own, which is the whole of ruling (b). ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **11,585 → 11,643 (2026-09-18, +58, second pass): SAMUEL'S RULING ON THE TWO OPEN QUESTIONS.** *"Agents should only be woken up when addressed (besides the logic for a user with no @ in their message)."* The LAW's ADDRESSING A PERSON bullet said addressing a person *"triggers that member's listener, which is what can start their agent"* — true of a PERSON's post and FALSE of an agent's from this change on, so it now says the post reaches the person and NOT their agents, and names the remedy (name the agent). ⚠ **A FALSE SENTENCE IS NOT A BUDGET SAVING**, and this one would have taught the exact behaviour the ruling removes. ⚠ **+58 IS RECORDED, NOT FUNDED** — the pushed side is untouched by this pass. // ⚠ **10,502 → 11,585 (2026-09-18, +1,083): THE ADDRESSING STRUCTURE, AND IT IS RECORDED RATHER THAN FUNDED.** Samuel's ruling replaces an ABSENCE with a CHOICE — *"agents posting in a channel should always be adding to or addressing another agent, or addressing someone … I don't think there should ever be messages that have no @ unless it really is purely just posting … we should bake this into the structure"* — plus *"agents might need to respond to multiple agents … and it could be multiple people on the channel."* Three rules that did not exist anywhere before land here: the two states and the REFUSAL between them (LAW + SEND), the RECIPIENT LIST across both namespaces (LAW + SEND + MODEL's arrow), and the 4-branch CHOOSER. ⚠ **AND ONE DELETION PAID PART OF IT, WHICH IS THE HALF WORTH NAMING**: the LAW's own-agents bullet no longer teaches *"that tag, in a body or in `to`"*, because the body half became FALSE for an agent author in the same change — a doctrine that kept it would have taught the very defect the wave closes (a report saying *"handed off to @x"* woke `@x`). ⚠ **A RISE WITH NO MATCHING PUSHED FALL WOULD BE LAUNDERING, AND THIS ONE HAS A SMALL FALL AGAINST A LARGE RISE** — the pushed schema moves by one clause on `kind` and one on `to` (`channel-schema.ts › SCHEMA_MAX_CHARS`), because a pulled rule is paid for once by the caller that asks and a pushed one by every client on every connection, so the larger half belongs here. Same accounting the 2026-09-13 colour wave and the 2026-09-15 uniqueness rule used, for the same reason. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **10,478 → 10,502 (2026-09-16, +24): THE REFUSAL THAT NAMES ITS OWN SWITCH.** The direct lane's consent had NO CONTROL ANYWHERE for fifteen days, and an un-armed machine dropped every direction in SILENCE — 38 of 38 filed between 2026-08-31 and 2026-09-15 expired unclaimed, each reporting `pending, claimed=no` and naming no cause (`DIRECTION-DROP-TRACE.md`). Samuel's ruling (2026-09-16) makes an off lane REFUSE `blocked`, and a refusal an agent cannot act on is the defect being fixed — so the word has to name the setting a human must go and flip. ⚠ **IT WAS PAID DOWN TWICE BEFORE IT WAS RECORDED.** The clause began *"; on a DIRECTION it means that machine's \"Direct agents\" setting is off, so nothing was delivered and only a human there can change it"* (+134): the tail went first — `A REFUSAL IS A NORMAL ANSWER` two clauses earlier already says nothing is pending, and the facts line already carries `retry=no`. Then *"on a DIRECTION"* went, and that one is a FACT rather than a trim: `blocked` is absent from `launch-directive-vocab.js › REFUSAL_REASONS` and lives only in `agent-direction-wire.js`, so it can be nothing else and the qualifier was telling the reader something the word already said. ⚠ **AND "the operator declined" WAS REPLACED, NOT KEPT** — naming the control states the declining and the remedy in one clause, where the pair said it twice. ⚠ **+24 IS RECORDED RATHER THAN FUNDED, ON THIS FILE'S OWN PRECEDENT FOR A RULE THAT DID NOT EXIST BEFORE** (the 2026-09-13 colour wave and the 2026-09-15 uniqueness rule both did the same): there is no matching pushed fall because this behaviour is NEW, not relocated. 24 chars per pull buys the difference between an agent that reports a dead end and one that names the switch. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **10,330 → 10,478 (2026-09-15, +148): THE LAUNCH-TIME NAME-UNIQUENESS RULE, PULLED BY DESIGN.** Samuel's second ruling of the day put the collision rule where the name is COMMITTED, so the LAW now says names are UNIQUE among addressable agents (and drops the id-disambiguator clause it had for one hour), `MANAGE` says the result's `name=` is the tag and may not be the one asked for, and `FIELDS` states the rule beside `color`'s — the two are the same shape, and saying so is cheaper than saying either twice. ⚠ **TWO CUTS WERE MADE AND BOTH WERE REVERTED BY GATES THAT ARE RIGHT, WHICH IS WHY THE RISE IS THIS SIZE.** `MANAGE`'s opening was trimmed of *"another member's id reaches nothing"* and `"end"` of *"instance ids are never reused"*; `channel-schema-caps.test.ts` and `channel-ops-agent-doctrine.test.ts` pin both BY PHRASE, and they are right to — each is a CONTRACT a caller cannot derive, and cutting one is paying a budget by telling the truth less. **What survived as payment is `color` losing three restatements of its own `.describe()`.** The remainder is recorded rather than funded. ⚠ **A RISE WITH NO MATCHING PUSHED FALL WOULD BE LAUNDERING, AND THIS ONE HAS NEITHER A FALL NOR A PRETENCE OF ONE**: the pushed schema rose 28 in the same change and is recorded there too, because **the rule did not exist anywhere before** — the same accounting the 2026-09-13 colour wave used, for the same reason. ⚠ **AND THE DAY IS NET +118 AGAINST WHERE IT STARTED** (10,360), which is what three deleted FALSE clauses bought. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **10,360 → 10,342 (2026-09-15, −30): THE AGENT-ID-VISIBILITY WAVE, AND IT IS A NET FALL DESPITE ADDING A RULE.** The LAW's own-agents bullet now teaches the NAME tag and states *never write an agent id in a message*, with the duplicate-name carve-out; `MANAGE` says a launch must be NAMED; and the rename clause lost three claims that were FALSE — *stored on that one machine, it reaches no server, is invisible to every other member and is never addressable from here*. Every one of those had been untrue since `20260905120000` (`channel_sessions.display_name` is peer-visible by design) and since 2026-08-28 (the name door). ⚠ **PAID FOR IN FULL, AND THE PAYMENTS ARE NOT COSMETIC**: `@-TAGS` now teaches the SLUG (`@diana-taylor`) rather than the squashed form, which is the handle the picker has actually inserted since 2026-08-27; the `color` rule dropped a sentence its own `.describe()` already carries; and `client_msg_id`'s per-author clause lost a restatement. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **9,502 → 10,360 (2026-09-13, +858): THE AGENT-COLOUR CONTRACT, PULLED BY DESIGN.** 134 of it is a straight transfer off the PUSHED surfaces — `model`'s silent-fallback sentence into `MANAGE`, `info_card`'s "everyone sees it" into `ROOMS` (see `channel-schema.ts › SCHEMA_MAX_CHARS`) — and the rest is `FIELDS` gaining the colour rule: identity-never-status, unique per channel ACROSS MEMBERS, freed when an agent ends, the 409 with the free set, and the retry key. ⚠ **`FIELDS` IS THE SECTION BECAUSE ITS WHOLE SUBJECT IS AN ARGUMENT WHOSE RULE DOES NOT FIT IN A `.describe()`**, which is exactly what this is: the describe carries the contract (what it is, what omitting it does, that a taken one is a 409) and the rule behind it is here. It was put in `MANAGE` first and moved — `MANAGE` was over {@link DOCTRINE_SECTION_MAX_CHARS} and `FIELDS` was the smallest section, so the SECTION ratchet chose the home rather than a preference. ⚠ **A RISE WITH NO MATCHING PUSHED FALL WOULD BE LAUNDERING, AND THIS ONE HAS A SMALL FALL AGAINST A LARGE RISE** — the pushed schema rose 229 in the same change and the rise is recorded there too, because the colour rules did not exist anywhere before: this wave ADDS a feature rather than relocating one. What a pull costs is paid once by the caller that asks; what the schema costs is paid by every client on every connection, which is why the larger half of the prose is on this side. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ 9,428 → 9,502 (+74, 2026-09-06): the pulled half of the artifacts-wave trade — the pushed schema fell 762 in the same change.
// ⚠ **2,870 → 2,879 (2026-09-03): +9 ON EVERY SECTION, AND NOT ONE OF THEM
// GREW.** `SECTION_INDEX` names every section and rides every pull, so adding
// `waiting` to the table lengthened what a caller receives for `send`, `law`
// and the rest by the nine characters of the new name. The alternative was to
// cut nine characters out of the largest section to pay for a name that is not
// its own — a trade that would make the budget lie about where the cost is.
// ⚠ **2,879 → 3,600 (2026-09-18): `send` IS THE SECTION THAT GREW, AND IT IS THE RIGHT ONE.**
// The addressing structure is a contract of the WRITE op — what the two states are, how `to`
// carries a list across both namespaces, which branch to take — so it belongs where a caller
// that is about to send pulls it, not spread over three sections a sender would not ask for.
// ⚠ **THE SECTION RATCHET IS WHAT CHOSE THE HOME ONCE BEFORE** (the 2026-09-13 colour rule went
// to `FIELDS` because `MANAGE` was over this number); here it is being MOVED rather than obeyed,
// and that needs saying: `send` at 3,496 is now half again the next-largest section, so the next
// rule that lands on it should split the op's contract from its `kind` table instead of raising
// this again. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.**
const DOCTRINE_SECTION_MAX_CHARS = 3_600;

describe("the pulled doctrine is budgeted too, and by section", () => {
  it(`the whole document is at most ${DOCTRINE_MAX_CHARS} chars`, () => {
    expect(CHANNEL_DOCTRINE.length).toBeLessThanOrEqual(DOCTRINE_MAX_CHARS);
    expect(
      CHANNEL_DOCTRINE.length,
      "it shrank — lower DOCTRINE_MAX_CHARS to the measured size in the same commit",
    ).toBeGreaterThan(DOCTRINE_MAX_CHARS - 500);
  });

  it(`no single section exceeds ${DOCTRINE_SECTION_MAX_CHARS} chars, as served by section=`, () => {
    // ⚠ MEASURED THROUGH `doctrineSection`, not off the raw constants: what a
    // caller receives carries the section's own heading, the SECURITY sentence
    // and the index, and a budget over the parts is not a budget over the answer.
    const over = Object.keys(DOCTRINE_SECTIONS)
      .map((name) => ({ name, len: doctrineSection(name as DoctrineSection).length }))
      .filter(({ len }) => len > DOCTRINE_SECTION_MAX_CHARS)
      .map(({ name, len }) => `${name}: ${len} chars`);
    expect(
      over,
      `a doctrine section grew past the budget — split it, or cut it:\n- ${over.join("\n- ")}`,
    ).toEqual([]);
  });

  it("every published `section=` name resolves to a section, and back", () => {
    // ⚠ THE PAIR. The schema builds its enum from `DOCTRINE_SECTIONS`' keys, so
    // this cannot drift today — and asserting it is what keeps a future
    // hand-written list from being the thing that offers a name `op="help"`
    // cannot answer.
    expect([...DOCTRINE_SECTION_NAMES].sort()).toEqual(
      Object.keys(DOCTRINE_SECTIONS).sort(),
    );
    for (const name of DOCTRINE_SECTION_NAMES) {
      expect(doctrineSection(name), name).toContain(DOCTRINE_SECTIONS[name]);
    }
  });
});
