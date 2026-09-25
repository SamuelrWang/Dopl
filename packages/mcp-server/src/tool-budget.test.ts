/**
 * THE SERVED BUDGET FOR THIS SURFACE — the gate that stops the prose growing
 * back (T82 / T10, 2026-09-02; the schema, instructions and doctrine ratchets
 * are A2 of the MCP v2 wave).
 *
 * ⚠ WHY IT IS A TEST AND NOT A CONVENTION. Every sentence that made this
 * surface expensive was an HONEST one: a rule somebody had been bitten by,
 * written down where the next agent would read it. Nothing about "keep it
 * short" survives that pressure, because each individual addition is
 * defensible. A number does.
 *
 * ⚠ FOUR QUANTITIES, AND THE FOURTH IS PAID DIFFERENTLY FROM THE OTHER THREE.
 *   1. each tool's DESCRIPTION,
 *   2. each tool's INPUT SCHEMA, as `JSON.stringify(inputSchema).length` — the
 *      LARGER half of a connection today (53,581 against 24,526), and the half
 *      that had no gate at all until this file grew one,
 *   3. the `instructions` briefing, written once at handshake.
 *   Those three are PUSHED: every connected client pays for all of it on every
 *   connection, including the sessions that never call the tool in question.
 *   {@link SERVED_TOTAL_CEILING} is their sum and is the headline number.
 *   4. the DOCTRINE is PULLED, and carries its own SEPARATE ceiling for exactly
 *      that reason. Without a second budget every future description cut could
 *      be laundered into an unbounded pulled document and the pushed numbers
 *      would keep improving while nothing got simpler. Doctrine is EXPECTED to
 *      grow as prose leaves `.describe()`; the ratchet makes that growth a
 *      decision recorded here rather than a silent transfer.
 *
 * The per-call WRITE-RESULT cap is a different cost with a different payer and
 * lives in `write-result-budget.test.ts`.
 *
 * ⚠ MEASURED AS **SERVED**, THROUGH A REAL `Client.listTools()` /
 * `listResources()` over a real transport — not by reading the constants. The
 * registrar injects a `workspace` argument into every domain tool's schema and
 * the SDK renders the JSON Schema, so a description measured at its source is
 * not the string an agent receives. Same boot shape as `strict-args.test.ts`,
 * for the same reason.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";
import { createServer, buildInstructions } from "./server.js";
import type { ToolSet } from "./tool-manifest.js";
import { DESCRIPTION_MAX_CHARS } from "./tools/channel-description.js";
import { expectRatchet, ratchet } from "./budget-ratchet.js";

/**
 * ⚠ THE DESCRIPTION RATCHET, AND IT IS NOT AN EXEMPTION LIST. Seven
 * descriptions do not fit {@link DESCRIPTION_MAX_CHARS} today, and each is at
 * its smallest HONEST size: a headline, one line per op, the tenancy wording
 * the P3 tier owns (`p3/mcp-tenancy-naming`), and the security / preview
 * sentences `tool-scope-claims.test.ts` pins by phrase.
 * Getting one under the cap means deleting one of those, which is a DECISION
 * somebody takes rather than a trim. Measured 2026-09-02; re-derive with this
 * suite rather than trusting the numbers. ⚠ ADDING A NAME HERE IS NOT A FIX —
 * it is how a budget stops being a budget. When one falls to the cap, DELETE
 * the entry instead of lowering it, so the cap enforces itself.
 *
 * ── ⚠ THE ONE TIME A CEILING WENT UP, AND WHAT IT COST TO SAY SO ────────────
 *
 * **2026-09-02, the integration of the orchestrator-surface and tenancy tiers:
 * three of these rose, and the other two tools that broke the cap did NOT get
 * an entry.** The rule that separated them is the four-things rule in
 * `channel-description.ts`: a description may carry what the tool is, the
 * SECURITY sentence, the OPS named and glossed, and the arguments that are not
 * self-describing from their own `.describe()`.
 *
 *   • The two meta tools grew on prose that RESTATED their own schema
 *     descriptions. A description and its arg descriptions are BOTH pushed on
 *     every connection, so that is one fact paid for twice. Both were trimmed
 *     and both fit 1,200 with no entry added here.
 *   • `dopl_kb`, `dopl_agent` and `dopl_channel` grew on NEW OPS. An op a model
 *     never sees is an op it cannot pick, and `parity.test.ts` requires every
 *     enum op to appear as a quoted `"op_name"` with a bullet
 *     `tool-scope-claims.test.ts` then reads. That content cannot leave, so the
 *     ceilings moved to the measured post-trim size — and the trim came first.
 *     (The copy half of that trim is moot since B15 deleted the ops.)
 *
 * ⚠ **A RISE IS A DECISION AND IT IS RECORDED HERE, NOT ABSORBED.** The honest
 * next move for the three is the one `dopl_channel` already made for its LAW: a
 * pulled doctrine resource per tool (`channel-doctrine.ts`, `resources.ts`), so
 * the op glosses stop being pushed to clients that never call them.
 */
const OVER_BUDGET_CEILINGS: Record<string, number> = {
  // ⚠ **RE-MEASURED WHOLE ON 2026-09-02 AT SLICE A14**, through the real
  // `listTools()` over the integrated tree. Every figure FELL, and four names
  // that were here are GONE rather than lowered — `dopl_members` and the two
  // meta tools now fit the cap, so the cap enforces itself for them and an
  // entry would be headroom for whatever is added next.
  //
  // ⚠ **A RISE IS A DECISION AND IT IS RECORDED WHERE IT IS TAKEN.** Two prose
  // budgets sit above `DESCRIPTION_MAX_CHARS` in their own files —
  // `knowledge.ts › KB_PROSE_BUDGET` and `agent.ts › AGENT_PROSE_BUDGET` — and
  // both docblocks say the same thing: the excess is the UNTRUSTED-CONTENT
  // FENCE (`untrusted-fence.ts`), not prose. A fence cannot move into a pulled
  // doctrine, because the agent that has not read the doctrine is exactly the
  // one that needs it. Both descriptions FELL by hundreds in the same change.
  // ⚠ 1,941 → 1,797 (B15): the copy bullet and its `to_workspace` gloss out,
  // one grant bullet in.
  dopl_agent: 1614, // −8 (1.37.1): the shelf is called the home shelf. +2: the grant example names `"<id>"`, not a template-era `"t1"` (P8-15). Re-derive, never quote.
  // ⚠ 1,591 → 1,596 (B8): barely moved while the string changed completely — 23
  // op names fell to 5, and a generated `Limits:` block took it back.
  // ⚠ 1,596 → 1,587 (B13): the discovery sentence names `dopl_workspaces`.
  dopl_channel: 1360, // −229: home-channel addressing is a pointer; the rule is pulled (doctrine `rooms`, P8-23). Re-derive, never quote.
  // GUARD, NOT LAUNDERING.** The doctrine move first took this description DOWN to 1,571; then
  // `tool-style.test.ts › call-shape examples` came due — an op-dispatch tool must publish three
  // call shapes and this one published two, which no amount of prose trimming fixes. The third
  // example (`op="read"`) costs 32 chars, so the description lands 16 above where it started.
  // ⚠ THE WAVE STILL FELL: the pushed schema went 9,445 → 8,664 (−781) and the whole served
  // surface 47,464 → 47,319 (−145) IN THE SAME CHANGE. A guard that requires a published example
  // outranks a ceiling this file may set, and the trade is recorded here rather than absorbed.
  dopl_chats: 1699, // ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.** // ⚠ **−2 (2026-09-18): BANKED, NOT SPENT.** The `container` arg's description dropped `your` from `(your home space)` — the home space resolves per caller, so the word was a character cost with no reader. The same edit deleted its FALSE `(your default)` (`workspace-arg.ts`): an agent inside a channel lands in the CHANNEL's container, which `instructions.ts` states correctly on the same connection. **The two characters are what the true version cost.** ⚠ **+21 (2026-09-17, R-32): the second addressing key — see `dopl_agent` above for the whole argument.**
  dopl_kb: 1902, // +77 (2026-09-23, DMP-002): NEW OPS history + restore, the licence this file accepts. ⚠ **1,888 → 1,825 (2026-09-18, −63): PINNING LEFT THE SURFACE, AND THE FALL IS BANKED IN THE SAME CHANGE.** Samuel's ruling removed knowledge pinning outright, so `dopl_kb` lost its `"pin"/"unpin" — the STARTUP CONTEXT every session here gets.` op bullet. ⚠ **THE OTHER HALF OF THE REMOVAL IS ON THE SCHEMA SIDE** (−143, `SCHEMA_CEILINGS.dopl_kb`): `op`'s published enum dropped two values and `base`/`path` dropped the op names and the with-a-path-you-pin-ONE-entry target rule. ⚠ **A REMOVAL IS RATCHETED EXACTLY LIKE A TRIM** — the STALE half of this ratchet fails as loudly for a feature that left as for prose that was shortened, which is the whole point: an unbanked fall is headroom for whatever is added next, and this one is 63 chars per connection that a future op would otherwise get for free. ⚠ **NOTHING PINNED BY `tool-scope-claims.test.ts` MOVED** — the three filtered-op bullets (`list_bases`, `get_tree`, `search`), the SECURITY line and the deletion-is-app-only boundary clause are untouched; what left was one bullet for ops that no longer exist. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **1,878 → 1,888 (2026-09-15, +10): THE `ambiguous_slug` ERROR ROW, MOSTLY PAID FOR AND THE REMAINDER RECORDED.** The row costs ~84 as served, and it is not optional prose. A slug naming bases in two containers used to resolve to whichever `Array.find` reached first, so `dopl-development` answered "0 folders, 0 entries" from an empty shell in the home space for ten days while the real base filled up elsewhere (`KB-LOSS-TRACE.md`, F-701). ⚠ A SILENT PICK CANNOT BE DIAGNOSED FROM ITS OWN ANSWER — an empty tree is what an empty base looks like — and `tool-errors.ts`'s whole mechanism is that the literal on the wire is the literal the description taught, so the code must be PUSHED, and pushed prose must be bought. ⚠ **~74 CAME FROM FACTS THIS CONNECTION ALREADY PUSHED TWICE**, this description's own de-duplication rule applied three more times: the headline's `Only bases you have a grant on` (the `list_bases` bullet states it more precisely; ⚠ it is NOT the `you have no grant on` string `tool-scope-claims.test.ts` pins, and that bullet is untouched), that bullet's now-redundant `by slug` (the headline names the addressing), and the grant bullet's `— ONE row, one edit reaches all` (`scope`'s own describe: *"the row itself never moves"*). ⚠ **TWO FURTHER CUTS WERE MADE AND REVERTED, EACH BY A GATE THAT IS RIGHT**: the policy's `deletion is app-only` is the BOUNDARY CLAUSE `tool-style.ts` requires in the first 200 chars (it is duplicated, and it is still load-bearing), and `entry_cursor for more` is the continuation a truncating op owes its caller (`tool-scope-claims.test.ts`) — a cap that names no cursor is a silent truncation. The changelog clause below was cut first and put back for the reason its own note gives. ⚠ **SO +10 IS WHAT SURVIVED, AND IT IS RECORDED RATHER THAN ABSORBED** (`SERVED_TOTAL_CEILING`'s rule): 10 chars per connection buys the difference between an agent that is told its slug was ambiguous and one that writes ten days of notes into the wrong base. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **1,881 → 1,878 (2026-09-09, −3): THE CHANGELOG CLAUSE, PAID FOR AND THEN SOME.** `write_file` now says *"writes land in the changelog"* — a fact about what the op DOES that an agent can learn nowhere else, because nothing in the WRITE RESULT mentions it and the doctrine is PULLED. The clause is 30 chars as served; six copy-edits inside this same description paid for it and three more: `Read the excerpt … in that order` → `Read excerpt … in order`, `across … and ontology` → `over … , ontology`, `entries over ~1.5k` → `entries past ~1.5k`, `one-way` → `one way`, `lend one YOU created — ONE row, so an edit reaches everyone` → `lend one YOU made — ONE row, one edit reaches all`, and `every session launched here` → `every session here`. ⚠ **THREE FURTHER TRIMS WERE MADE AND PUT BACK, AND THE GATE THAT CAUGHT THEM IS `tool-scope-claims.test.ts`, NOT THIS ONE**: `you have no grant on`, `ENTRIES are paged` and `the BODIES of bases you can read` are each a DISCLOSURE a filtered read op owes its caller, pinned there by name. A budget trim that deletes one buys the number by telling the truth less — check the scope-claims gate before shortening a bullet here. ⚠ **THE TRIM CAME FIRST AND THE CEILING WENT DOWN, WHICH IS THE ONLY SHAPE THIS FILE ACCEPTS FOR A NEW SENTENCE** — the instructions ceiling states the rule; this is it applied one surface over. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **1,947 → 1,937 (B15); 1,937 → 1,986 (2026-09-03, +49): ONE OP AND TWO ROUTING SENTENCES.** `op="outline"` must be glossed (`parity.test.ts`), and the sentences are the routing this wave teaches — *excerpt → outline → section → body*, and *entries over ~1.5k chars carry ## headings*. ⚠ **A ROUTING LINE CANNOT MOVE INTO THE PULLED DOCTRINE**, on the fence's own argument: the agent that has not read `dopl://doctrine/knowledge` is the one still reading whole documents. ⚠ **49 IS WHAT SURVIVED A TRIM OF 233** — bullets, the headline's duplicate "never deletes" and one call shape paid the rest. Against it, per READ: 839 chars for one section of a 2,559-char entry against 2,760 whole. // ⚠ **−13 (2026-09-18, R1): BANKED OVER FOUR ADDITIONS.** `visibility` states the PRIVATE audience in dopl_agent's own words and says ONE WAY out loud (S14 — `dopl_skill` says the other half, that `private` reverses there and cannot here), `title` says it RENAMES the path leaf (S19), `confirm_token` says the flow is TWO CALLS (S16), and `level` says a channel grant is READ-ONLY (Q4). ⚠ **PAID BY TWO NO-FACT-TWICE CUTS**: `expected_version` lost *"and only force=true skips the check"* (`force`'s own describe, pushed on the same connection) and the `guest_write` rule went to the per-call result instead of the schema. ⚠ **R1 CONSISTENCY WAVE (2026-09-18)** — re-derived whole through the real `listTools()`; the accounting for the whole batch is on `SERVED_TOTAL_CEILING`. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **5,726 → 6,040 (2026-09-18, +314): THE IDEMPOTENCY KEY (S53), AND IT IS THE ONE PUSHED COST OF THE "errors that teach" BATCH.** Everything else in that batch is per-call refusal text governed by `write-result-budget.test.ts`, which costs a connection nothing — this is the exception, and it is a PARAMETER, which cannot move into a pulled doctrine. ⚠ **WHAT THE CHARACTERS BUY, WHICH THIS CEILING CANNOT SEE**: before `client_write_id` a `write_file` that TIMED OUT left an agent no way to ask whether it landed, so the only recovery on offer was `force=true` — a blind overwrite aimed at a row it cannot verify, by the caller least able to verify it. The key converges the retry on the first write instead. +58 of the rise is `force`'s own describe gaining the MOVED refusal (S40), which is the behaviour change that makes the old recovery refuse rather than duplicate. ⚠ **THE TRIM CAME FIRST**: both describes were cut about 40% from their first drafts, and the MECHANISM (author-scoping, the partial unique index, the 23505 race arm) is deliberately absent — a caller cannot act on any of it. ⚠ **AND IT IS PAID ONCE PER CONNECTION AGAINST A DUPLICATE ENTRY PER TIMEOUT**, which is unrecoverable: deletion is app-only. ⚠ NEVER QUOTE THIS NUMBER — re-derive it. // ⚠ **5,726 → 5,583 (2026-09-18, −143): THE SCHEMA HALF OF THE PINNING REMOVAL, BANKED.** `op`'s published enum lost `"pin"` and `"unpin"` (the runtime union keeps only the retired COPY names, which are a different window), `base` lost `/pin/unpin` from its required-op list, and `path` lost the whole target rule — *with a path you pin that ONE entry, without one you pin the whole base* — which was the longest single clause on this shape. ⚠ **THE DESCRIPTION HALF IS −63** (`DESCRIPTION_CEILINGS.dopl_kb`), and 63 + 143 = the 206 `SERVED_TOTAL_CEILING` fell by. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **5,138 → 5,707 (2026-09-03, +569): TWO PARAMETERS PLUS AN OP NAME — the one licence this file accepts.** `section` and `offset` are what make a heading an address; a published argument cannot move into a pulled document, and trimming its describe into uselessness buys the number by making the knob unusable — the argument `response_format` and `max_chars` rode. ⚠ **AND IT PAYS FOR ITSELF PER CALL, NOT PER CONNECTION**: 569 once, against 1,921 saved by ONE sectioned read of a 2,559-char entry. // ⚠ **−2 (2026-09-18): BANKED, NOT SPENT.** The `container` arg's description dropped `your` from `(your home space)` — the home space resolves per caller, so the word was a character cost with no reader. The same edit deleted its FALSE `(your default)` (`workspace-arg.ts`): an agent inside a channel lands in the CHANNEL's container, which `instructions.ts` states correctly on the same connection. **The two characters are what the true version cost.** ⚠ **+21 (2026-09-17, R-32): the second addressing key — see `dopl_agent` above for the whole argument.** // ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.**
  dopl_members: 1453, // ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.** // ⚠ **−2 (2026-09-18): BANKED, NOT SPENT.** The `container` arg's description dropped `your` from `(your home space)` — the home space resolves per caller, so the word was a character cost with no reader. The same edit deleted its FALSE `(your default)` (`workspace-arg.ts`): an agent inside a channel lands in the CHANNEL's container, which `instructions.ts` states correctly on the same connection. **The two characters are what the true version cost.** ⚠ **+21 (2026-09-17, R-32): the second addressing key — see `dopl_agent` above for the whole argument.**
  dopl_ontology: 1990, // +1 (2026-09-23, merge of the vocabulary removal into DMP-002): the history gloss says `ontology=` where it said the old five-letter arg. // +70 (2026-09-23, DMP-002): NEW OPS history + restore, the licence this file accepts. ⚠ **1,922 → 1,919 (2026-09-09): BANKED, NOT RAISED, THE SECOND TIME IN A DAY** — the CHANGELOG lane part 2 added a clause saying every write is filed per field in the changelog, and paid for it out of this same description; `tools/ontology.ts › ONTOLOGY_PROSE_BUDGET` lists what was trimmed. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **−23 (2026-09-18, R1): BANKED, AND THE EDIT IS IN ANOTHER FILE.** `response-size.ts › RESPONSE_FORMAT_FIELD` stopped naming ops as `op="read" / "status" / …` — a list of FOUR ops no single tool has, so four of the five tools that take the knob published a name they do not serve (S16). It now says *whichever of these THIS tool has*, and the illustration `— timestamps, ids, scope notes, legends —` came off to pay for it: the GUARANTEE (*never a body or a count*) is what makes the knob safe to reach for, and the examples were not it. One wording, five schemas. ⚠ **R1 CONSISTENCY WAVE (2026-09-18)** — re-derived whole through the real `listTools()`; the accounting for the whole batch is on `SERVED_TOTAL_CEILING`. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **2,816 → 2,809 (2026-09-11, −7): THE VOCABULARY RULING, BANKED NOT RAISED.** An ontology is an *ontology* to a reader and a column is an *object*, so three `.describe()` strings were respelled rather than added to: `ontology` → "Ontology slug, id, or exact name." (+1), `parent` lost the `column/object` pair for plain `object` (−7), `name` went `(ontology/column/object/action)` → `(ontology/object/item/action)` (−1). The OP NAMES did not move — `create_column` is still the op, and `parity.test.ts` still reads it. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **−2 (2026-09-18): BANKED, NOT SPENT.** The `container` arg's description dropped `your` from `(your home space)` — the home space resolves per caller, so the word was a character cost with no reader. The same edit deleted its FALSE `(your default)` (`workspace-arg.ts`): an agent inside a channel lands in the CHANNEL's container, which `instructions.ts` states correctly on the same connection. **The two characters are what the true version cost.** ⚠ **+21 (2026-09-17, R-32): the second addressing key — see `dopl_agent` above for the whole argument.** // ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.**
  dopl_skill: 1678, // +85 (2026-09-23, DMP-002): NEW OPS history + restore, the licence this file accepts. ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.** // ⚠ **−2 (2026-09-18): BANKED, NOT SPENT.** The `container` arg's description dropped `your` from `(your home space)` — the home space resolves per caller, so the word was a character cost with no reader. The same edit deleted its FALSE `(your default)` (`workspace-arg.ts`): an agent inside a channel lands in the CHANNEL's container, which `instructions.ts` states correctly on the same connection. **The two characters are what the true version cost.** ⚠ **+21 (2026-09-17, R-32): the second addressing key — see `dopl_agent` above for the whole argument.** // ⚠ **+12 (2026-09-18, R1): THE OTHER HALF OF AN ASYMMETRY, RECORDED.** `set_visibility` here is REVERSIBLE and on `dopl_kb` it is ONE WAY, and neither surface said so about the other (S14), so an agent that learned the skill lane first tried to un-publish a base and was refused by a sentence that read like a bug. `'private' makes it owner-only again` → `'private' reverses it (a knowledge base cannot)`. ⚠ **12 chars per connection buys the one fact a caller cannot derive from either tool alone.** ⚠ **R1 CONSISTENCY WAVE (2026-09-18)** — re-derived whole through the real `listTools()`; the accounting for the whole batch is on `SERVED_TOTAL_CEILING`. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.**
};

/**
 * ⚠ THE BIGGER HALF OF THE CONNECTION, AND IT HAD NO GATE UNTIL NOW — 53,581
 * chars of input schema against 24,526 of description, measured 2026-09-02.
 * That asymmetry is not an accident: `.describe()` is where doctrine goes when
 * a description gets audited, and nothing was counting it.
 *
 * ⚠ EVERY SERVED TOOL DECLARES ONE. There is no shared cap to fall back on and
 * no honest one to invent — a 24-op tool and a one-arg tool have nothing in
 * common — so the ratchet's MISSING half refuses a tool that declares none,
 * which is what stops a NEW tool joining the surface unbudgeted.
 *
 * ⚠ `dopl_channel` WAS 41% OF THE WHOLE SERVED SURFACE ON ITS OWN (21,778 of
 * 53,581) — 24 ops and 37 params of `.describe()` prose that was doctrine
 * wearing a schema. A6 and B8 moved it; this number is what proves it moved
 * rather than being redistributed.
 */
const SCHEMA_CEILINGS: Record<string, number> = {
  // ⚠ **RE-MEASURED WHOLE ON 2026-09-02 AT SLICE A14**, through the real
  // `listTools()` over the integrated tree.
  //
  // ⚠ **FOUR OF THESE ROSE, AND EVERY CHARACTER OF THE RISE IS A RESPONSE-SIZE
  // KNOB** (`response-size.ts`): `response_format` on `dopl_status`,
  // `dopl_search`, `dopl_channel` and `dopl_kb`, plus `max_chars`. **A PARAMETER,
  // not prose, licensed on `dopl_skill`'s `confirm_token` precedent** — a
  // published argument cannot move into a pulled document, and trimming its
  // description into uselessness buys the number by making the knob unusable.
  //
  // ⚠ **AND IT IS THE ONE RISE ON THIS SURFACE THAT PAYS FOR ITSELF PER CALL.**
  // Every other figure here is a fixed cost per CONNECTION; these buy a recurring
  // saving per RESULT — `concise` drops ~750 chars of scope note from every
  // `dopl_search` and a two-line legend from every `dopl_status`, the call an
  // orchestrator makes most. One connection's characters against a loop's.
  // ⚠ **AND THREE MORE ROSE IN THE BATCH-2 REVIEW, SAME LICENCE** — A16's three
  // knobs, absent from the tree (F-591): `fields=`/`response_format`/`max_chars`.
  // ⚠ 4,145 → 4,024 (B15): `shelf` + `to_workspace` out, three grant args in
  dopl_agent: 5663, // ⚠ **5,544 → 5,663 (2026-09-23, +119, DMP-009): the field `type` enum** — the product's five-word vocabulary; the value rules live in the refusal, not the describe. ⚠ **5,394 → 5,544 (2026-09-23, +150, rulings 4–6): the `runtime` argument** (grammar-checked, nullable) an identity now carries; `model`'s describe shrank to pay part of it. // ⚠ **RE-DERIVED WHOLE AT THE 2026-09-19 INTEGRATION → 5,394.** Eight branches each recorded this row against master's 5,133; no branch's figure is the merged truth and this is a fresh measurement through the real `listTools()`. The movement is the sum of the wave: −30 for batch A's retired `workspace=` alias key, +302 for batch H's identity CAS (`expected_version` / `force`), and −11 for batch D's trims. Every branch's own argument is kept below, newest first. // ⚠ **−11 (2026-09-18, R1): BANKED.** `visibility` stops calling a home channel a "workspace" (S12/D-c5) in 21 fewer characters, `confirm_token` spends 14 of that saying the flow is TWO CALLS (S16), and `level` states that a channel grant is READ-ONLY while the `guest_write` RULE went to the per-call result (`grant.ts › levelReach`, fix-list Q4 — PARKED as a product question, but the SILENCE was not parked: wave 2 filed a false security finding because no read-only share was discoverable). ⚠ **R1 CONSISTENCY WAVE (2026-09-18)** — re-derived whole through the real `listTools()`; the accounting for the whole batch is on `SERVED_TOTAL_CEILING`. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **−2 (2026-09-18): BANKED, NOT SPENT.** The `container` arg's description dropped `your` from `(your home space)` — the home space resolves per caller, so the word was a character cost with no reader. The same edit deleted its FALSE `(your default)` (`workspace-arg.ts`): an agent inside a channel lands in the CHANNEL's container, which `instructions.ts` states correctly on the same connection. **The two characters are what the true version cost.** ⚠ **+21 ON EVERY DOMAIN SCHEMA (2026-09-17, R-32): THE SECOND ADDRESSING KEY.** `container=` replaces `workspace=` and the old spelling stays one release as a DEPRECATED ALIAS, so nine schemas carry two keys instead of one — `strictInput` turns an unknown key into `-32602`, which is the one outcome a deprecation window rules out, so the alias cannot simply be dropped. ⚠ **THE ALIAS IS PUBLISHED WITH NO `.describe()`, AND THAT IS WHAT MAKES THE RISE 21 AND NOT 70** — a clause describing it would be ~290 chars per connection advertising an argument nobody should newly adopt; the deprecation reaches the caller that USED it, on the result (`workspace-arg.ts › deprecatedAliasNote`). ⚠ **AND `container`'s OWN DESCRIPTION IS 9 CHARS SHORTER THAN THE ONE IT REPLACED** while naming one more address form (`home`), which is why 21 is the whole cost of a second key rather than a second key plus prose. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **4,021 → 5,114 (2026-09-08, +1,093): A RISE, AND THE WHOLE OF IT IS ONE NEW PARAMETER** — `knowledge`, an array of `{base, folder?, entry?}` (Samuel: *"I want to be able to specific folders or entries/files"*). 830 of the 1,093 is the SHAPE rather than prose: three `z.string().uuid()`s render `format` plus a pattern apiece (measured: 830 with three, 440 with one, 245 with none). ⚠ **THE CHEAP VERSIONS WERE MEASURED AND REFUSED.** Dropping `.uuid()` off `folder`/`entry` banks 390 by making a malformed id a ROUND TRIP instead of a local refusal, on the surface where a round trip is the expensive thing; the discriminated union the server stores renders as an `anyOf` of three shapes, which is bigger AND is a branch a model picks wrong. The rest is the two `.describe()`s, trimmed twice. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **5,133 → 5,435 (2026-09-18, +302): OPTIMISTIC CONCURRENCY ON `op="update"` (F-747), AND IT IS RECORDED RATHER THAN FUNDED.** `expected_version` + `force` are the KB and skills lanes' own pair, worded shorter than either of theirs, on a verb that had NO precondition at all: an identity update was silent last-writer-wins, on the one resource whose body is a SYSTEM PROMPT two orchestrators can be editing at once. ⚠ **THE CHEAP SHAPE WAS REFUSED IN THE FINDING, NOT HERE**: a service-level `existing.updatedAt !== expected → 412` costs ~0 served chars and is CHECK-THEN-ACT, which would publish the word `expected_version` on a surface where `dopl_kb`'s identical argument is atomic. ⚠ **NO FUNDING WAS AVAILABLE INSIDE THIS SHAPE WITHOUT DIVERGING FROM `dopl_kb`**: the one restatement left here is `confirm_token`'s home-channel clause, which is CHARACTER-IDENTICAL to `knowledge.ts`'s, so trimming it on one tool and not the other buys 72 chars by making two tools disagree about one gate. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.** // ⚠ 1,797 → 1,761 (2026-09-06, the artifacts wave: `channel-schema.ts`'s pushed `.describe()` prose fell 762 (9,445 → 8,683 measured) as standing contract prose moved into the PULLED doctrine; the doctrine rose 74 to pay for it. 762 down, 74 up — a 688-char net fall on the surface every client is handed on every connection. Every number below is a MEASUREMENT from a real gate run, not a hand count.)
  // ⚠ 11,609 → 8,678 (B8), every character from a param or an op LEAVING; F-577 records the gap to the 3,000 target.
  dopl_channel: 9405, // −6: rooms.update rename+describe (DMP-001) paid for by trimming the info_card describe. +7: `wait_ms` publishes the manage clamp (P8-18), `color` is a marker (P8-15). Re-derive, never quote.
  dopl_chats: 3542, // ⚠ **−2 (2026-09-18): BANKED, NOT SPENT.** The `container` arg's description dropped `your` from `(your home space)` — the home space resolves per caller, so the word was a character cost with no reader. The same edit deleted its FALSE `(your default)` (`workspace-arg.ts`): an agent inside a channel lands in the CHANNEL's container, which `instructions.ts` states correctly on the same connection. **The two characters are what the true version cost.** ⚠ **+21 (2026-09-17, R-32): the second addressing key — see `dopl_agent` above for the whole argument.** // ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.**
  // ⚠ 5,347 → 5,141 (B15), same trade
  dopl_kb: 6114, // +7 (1.37.1, live test #6): `section` says "loose match, all served" instead of "case-insensitive" — reads no longer refuse as ambiguous. −8 (1.37.1): excerpt says it is required when creating; "shown in get_tree/list_dir" dropped, the description says it. +224 (2026-09-23, DMP-002): NEW OPS history + restore, the licence this file accepts. (`revision`) ⚠ **RE-DERIVED WHOLE AT THE 2026-09-19 INTEGRATION → 5,891.** Master was 5,726, and FIVE of the eight branches moved this one row: −30 (batch A's alias), −143 (pinning's two enum values and the target rule), +324 (batch B's `client_write_id`), plus batch C's section/heading work. No branch could see the others; this is the sum, measured. // ⚠ **−13 (2026-09-18, R1): BANKED OVER FOUR ADDITIONS.** `visibility` states the PRIVATE audience in dopl_agent's own words and says ONE WAY out loud (S14 — `dopl_skill` says the other half, that `private` reverses there and cannot here), `title` says it RENAMES the path leaf (S19), `confirm_token` says the flow is TWO CALLS (S16), and `level` says a channel grant is READ-ONLY (Q4). ⚠ **PAID BY TWO NO-FACT-TWICE CUTS**: `expected_version` lost *"and only force=true skips the check"* (`force`'s own describe, pushed on the same connection) and the `guest_write` rule went to the per-call result instead of the schema. ⚠ **R1 CONSISTENCY WAVE (2026-09-18)** — re-derived whole through the real `listTools()`; the accounting for the whole batch is on `SERVED_TOTAL_CEILING`. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **−2 (2026-09-18): BANKED, NOT SPENT.** The `container` arg's description dropped `your` from `(your home space)` — the home space resolves per caller, so the word was a character cost with no reader. The same edit deleted its FALSE `(your default)` (`workspace-arg.ts`): an agent inside a channel lands in the CHANNEL's container, which `instructions.ts` states correctly on the same connection. **The two characters are what the true version cost.** ⚠ **+21 (2026-09-17, R-32): the second addressing key — see `dopl_agent` above for the whole argument.** // ⚠ **5,138 → 5,707 (2026-09-03, +569): TWO PARAMETERS PLUS AN OP NAME — the one licence this file accepts.** `section` and `offset` are what make a heading an address; a published argument cannot move into a pulled document, and trimming its describe into uselessness buys the number by making the knob unusable — the argument `response_format` and `max_chars` rode. ⚠ **AND IT PAYS FOR ITSELF PER CALL, NOT PER CONNECTION**: 569 once, against 1,921 saved by ONE sectioned read of a 2,559-char entry. // ⚠ **5,726 → 6,040 (2026-09-18, +314): THE IDEMPOTENCY KEY (S53), AND IT IS THE ONE PUSHED COST OF THE "errors that teach" BATCH.** Everything else in that batch is per-call refusal text governed by `write-result-budget.test.ts`, which costs a connection nothing — this is the exception, and it is a PARAMETER, which cannot move into a pulled doctrine. ⚠ **WHAT THE CHARACTERS BUY, WHICH THIS CEILING CANNOT SEE**: before `client_write_id` a `write_file` that TIMED OUT left an agent no way to ask whether it landed, so the only recovery on offer was `force=true` — a blind overwrite aimed at a row it cannot verify, by the caller least able to verify it. The key converges the retry on the first write instead. +58 of the rise is `force`'s own describe gaining the MOVED refusal (S40), which is the behaviour change that makes the old recovery refuse rather than duplicate. ⚠ **THE TRIM CAME FIRST**: both describes were cut about 40% from their first drafts, and the MECHANISM (author-scoping, the partial unique index, the 23505 race arm) is deliberately absent — a caller cannot act on any of it. ⚠ **AND IT IS PAID ONCE PER CONNECTION AGAINST A DUPLICATE ENTRY PER TIMEOUT**, which is unrecoverable: deletion is app-only. ⚠ NEVER QUOTE THIS NUMBER — re-derive it. // ⚠ **5,726 → 5,583 (2026-09-18, −143): THE SCHEMA HALF OF THE PINNING REMOVAL, BANKED.** `op`'s published enum lost `"pin"` and `"unpin"` (the runtime union keeps only the retired COPY names, which are a different window), `base` lost `/pin/unpin` from its required-op list, and `path` lost the whole target rule — *with a path you pin that ONE entry, without one you pin the whole base* — which was the longest single clause on this shape. ⚠ **THE DESCRIPTION HALF IS −63** (`DESCRIPTION_CEILINGS.dopl_kb`), and 63 + 143 = the 206 `SERVED_TOTAL_CEILING` fell by. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.** // ⚠ **1,888 → 1,825 (2026-09-18, −63): PINNING LEFT THE SURFACE, AND THE FALL IS BANKED IN THE SAME CHANGE.** Samuel's ruling removed knowledge pinning outright, so `dopl_kb` lost its `"pin"/"unpin" — the STARTUP CONTEXT every session here gets.` op bullet. ⚠ **THE OTHER HALF OF THE REMOVAL IS ON THE SCHEMA SIDE** (−143, `SCHEMA_CEILINGS.dopl_kb`): `op`'s published enum dropped two values and `base`/`path` dropped the op names and the with-a-path-you-pin-ONE-entry target rule. ⚠ **A REMOVAL IS RATCHETED EXACTLY LIKE A TRIM** — the STALE half of this ratchet fails as loudly for a feature that left as for prose that was shortened, which is the whole point: an unbanked fall is headroom for whatever is added next, and this one is 63 chars per connection that a future op would otherwise get for free. ⚠ **NOTHING PINNED BY `tool-scope-claims.test.ts` MOVED** — the three filtered-op bullets (`list_bases`, `get_tree`, `search`), the SECURITY line and the deletion-is-app-only boundary clause are untouched; what left was one bullet for ops that no longer exist. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **1,947 → 1,937 (B15); 1,937 → 1,986 (2026-09-03, +49): ONE OP AND TWO ROUTING SENTENCES.** `op="outline"` must be glossed (`parity.test.ts`), and the sentences are the routing this wave teaches — *excerpt → outline → section → body*, and *entries over ~1.5k chars carry ## headings*. ⚠ **A ROUTING LINE CANNOT MOVE INTO THE PULLED DOCTRINE**, on the fence's own argument: the agent that has not read `dopl://doctrine/knowledge` is the one still reading whole documents. ⚠ **49 IS WHAT SURVIVED A TRIM OF 233** — bullets, the headline's duplicate "never deletes" and one call shape paid the rest. Against it, per READ: 839 chars for one section of a 2,559-char entry against 2,760 whole. // ⚠ **1,881 → 1,878 (2026-09-09, −3): THE CHANGELOG CLAUSE, PAID FOR AND THEN SOME.** `write_file` now says *"writes land in the changelog"* — a fact about what the op DOES that an agent can learn nowhere else, because nothing in the WRITE RESULT mentions it and the doctrine is PULLED. The clause is 30 chars as served; six copy-edits inside this same description paid for it and three more: `Read the excerpt … in that order` → `Read excerpt … in order`, `across … and ontology` → `over … , ontology`, `entries over ~1.5k` → `entries past ~1.5k`, `one-way` → `one way`, `lend one YOU created — ONE row, so an edit reaches everyone` → `lend one YOU made — ONE row, one edit reaches all`, and `every session launched here` → `every session here`. ⚠ **THREE FURTHER TRIMS WERE MADE AND PUT BACK, AND THE GATE THAT CAUGHT THEM IS `tool-scope-claims.test.ts`, NOT THIS ONE**: `you have no grant on`, `ENTRIES are paged` and `the BODIES of bases you can read` are each a DISCLOSURE a filtered read op owes its caller, pinned there by name. A budget trim that deletes one buys the number by telling the truth less — check the scope-claims gate before shortening a bullet here. ⚠ **THE TRIM CAME FIRST AND THE CEILING WENT DOWN, WHICH IS THE ONLY SHAPE THIS FILE ACCEPTS FOR A NEW SENTENCE** — the instructions ceiling states the rule; this is it applied one surface over. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **1,878 → 1,888 (2026-09-15, +10): THE `ambiguous_slug` ERROR ROW, MOSTLY PAID FOR AND THE REMAINDER RECORDED.** The row costs ~84 as served, and it is not optional prose. A slug naming bases in two containers used to resolve to whichever `Array.find` reached first, so `dopl-development` answered "0 folders, 0 entries" from an empty shell in the home space for ten days while the real base filled up elsewhere (`KB-LOSS-TRACE.md`, F-701). ⚠ A SILENT PICK CANNOT BE DIAGNOSED FROM ITS OWN ANSWER — an empty tree is what an empty base looks like — and `tool-errors.ts`'s whole mechanism is that the literal on the wire is the literal the description taught, so the code must be PUSHED, and pushed prose must be bought. ⚠ **~74 CAME FROM FACTS THIS CONNECTION ALREADY PUSHED TWICE**, this description's own de-duplication rule applied three more times: the headline's `Only bases you have a grant on` (the `list_bases` bullet states it more precisely; ⚠ it is NOT the `you have no grant on` string `tool-scope-claims.test.ts` pins, and that bullet is untouched), that bullet's now-redundant `by slug` (the headline names the addressing), and the grant bullet's `— ONE row, one edit reaches all` (`scope`'s own describe: *"the row itself never moves"*). ⚠ **TWO FURTHER CUTS WERE MADE AND REVERTED, EACH BY A GATE THAT IS RIGHT**: the policy's `deletion is app-only` is the BOUNDARY CLAUSE `tool-style.ts` requires in the first 200 chars (it is duplicated, and it is still load-bearing), and `entry_cursor for more` is the continuation a truncating op owes its caller (`tool-scope-claims.test.ts`) — a cap that names no cursor is a silent truncation. The changelog clause below was cut first and put back for the reason its own note gives. ⚠ **SO +10 IS WHAT SURVIVED, AND IT IS RECORDED RATHER THAN ABSORBED** (`SERVED_TOTAL_CEILING`'s rule): 10 chars per connection buys the difference between an agent that is told its slug was ambiguous and one that writes ten days of notes into the wrong base. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.**
  dopl_map: 239, // ⚠ **−2 (2026-09-18): BANKED, NOT SPENT.** The `container` arg's description dropped `your` from `(your home space)` — the home space resolves per caller, so the word was a character cost with no reader. The same edit deleted its FALSE `(your default)` (`workspace-arg.ts`): an agent inside a channel lands in the CHANNEL's container, which `instructions.ts` states correctly on the same connection. **The two characters are what the true version cost.** ⚠ **+21 (2026-09-17, R-32): the second addressing key — see `dopl_agent` above for the whole argument.** // ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.**
  dopl_members: 834, // ⚠ **−2 (2026-09-18): BANKED, NOT SPENT.** The `container` arg's description dropped `your` from `(your home space)` — the home space resolves per caller, so the word was a character cost with no reader. The same edit deleted its FALSE `(your default)` (`workspace-arg.ts`): an agent inside a channel lands in the CHANNEL's container, which `instructions.ts` states correctly on the same connection. **The two characters are what the true version cost.** ⚠ **+21 (2026-09-17, R-32): the second addressing key — see `dopl_agent` above for the whole argument.** // ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.**
  dopl_ontology: 2915, // −3 (2026-09-23, merge): the vocabulary removal's banked −3, carried onto the DMP-002 schema. // +143 (2026-09-23, DMP-002): NEW OPS history + restore, the licence this file accepts. (`revision`) // ⚠ **2,775 → 2,772 (2026-09-23): BANKED.** The op enum and the ontology arg each grew a char when the old word left (+3, plus +2 for the purpose gloss had it stayed), and the purpose gloss was rewritten shorter (−8). // ⚠ **−23 (2026-09-18, R1): BANKED, AND THE EDIT IS IN ANOTHER FILE.** `response-size.ts › RESPONSE_FORMAT_FIELD` stopped naming ops as `op="read" / "status" / …` — a list of FOUR ops no single tool has, so four of the five tools that take the knob published a name they do not serve (S16). It now says *whichever of these THIS tool has*, and the illustration `— timestamps, ids, scope notes, legends —` came off to pay for it: the GUARANTEE (*never a body or a count*) is what makes the knob safe to reach for, and the examples were not it. One wording, five schemas. ⚠ **R1 CONSISTENCY WAVE (2026-09-18)** — re-derived whole through the real `listTools()`; the accounting for the whole batch is on `SERVED_TOTAL_CEILING`. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **−2 (2026-09-18): BANKED, NOT SPENT.** The `container` arg's description dropped `your` from `(your home space)` — the home space resolves per caller, so the word was a character cost with no reader. The same edit deleted its FALSE `(your default)` (`workspace-arg.ts`): an agent inside a channel lands in the CHANNEL's container, which `instructions.ts` states correctly on the same connection. **The two characters are what the true version cost.** ⚠ **+21 (2026-09-17, R-32): the second addressing key — see `dopl_agent` above for the whole argument.** // ⚠ **2,816 → 2,809 (2026-09-11, −7): THE VOCABULARY RULING, BANKED NOT RAISED.** An ontology is an *ontology* to a reader and a column is an *object*, so three `.describe()` strings were respelled rather than added to: `ontology` → "Ontology slug, id, or exact name." (+1), `parent` lost the `column/object` pair for plain `object` (−7), `name` went `(ontology/column/object/action)` → `(ontology/object/item/action)` (−1). The OP NAMES did not move — `create_column` is still the op, and `parity.test.ts` still reads it. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.** // ⚠ **1,922 → 1,919 (2026-09-09): BANKED, NOT RAISED, THE SECOND TIME IN A DAY** — the CHANGELOG lane part 2 added a clause saying every write is filed per field in the changelog, and paid for it out of this same description; `tools/ontology.ts › ONTOLOGY_PROSE_BUDGET` lists what was trimmed. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.**
  dopl_search: 1031, // −11 (1.37.1): `scope` now states what "here" and "everywhere" cover, shorter than the old false line. ⚠ **−23 (2026-09-18, R1): the shared `response_format` wording — see `dopl_ontology` for the argument.** ⚠ **R1 CONSISTENCY WAVE (2026-09-18)** — re-derived whole through the real `listTools()`; the accounting for the whole batch is on `SERVED_TOTAL_CEILING`. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **−2 (2026-09-18): BANKED, NOT SPENT.** The `container` arg's description dropped `your` from `(your home space)` — the home space resolves per caller, so the word was a character cost with no reader. The same edit deleted its FALSE `(your default)` (`workspace-arg.ts`): an agent inside a channel lands in the CHANNEL's container, which `instructions.ts` states correctly on the same connection. **The two characters are what the true version cost.** ⚠ **+21 (2026-09-17, R-32): the second addressing key — see `dopl_agent` above for the whole argument.** // ⚠ 1,080 → 1,076 (2026-09-06): measured after the doctrine move. // ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.**
  dopl_skill: 3424, // +365 (2026-09-23, DMP-002): NEW OPS history + restore, the licence this file accepts. (`revision`, `limit`) ⚠ **+12 (2026-09-18, R1): THE OTHER HALF OF AN ASYMMETRY, RECORDED.** `set_visibility` here is REVERSIBLE and on `dopl_kb` it is ONE WAY, and neither surface said so about the other (S14), so an agent that learned the skill lane first tried to un-publish a base and was refused by a sentence that read like a bug. `'private' makes it owner-only again` → `'private' reverses it (a knowledge base cannot)`. ⚠ **12 chars per connection buys the one fact a caller cannot derive from either tool alone.** ⚠ **R1 CONSISTENCY WAVE (2026-09-18)** — re-derived whole through the real `listTools()`; the accounting for the whole batch is on `SERVED_TOTAL_CEILING`. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **−2 (2026-09-18): BANKED, NOT SPENT.** The `container` arg's description dropped `your` from `(your home space)` — the home space resolves per caller, so the word was a character cost with no reader. The same edit deleted its FALSE `(your default)` (`workspace-arg.ts`): an agent inside a channel lands in the CHANNEL's container, which `instructions.ts` states correctly on the same connection. **The two characters are what the true version cost.** ⚠ **+21 (2026-09-17, R-32): the second addressing key — see `dopl_agent` above for the whole argument.** // ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.**
  // ⚠ THESE THREE EACH FELL BY 7 AND ROSE BY 1, BOTH EDITS IN OTHER FILES —
  // `response-size.ts › RESPONSE_FORMAT_FIELD` and `shelf.ts › SHELF_ARG_DESCRIPTION`.
  dopl_status: 764, // ⚠ **−23 (2026-09-18, R1): the shared `response_format` wording — see `dopl_ontology`.** ⚠ **R1 CONSISTENCY WAVE (2026-09-18)** — re-derived whole through the real `listTools()`; the accounting for the whole batch is on `SERVED_TOTAL_CEILING`. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** 
  // ⚠ THE ONE THAT REPLACED THREE (B13). ⚠ **114 → 364 (F-621), A RISE ON THE
  // ONE LICENCE THIS FILE ACCEPTS: A NEW OP.** 114 was the empty object an
  // argument-less tool renders; the home-channel mint moved here when B13
  // retired `dopl_home` with no successor. `op` + `name` cost 250 and replaced
  // 1,160 (`dopl_home`'s 440 of schema, 440 of description, `current_workspace`'s
  // 720 schema). The DESCRIPTION did not rise — it still fits the 450 READ cap.
  dopl_workspaces: 364,
};

/**
 * ⚠ WHAT AN EXTERNAL CONNECTION COSTS BEFORE IT HAS DONE ANYTHING: every
 * description + every input schema + the `instructions` briefing. Doctrine is
 * NOT in it — that is pulled, and {@link DOCTRINE_CEILING} is its separate
 * ratchet.
 *
 * ⚠ **95,174 → 54,702 ACROSS WAVE A (2026-09-02), A FALL OF 40,472 CHARS / 42%**,
 * re-measured whole at integration through the real `listTools()`. Where it came
 * from, largest first: `dopl_channel`'s schema −10,407 (A6 + A6b, ops and params
 * DELETED), the briefing −15,216 (A1), the five `_admin` tools −9,295 (A3), the
 * `workspace` argument −8,792 across fourteen tools (A4). ⚠ **NEVER QUOTE THIS
 * NUMBER — re-derive it.** It is the sum of a boot, and every figure a doc has
 * ever carried about this surface has gone stale inside a day (F-422).
 *
 * ⚠ IT IS NOT ARITHMETIC OVER THE ROWS ABOVE, AND THAT IS THE POINT. The
 * per-tool ceilings bound each tool; this bounds the SURFACE, so adding tools
 * cannot pay for itself by staying under every individual ceiling. Keeping it
 * true also forces the headline number to be re-measured on every slice that
 * claims a win.
 */
// The granular set's own served total, its briefing included (which states the body fence once and
// must leave room for directory rows). Re-derive, never quote. The ceiling may never pass the target,
// the legacy total when the split was planned.
const GRANULAR_SERVED_CEILING = 44_247; // +6 (1.37.1): the `section` matching words. +94 (1.37.1, live test #5): `scope` said only "everywhere … max 6"; three agents missed hits because "here" was undefined. The definition is a param line and cannot be pulled.
const GRANULAR_SERVED_TARGET = 49_205;
const SERVED_TOTAL_CEILING = 50_255; // −8 (1.37.1): the shelf is called the home shelf on dopl_agent. +7 (1.37.1): the `section` matching words. // re-derive, never quote: −2 the 2026-09-23 vocabulary removal merged onto DMP-002 (dopl_ontology: −3 schema, +1 history gloss), −5 DMP-004 (dopl_search names ten domains in the same 450), +964 DMP-002 history+restore on three tools, +119 DMP-009 field type enum, −6 DMP-001 net, −229 home-channel addressing pulled (P8-23), +15 caller's own tool loader (X-09), +9 P8-15/P8-18.
/**
 * ⚠ THE BRIEFING IS WRITTEN ONCE AND PUSHED ONCE. It was 17,067 chars — 18% of
 * the connection, larger than every description put together bar three — and
 * A1 cut it to a structural 2,048 cap, measuring **1,849** at integration.
 * ⚠ THE CAP AND THIS CEILING ARE DIFFERENT INSTRUMENTS: `instructions.ts`
 * ENFORCES 2,048 by dropping directory rows that do not fit, and this ratchets
 * what the tree ACTUALLY writes, so prose growing back into the headroom is
 * caught here rather than absorbed silently by the cap.
 * ⚠ WHAT THIS CEILING DOES NOT SEE: whether the CLIENT
 * keeps all of it. Nothing in this tree truncates the briefing (F-423), so
 * "written" and "delivered" are the same number at every layer we own; a cut
 * inside a consuming runtime is not observable from here and must not be
 * asserted here.
 */
// ⚠ **1,851 → 1,857 (B8): A RISE, RECORDED.** Both op names the briefing spells
// moved — six characters, against the FIRST string an agent reads being wrong.
// ⚠ **1,857 → 1,801 (B13):** the membership-count branch and the home-channel
// count both left — nothing is refused for want of a workspace, and containers
// are LISTED by the orientation tool rather than counted here.
const INSTRUCTIONS_CEILING = 1_804; // +15: an unstamped caller reads "your client's tool search", not Claude's `ToolSearch` (X-09).

/**
 * ⚠ THE PULLED SIDE, AND IT IS BUDGETED SEPARATELY ON PURPOSE (principle 7).
 * The sum of every resource this server publishes — one today,
 * `dopl://doctrine/channels`.
 *
 * ⚠ **IT ROSE, 28,870 → 32,728, AND HERE IS THE TRADE THAT LICENSES IT.** A6 and
 * A6b moved standing doctrine out of `.describe()` — which is PUSHED on every
 * connection — into this document, which is PULLED only by an agent that asks.
 * The pushed side fell 40,472 chars over the same wave (see
 * {@link SERVED_TOTAL_CEILING}); this rose 3,858. **A rise of 1 against a fall of
 * 10.5 is the design; a rise with no matching fall is prose laundering, and this
 * is the gate for it.** Without a SEPARATE budget here every future description
 * cut could be laundered into an unbounded pulled document and the headline
 * number would keep improving while nothing got simpler.
 *
 * ⚠ **AND A PULLED BUDGET OVER NOTHING IS THE FAILURE MODE**, which is why the
 * test above it asserts the resource is still published at all: if it stopped
 * being served, every figure here would read 0 and go green while the doctrine
 * reached no agent.
 */
// ⚠ **32,728 → 32,551 ON 2026-09-02 (review fixes).** `client_msg_id`'s two-key
// paragraph collapsed to one sentence when `channel_tasks` took the author scope
// (C14), and the protocol section stopped naming the deleted `kind` param. Banked
// here rather than left as headroom, which is what this ratchet is for.
// ⚠ **32,551 → 8,960 (B8), THE LARGEST SINGLE FALL HERE.** The doctrine was
// where every evicted paragraph landed: 5,765 of refusals, 4,873 of own-agent
// narrative, 3,914 on a hold that is now a knob on `read`.
// DMP-013: the same doctrine spelled for a granular connection (longer tool names). Re-derive, never quote.
const GRANULAR_DOCTRINE_CEILING = 14_500;
const DOCTRINE_CEILING = 14_248; // +312 pulled against −229 pushed: home-channel addressing moved into `rooms` (P8-23); +16 P8-20. Re-derive, never quote.

const WS: WorkspaceListItem = {
  id: "11111111-1111-1111-1111-111111111111", ownerId: "owner", name: "Alpha", slug: "alpha",
  publicId: "pub-1", description: null, role: "owner",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
};

/** Enough of the client for registration. ⚠ No handler runs on this path. */
function stubClient(): DoplClient {
  return {
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [WS] }),
    getWorkspaceId: vi.fn(() => null),
    setWorkspaceId: vi.fn(),
    listChannels: vi.fn().mockResolvedValue([]),
    listKbBases: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    getOntology: vi.fn().mockResolvedValue({ ontologies: [], objects: {} }),
  } as unknown as DoplClient;
}

let client: Client;
let listed: Awaited<ReturnType<Client["listTools"]>>;
let descriptions: Map<string, number>;
let schemas: Map<string, number>;
let instructions: string;
/** Every published resource's body, by URI. Doctrine is the only one today. */
let doctrine: Map<string, number>;

async function connect(toolSet: ToolSet): Promise<Client> {
  const server = createServer(stubClient(), {
    toolSet,
    directory: [WS],
    workspace: WS,
    role: "owner",
    workspaceSource: "sole membership",
    scopes: ["dopl.read", "dopl.write"],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const probe = new Client({ name: "budget-probe", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), probe.connect(clientTransport)]);
  return probe;
}

beforeAll(async () => {
  client = await connect("legacy");
  listed = await client.listTools();
  descriptions = new Map(listed.tools.map((t) => [t.name, (t.description ?? "").length]));
  schemas = new Map(listed.tools.map((t) => [t.name, JSON.stringify(t.inputSchema).length]));
  instructions = client.getInstructions() ?? "";
  doctrine = await resourceSizes(client);
});

/**
 * Every published resource's body length, by URI. ⚠ A resource may answer text OR a blob; only text
 * costs an agent tokens, and the doctrine is markdown, so a blob here would be a different bug.
 */
async function resourceSizes(probe: Client): Promise<Map<string, number>> {
  const { resources } = await probe.listResources();
  const size = async (uri: string) =>
    (await probe.readResource({ uri })).contents.map((c) => ("text" in c ? c.text : "")).join("").length;
  return new Map(await Promise.all(resources.map(async ({ uri }) => [uri, await size(uri)] as const)));
}

const sum = (sizes: Map<string, number>) => [...sizes.values()].reduce((a, b) => a + b, 0);

afterAll(async () => {
  await client?.close();
});

/** Every measured char an external client is pushed on connection. */
function servedTotal(tools = listed.tools, briefing = instructions): number {
  return tools.reduce((n, t) => n + (t.description ?? "").length + JSON.stringify(t.inputSchema).length, briefing.length);
}

describe("the pushed surface fits its budget, as served", () => {
  it("registers the tools at all (a scan over nothing is not a guard)", () => {
    expect(listed.tools.length).toBeGreaterThan(5);
    expect(listed.tools.map((t) => t.name)).toContain("dopl_channel");
  });

  it(`no description exceeds ${DESCRIPTION_MAX_CHARS} chars, except the ratcheted ${Object.keys(OVER_BUDGET_CEILINGS).length}`, () => {
    expectRatchet(
      "a tool description",
      ratchet(descriptions, OVER_BUDGET_CEILINGS, DESCRIPTION_MAX_CHARS),
      "move standing doctrine into an MCP resource (see channel-doctrine.ts) rather than raising the number",
      `lower the ceiling to the measured size, or (at or under ${DESCRIPTION_MAX_CHARS}) delete the entry so the cap enforces itself`,
    );
  });

  it("every input schema is ratcheted, and every served tool declares one", () => {
    // ⚠ THE BIGGER HALF, AND IT HAD NO GATE. 53,581 chars against 24,526 of
    // description — because `.describe()` is where doctrine goes when a
    // description gets audited, and nothing was counting it.
    expectRatchet(
      "a tool input schema",
      ratchet(schemas, SCHEMA_CEILINGS),
      "delete an op or a param, or move its `.describe()` prose into the doctrine — a schema is pushed to every client on every connection",
    );
  });

  it("the whole connection is bounded, so a new tool cannot arrive for free", () => {
    expectRatchet(
      "the served surface (descriptions + input schemas + instructions)",
      ratchet(new Map([["served per connection", servedTotal()]]), {
        "served per connection": SERVED_TOTAL_CEILING,
      }),
      "the per-tool ceilings above bound each tool; this bounds the surface",
    );
  });

  it("the granular set is bounded on its own, the same way", async () => {
    const probe = await connect("granular");
    const total = servedTotal((await probe.listTools()).tools, probe.getInstructions() ?? "");
    await probe.close();
    expectRatchet(
      "the granular served surface",
      ratchet(new Map([["granular per connection", total]]), { "granular per connection": GRANULAR_SERVED_CEILING }),
      "cut a param line or a description before raising it",
    );
    expect(GRANULAR_SERVED_CEILING).toBeLessThanOrEqual(GRANULAR_SERVED_TARGET);
  });

  it("the `instructions` briefing is bounded, and is delivered exactly as written", () => {
    expectRatchet(
      "the instructions briefing",
      ratchet(new Map([["instructions", instructions.length]]), {
        instructions: INSTRUCTIONS_CEILING,
      }),
      "it is pushed once per connection whether or not the agent needs any of it",
    );
    // ⚠ WRITTEN == DELIVERED, at the one layer this repo owns. The handshake
    // carries the briefing whole, so a shrink at the source is a shrink on the
    // wire and this file may measure either. `workspaceSource` is not a header
    // pin above, so the boot passes `pin: null`.
    // ⚠ **AND THE `identity` ARGUMENT IS PART OF THE CONTRACT NOW (A14).**
    // `createServer` always supplies one; this boot hands it no caller, no
    // containers and no transport-reported agents, so it renders the honest
    // UNRESOLVED form — which is what an external client with no `X-Dopl-*`
    // headers actually receives. Reproducing the call EXACTLY is the point:
    // an equality that quietly ignored a new argument would stop being the
    // written-equals-delivered claim it is here for.
    expect(instructions).toBe(
      buildInstructions([WS], {
        pin: null,
        directoryLoadFailed: false,
        identity: { userId: null, homeChannels: 0, boundChannelId: null, liveAgents: undefined, posture: null },
      }),
    );
  });

  it("`dopl_channel` POINTS at the doctrine instead of carrying it", () => {
    // ⚠ THE HEADLINE MEASUREMENT OF THIS TIER. It was 34,904 chars — half the
    // whole surface — because it carried the law, the model, the await protocol
    // and a paragraph per op. Those are the `dopl://doctrine/channels` resource
    // now, pulled on demand, and this is the assertion that keeps them there.
    const description = listed.tools.find((t) => t.name === "dopl_channel")?.description ?? "";
    expect(description).toContain('action="help"');
    expect(description).toContain("dopl://doctrine/channels");
    // ⚠ THE LAW IS NOT INLINED ANY MORE. This is the assertion that stops 35k of
    // prose growing back one honest sentence at a time.
    expect(description).not.toContain("THE LAW OF THIS ROOM");
  });
});

describe("the pulled doctrine fits its own, separate budget", () => {
  it("publishes the doctrine the pushed budget was cut against", () => {
    // ⚠ A PULLED BUDGET OVER NOTHING IS THE FAILURE MODE, NOT THE GOAL. If the
    // resource stopped being served, every ratchet below would read 0 and go
    // green while the doctrine reached no agent at all.
    expect([...doctrine.keys()]).toContain("dopl://doctrine/channels");
  });

  it("is ratcheted per resource and in total", () => {
    const total = sum(doctrine);
    expectRatchet(
      "the pulled doctrine",
      ratchet(new Map([["all resources", total]]), { "all resources": DOCTRINE_CEILING }),
      "a rise is only legitimate against a LARGER fall in the pushed surface — record the trade here or it is prose laundering",
    );
  });

  it("is ratcheted on a granular connection against its own ceiling", async () => {
    const probe = await connect("granular");
    const total = sum(await resourceSizes(probe));
    await probe.close();
    expectRatchet(
      "the granular pulled doctrine",
      ratchet(new Map([["all resources", total]]), { "all resources": GRANULAR_DOCTRINE_CEILING }),
      "the same rules in granular names; a rise is a legacy rise first",
    );
  });
});
