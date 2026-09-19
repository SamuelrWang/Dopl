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
import { DESCRIPTION_MAX_CHARS } from "./tools/channel-description.js";

/**
 * ⚠ A CEILING THAT ONLY EVER MOVES DOWN — AND ALL FOUR OF ITS HALVES. Only the
 * first is a budget; the other three are what keep it one.
 *
 *   • OVER    — it grew past its ceiling. The regression this file is for.
 *   • STALE   — it shrank below its ceiling, so the ceiling can be lowered.
 *     ⚠ The description half of this **asserted nothing until 2026-09-02**: it
 *     read `len <= Math.min(ceiling, DESCRIPTION_MAX_CHARS)`, and since every
 *     ceiling here is ABOVE the cap the `Math.min` collapsed to the cap, which
 *     re-asks the OVER question. Every shrink in between — the whole range the
 *     half exists to police — passed silently. It caught two real shrinks the
 *     hour it was repaired.
 *   • DEAD    — a ceiling for a name nothing serves any more. Wave A deletes
 *     five tools; without this their entries outlive them and become headroom
 *     for whatever is added next.
 *   • MISSING — a name served with no ceiling declared. Without it a NEW tool
 *     joins the surface unbudgeted, which is how a per-item gate stops bounding
 *     the total. `cap` opts a family out of this half: descriptions have a
 *     shared cap, so only the over-cap ones declare a ceiling of their own.
 */
interface RatchetReport {
  over: string[];
  stale: string[];
  dead: string[];
  missing: string[];
}

function ratchet(
  measured: ReadonlyMap<string, number>,
  ceilings: Readonly<Record<string, number | undefined>>,
  cap?: number,
): RatchetReport {
  const report: RatchetReport = { over: [], stale: [], dead: [], missing: [] };
  for (const [name, size] of measured) {
    const ceiling = ceilings[name] ?? cap;
    if (ceiling === undefined) {
      report.missing.push(`${name}: ${size} chars, no ceiling declared`);
    } else if (size > ceiling) {
      report.over.push(`${name}: ${size} chars (ceiling ${ceiling})`);
    }
  }
  for (const [name, ceiling] of Object.entries(ceilings)) {
    if (ceiling === undefined) continue;
    const size = measured.get(name);
    if (size === undefined) {
      report.dead.push(`${name}: ceiling ${ceiling}, nothing serves it`);
    } else if (size < ceiling) {
      report.stale.push(`${name}: ${size} chars, ceiling ${ceiling}`);
    }
  }
  return report;
}

/** Asserts all four halves, so no ratchet in this file can ship with three. */
function expectRatchet(
  what: string,
  report: RatchetReport,
  grew: string,
  shrank = "lower the ceiling to the measured size in the same commit — that is how the win gets banked",
): void {
  const list = (rows: string[]) => `\n- ${rows.join("\n- ")}`;
  expect(report.over, `${what} grew past its ceiling. ${grew}:${list(report.over)}`).toEqual([]);
  expect(report.stale, `${what} shrank below its ceiling — ${shrank}:${list(report.stale)}`).toEqual([]);
  expect(report.dead, `${what}: a ceiling holding up nothing — delete the entry:${list(report.dead)}`).toEqual([]);
  expect(report.missing, `${what}: served with no ceiling — measure it and declare one, never leave it unbudgeted:${list(report.missing)}`).toEqual([]);
}

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
  dopl_agent: 1761, // ⚠ 1,797 → 1,761 (2026-09-06, the artifacts wave: `channel-schema.ts`'s pushed `.describe()` prose fell 762 (9,445 → 8,683 measured) as standing contract prose moved into the PULLED doctrine; the doctrine rose 74 to pay for it. 762 down, 74 up — a 688-char net fall on the surface every client is handed on every connection. Every number below is a MEASUREMENT from a real gate run, not a hand count.)
  // ⚠ 1,591 → 1,596 (B8): barely moved while the string changed completely — 23
  // op names fell to 5, and a generated `Limits:` block took it back.
  // ⚠ 1,596 → 1,587 (B13): the discovery sentence names `dopl_workspaces`.
  dopl_channel: 1589, // ⚠ **−12 (2026-09-18): BANKED, NOT SPENT.** `HOME_CHANNEL_ADDRESSING`'s tenancy clause said a template or base *"must LIVE there"*, which is false for an ID (`service-resolve-ref.ts` follows a UUID to its own container, and `knowledge-shared.ts › resolveBaseRef` has the F-470 id door). The replacement says what is true and is shorter. ⚠ **1,603 → 1,601 (2026-09-17, −2): BANKED, NOT SPENT.** R-32 relabelled the home-channel addressing clause `workspace=<container id>` → `container=<slug or id>` (`channel-description.ts › HOME_CHANNEL_ADDRESSING`): the same claim, two characters shorter, and a container HAS a slug now. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **1,587 → 1,603 (+16, 2026-09-06), AND IT IS A RISE PAID TO A DIFFERENT
  // GUARD, NOT LAUNDERING.** The doctrine move first took this description DOWN to 1,571; then
  // `tool-style.test.ts › call-shape examples` came due — an op-dispatch tool must publish three
  // call shapes and this one published two, which no amount of prose trimming fixes. The third
  // example (`op="read"`) costs 32 chars, so the description lands 16 above where it started.
  // ⚠ THE WAVE STILL FELL: the pushed schema went 9,445 → 8,664 (−781) and the whole served
  // surface 47,464 → 47,319 (−145) IN THE SAME CHANGE. A guard that requires a published example
  // outranks a ceiling this file may set, and the trade is recorded here rather than absorbed.
  dopl_chats: 1699,
  dopl_kb: 1825, // ⚠ **1,888 → 1,825 (2026-09-18, −63): PINNING LEFT THE SURFACE, AND THE FALL IS BANKED IN THE SAME CHANGE.** Samuel's ruling removed knowledge pinning outright, so `dopl_kb` lost its `"pin"/"unpin" — the STARTUP CONTEXT every session here gets.` op bullet. ⚠ **THE OTHER HALF OF THE REMOVAL IS ON THE SCHEMA SIDE** (−143, `SCHEMA_CEILINGS.dopl_kb`): `op`'s published enum dropped two values and `base`/`path` dropped the op names and the with-a-path-you-pin-ONE-entry target rule. ⚠ **A REMOVAL IS RATCHETED EXACTLY LIKE A TRIM** — the STALE half of this ratchet fails as loudly for a feature that left as for prose that was shortened, which is the whole point: an unbanked fall is headroom for whatever is added next, and this one is 63 chars per connection that a future op would otherwise get for free. ⚠ **NOTHING PINNED BY `tool-scope-claims.test.ts` MOVED** — the three filtered-op bullets (`list_bases`, `get_tree`, `search`), the SECURITY line and the deletion-is-app-only boundary clause are untouched; what left was one bullet for ops that no longer exist. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **1,878 → 1,888 (2026-09-15, +10): THE `ambiguous_slug` ERROR ROW, MOSTLY PAID FOR AND THE REMAINDER RECORDED.** The row costs ~84 as served, and it is not optional prose. A slug naming bases in two containers used to resolve to whichever `Array.find` reached first, so `dopl-development` answered "0 folders, 0 entries" from an empty shell in the personal container for ten days while the real base filled up elsewhere (`KB-LOSS-TRACE.md`, F-701). ⚠ A SILENT PICK CANNOT BE DIAGNOSED FROM ITS OWN ANSWER — an empty tree is what an empty base looks like — and `tool-errors.ts`'s whole mechanism is that the literal on the wire is the literal the description taught, so the code must be PUSHED, and pushed prose must be bought. ⚠ **~74 CAME FROM FACTS THIS CONNECTION ALREADY PUSHED TWICE**, this description's own de-duplication rule applied three more times: the headline's `Only bases you have a grant on` (the `list_bases` bullet states it more precisely; ⚠ it is NOT the `you have no grant on` string `tool-scope-claims.test.ts` pins, and that bullet is untouched), that bullet's now-redundant `by slug` (the headline names the addressing), and the grant bullet's `— ONE row, one edit reaches all` (`scope`'s own describe: *"the row itself never moves"*). ⚠ **TWO FURTHER CUTS WERE MADE AND REVERTED, EACH BY A GATE THAT IS RIGHT**: the policy's `deletion is app-only` is the BOUNDARY CLAUSE `tool-style.ts` requires in the first 200 chars (it is duplicated, and it is still load-bearing), and `entry_cursor for more` is the continuation a truncating op owes its caller (`tool-scope-claims.test.ts`) — a cap that names no cursor is a silent truncation. The changelog clause below was cut first and put back for the reason its own note gives. ⚠ **SO +10 IS WHAT SURVIVED, AND IT IS RECORDED RATHER THAN ABSORBED** (`SERVED_TOTAL_CEILING`'s rule): 10 chars per connection buys the difference between an agent that is told its slug was ambiguous and one that writes ten days of notes into the wrong base. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **1,881 → 1,878 (2026-09-09, −3): THE CHANGELOG CLAUSE, PAID FOR AND THEN SOME.** `write_file` now says *"writes land in the changelog"* — a fact about what the op DOES that an agent can learn nowhere else, because nothing in the WRITE RESULT mentions it and the doctrine is PULLED. The clause is 30 chars as served; six copy-edits inside this same description paid for it and three more: `Read the excerpt … in that order` → `Read excerpt … in order`, `across … and ontology` → `over … , ontology`, `entries over ~1.5k` → `entries past ~1.5k`, `one-way` → `one way`, `lend one YOU created — ONE row, so an edit reaches everyone` → `lend one YOU made — ONE row, one edit reaches all`, and `every session launched here` → `every session here`. ⚠ **THREE FURTHER TRIMS WERE MADE AND PUT BACK, AND THE GATE THAT CAUGHT THEM IS `tool-scope-claims.test.ts`, NOT THIS ONE**: `you have no grant on`, `ENTRIES are paged` and `the BODIES of bases you can read` are each a DISCLOSURE a filtered read op owes its caller, pinned there by name. A budget trim that deletes one buys the number by telling the truth less — check the scope-claims gate before shortening a bullet here. ⚠ **THE TRIM CAME FIRST AND THE CEILING WENT DOWN, WHICH IS THE ONLY SHAPE THIS FILE ACCEPTS FOR A NEW SENTENCE** — the instructions ceiling states the rule; this is it applied one surface over. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **1,947 → 1,937 (B15); 1,937 → 1,986 (2026-09-03, +49): ONE OP AND TWO ROUTING SENTENCES.** `op="outline"` must be glossed (`parity.test.ts`), and the sentences are the routing this wave teaches — *excerpt → outline → section → body*, and *entries over ~1.5k chars carry ## headings*. ⚠ **A ROUTING LINE CANNOT MOVE INTO THE PULLED DOCTRINE**, on the fence's own argument: the agent that has not read `dopl://doctrine/knowledge` is the one still reading whole documents. ⚠ **49 IS WHAT SURVIVED A TRIM OF 233** — bullets, the headline's duplicate "never deletes" and one call shape paid the rest. Against it, per READ: 839 chars for one section of a 2,559-char entry against 2,760 whole.
  dopl_members: 1453,
  dopl_ontology: 1919, // ⚠ **1,922 → 1,919 (2026-09-09): BANKED, NOT RAISED, THE SECOND TIME IN A DAY** — the CHANGELOG lane part 2 added a clause saying every write is filed per field in the changelog, and paid for it out of this same description; `tools/ontology.ts › ONTOLOGY_PROSE_BUDGET` lists what was trimmed. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.**
  dopl_skill: 1593,
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
  dopl_agent: 5103, // ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.** // ⚠ **−2 (2026-09-18): BANKED, NOT SPENT.** The `container` arg's description dropped `your` from `(your home space)` — the home space resolves per caller, so the word was a character cost with no reader. The same edit deleted its FALSE `(your default)` (`workspace-arg.ts`): an agent inside a channel lands in the CHANNEL's container, which `instructions.ts` states correctly on the same connection. **The two characters are what the true version cost.** ⚠ **+21 ON EVERY DOMAIN SCHEMA (2026-09-17, R-32): THE SECOND ADDRESSING KEY.** `container=` replaces `workspace=` and the old spelling stays one release as a DEPRECATED ALIAS, so nine schemas carry two keys instead of one — `strictInput` turns an unknown key into `-32602`, which is the one outcome a deprecation window rules out, so the alias cannot simply be dropped. ⚠ **THE ALIAS IS PUBLISHED WITH NO `.describe()`, AND THAT IS WHAT MAKES THE RISE 21 AND NOT 70** — a clause describing it would be ~290 chars per connection advertising an argument nobody should newly adopt; the deprecation reaches the caller that USED it, on the result (`workspace-arg.ts › deprecatedAliasNote`). ⚠ **AND `container`'s OWN DESCRIPTION IS 9 CHARS SHORTER THAN THE ONE IT REPLACED** while naming one more address form (`home`), which is why 21 is the whole cost of a second key rather than a second key plus prose. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **4,021 → 5,114 (2026-09-08, +1,093): A RISE, AND THE WHOLE OF IT IS ONE NEW PARAMETER** — `knowledge`, an array of `{base, folder?, entry?}` (Samuel: *"I want to be able to specific folders or entries/files"*). 830 of the 1,093 is the SHAPE rather than prose: three `z.string().uuid()`s render `format` plus a pattern apiece (measured: 830 with three, 440 with one, 245 with none). ⚠ **THE CHEAP VERSIONS WERE MEASURED AND REFUSED.** Dropping `.uuid()` off `folder`/`entry` banks 390 by making a malformed id a ROUND TRIP instead of a local refusal, on the surface where a round trip is the expensive thing; the discriminated union the server stores renders as an `anyOf` of three shapes, which is bigger AND is a branch a model picks wrong. The rest is the two `.describe()`s, trimmed twice. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.**
  // ⚠ 11,609 → 8,678 (B8), every character from a param or an op LEAVING; F-577 records the gap to the 3,000 target.
  dopl_channel: 8899, // ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.** // ⚠ **RE-DERIVED WHOLE AT INTEGRATION (2026-09-18)** — two branches moved this row in the same wave (the home-channel scope fence and the addressing structure) and neither side's arithmetic is the merged truth, so the number below is a fresh measurement through the real `listTools()`. ⚠ **8,944 → 8,936 (2026-09-18, −8): THE ADDRESSING STRUCTURE, AND THE PUSHED SIDE OF IT IS A NET FALL.** `kind` gained `"record"` (the post for nobody, which is what lets a send naming nobody be REFUSED rather than guessed at) and `to` gained the comma-separated LIST — and both were funded, not recorded: `to` lost *"of your own operator's"* and *"the one to"*, `kind` lost *"a person answers with"*, and `limit` lost *"and older ones are absent rather than reported"*, which the doctrine's `read` section already carries verbatim and is PULLED. ⚠ **THE RULE ITSELF IS IN THE PULLED DOCTRINE** (`channel-doctrine-budget.test.ts › DOCTRINE_MAX_CHARS`, +1,080), which is this file's own instruction followed rather than worked around: what a `.describe()` may carry is the CONTRACT of one field. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **+21 (2026-09-17, R-32): the second addressing key — see `dopl_agent` above for the whole argument.** // ⚠ **8,895 → 8,923 (2026-09-15, +28): the launch-time name-uniqueness rule. The argument, and why the RULE went to the doctrine while only the CONTRACT stayed on the describe, is at `channel-schema.ts › SCHEMA_MAX_CHARS`; this number is that one plus the registrar's injected `workspace` arg. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **8,899 → 8,895 (−4, 2026-09-15): THE AGENT-ID-VISIBILITY WAVE, AND IT PAID FOR ITSELF.** `name` gained the LAUNCH clause (an agent that launches an agent names it — Samuel's ruling) and lost a FALSE one: *"`@agent-<id>` stays the only address, nothing resolves an agent by its name, and the label reaches no server"* had been pushed to every client on every connection since 2026-09-06, and the name door has resolved in all three trees since 2026-08-28. **Deleting a false sentence is not a saving to be spent elsewhere — it is the reason the true one fits.** ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **8,901 → 8,899 (2026-09-15, −2): the topic→description RELABEL, which paid for itself — see `channel-schema.ts › SCHEMA_MAX_CHARS`, where the two characters are argued. ⚠ 8,664 → 8,901 (2026-09-13, +237): THE AGENT-COLOUR PARAM.** The full argument — what the `color` field costs, the 134 of pushed prose that was MOVED into the pulled doctrine to fund part of it, and the TWO cheaper shapes that were measured and REFUSED (a `pattern`, 153 cheaper, forbidden by `tool-style.test.ts`; `posture`'s clamp sentence, pinned on its describe by two suites) — is stated once, at `channel-schema.ts › SCHEMA_MAX_CHARS`, and is not restated here. This number is that one plus the registrar's injected `workspace` arg. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **−7 (2026-09-18): BANKED, NOT SPENT.** −2 is the `container` arg (see `dopl_agent`); the other −5 is the launch `template` describe, which lost *"It resolves in THIS CHANNEL'S container"* — FALSE for a UUID since B2 — and states the ID/NAME split in fewer characters than the false sentence took. **A false sentence deleted is not a saving to spend elsewhere; it is why the true one fits.** ⚠ **+21 (2026-09-17, R-32): the second addressing key — see `dopl_agent` above for the whole argument.** // ⚠ **8,895 → 8,923 (2026-09-15, +28): the launch-time name-uniqueness rule. The argument, and why the RULE went to the doctrine while only the CONTRACT stayed on the describe, is at `channel-schema.ts › SCHEMA_MAX_CHARS`; this number is that one plus the registrar's injected `workspace` arg. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **8,899 → 8,895 (−4, 2026-09-15): THE AGENT-ID-VISIBILITY WAVE, AND IT PAID FOR ITSELF.** `name` gained the LAUNCH clause (an agent that launches an agent names it — Samuel's ruling) and lost a FALSE one: *"`@agent-<id>` stays the only address, nothing resolves an agent by its name, and the label reaches no server"* had been pushed to every client on every connection since 2026-09-06, and the name door has resolved in all three trees since 2026-08-28. **Deleting a false sentence is not a saving to be spent elsewhere — it is the reason the true one fits.** ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **8,901 → 8,899 (2026-09-15, −2): the topic→description RELABEL, which paid for itself — see `channel-schema.ts › SCHEMA_MAX_CHARS`, where the two characters are argued. ⚠ 8,664 → 8,901 (2026-09-13, +237): THE AGENT-COLOUR PARAM.** The full argument — what the `color` field costs, the 134 of pushed prose that was MOVED into the pulled doctrine to fund part of it, and the TWO cheaper shapes that were measured and REFUSED (a `pattern`, 153 cheaper, forbidden by `tool-style.test.ts`; `posture`'s clamp sentence, pinned on its describe by two suites) — is stated once, at `channel-schema.ts › SCHEMA_MAX_CHARS`, and is not restated here. This number is that one plus the registrar's injected `workspace` arg. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.**
  dopl_chats: 3542, // ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.** // ⚠ **−2 (2026-09-18): BANKED, NOT SPENT.** The `container` arg's description dropped `your` from `(your home space)` — the home space resolves per caller, so the word was a character cost with no reader. The same edit deleted its FALSE `(your default)` (`workspace-arg.ts`): an agent inside a channel lands in the CHANNEL's container, which `instructions.ts` states correctly on the same connection. **The two characters are what the true version cost.** ⚠ **+21 (2026-09-17, R-32): the second addressing key — see `dopl_agent` above for the whole argument.**
  // ⚠ 5,347 → 5,141 (B15), same trade
  dopl_kb: 5553, // ⚠ **5,726 → 5,583 (2026-09-18, −143): THE SCHEMA HALF OF THE PINNING REMOVAL, BANKED.** `op`'s published enum lost `"pin"` and `"unpin"` (the runtime union keeps only the retired COPY names, which are a different window), `base` lost `/pin/unpin` from its required-op list, and `path` lost the whole target rule — *with a path you pin that ONE entry, without one you pin the whole base* — which was the longest single clause on this shape. ⚠ **THE DESCRIPTION HALF IS −63** (`DESCRIPTION_CEILINGS.dopl_kb`), and 63 + 143 = the 206 `SERVED_TOTAL_CEILING` fell by. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **−2 (2026-09-18): BANKED, NOT SPENT.** The `container` arg's description dropped `your` from `(your home space)` — the home space resolves per caller, so the word was a character cost with no reader. The same edit deleted its FALSE `(your default)` (`workspace-arg.ts`): an agent inside a channel lands in the CHANNEL's container, which `instructions.ts` states correctly on the same connection. **The two characters are what the true version cost.** ⚠ **+21 (2026-09-17, R-32): the second addressing key — see `dopl_agent` above for the whole argument.** // ⚠ **5,138 → 5,707 (2026-09-03, +569): TWO PARAMETERS PLUS AN OP NAME — the one licence this file accepts.** `section` and `offset` are what make a heading an address; a published argument cannot move into a pulled document, and trimming its describe into uselessness buys the number by making the knob unusable — the argument `response_format` and `max_chars` rode. ⚠ **AND IT PAYS FOR ITSELF PER CALL, NOT PER CONNECTION**: 569 once, against 1,921 saved by ONE sectioned read of a 2,559-char entry. // ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.**
  dopl_map: 239, // ⚠ **−2 (2026-09-18): BANKED, NOT SPENT.** The `container` arg's description dropped `your` from `(your home space)` — the home space resolves per caller, so the word was a character cost with no reader. The same edit deleted its FALSE `(your default)` (`workspace-arg.ts`): an agent inside a channel lands in the CHANNEL's container, which `instructions.ts` states correctly on the same connection. **The two characters are what the true version cost.** ⚠ **+21 (2026-09-17, R-32): the second addressing key — see `dopl_agent` above for the whole argument.** // ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.**
  dopl_members: 834, // ⚠ **−2 (2026-09-18): BANKED, NOT SPENT.** The `container` arg's description dropped `your` from `(your home space)` — the home space resolves per caller, so the word was a character cost with no reader. The same edit deleted its FALSE `(your default)` (`workspace-arg.ts`): an agent inside a channel lands in the CHANNEL's container, which `instructions.ts` states correctly on the same connection. **The two characters are what the true version cost.** ⚠ **+21 (2026-09-17, R-32): the second addressing key — see `dopl_agent` above for the whole argument.** // ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.**
  dopl_ontology: 2798, // ⚠ **−2 (2026-09-18): BANKED, NOT SPENT.** The `container` arg's description dropped `your` from `(your home space)` — the home space resolves per caller, so the word was a character cost with no reader. The same edit deleted its FALSE `(your default)` (`workspace-arg.ts`): an agent inside a channel lands in the CHANNEL's container, which `instructions.ts` states correctly on the same connection. **The two characters are what the true version cost.** ⚠ **+21 (2026-09-17, R-32): the second addressing key — see `dopl_agent` above for the whole argument.** // ⚠ **2,816 → 2,809 (2026-09-11, −7): THE VOCABULARY RULING, BANKED NOT RAISED.** A cluster is an *ontology* to a reader and a column is an *object*, so three `.describe()` strings were respelled rather than added to: `cluster` → "Ontology slug, id, or exact name." (+1), `parent` lost the `column/object` pair for plain `object` (−7), `name` went `(cluster/column/object/action)` → `(ontology/object/item/action)` (−1). The OP NAMES did not move — `create_column` is still the op, and `parity.test.ts` still reads it. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.**
  dopl_search: 1065, // ⚠ **−2 (2026-09-18): BANKED, NOT SPENT.** The `container` arg's description dropped `your` from `(your home space)` — the home space resolves per caller, so the word was a character cost with no reader. The same edit deleted its FALSE `(your default)` (`workspace-arg.ts`): an agent inside a channel lands in the CHANNEL's container, which `instructions.ts` states correctly on the same connection. **The two characters are what the true version cost.** ⚠ **+21 (2026-09-17, R-32): the second addressing key — see `dopl_agent` above for the whole argument.** // ⚠ 1,080 → 1,076 (2026-09-06): measured after the doctrine move. // ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.**
  dopl_skill: 3047, // ⚠ **−2 (2026-09-18): BANKED, NOT SPENT.** The `container` arg's description dropped `your` from `(your home space)` — the home space resolves per caller, so the word was a character cost with no reader. The same edit deleted its FALSE `(your default)` (`workspace-arg.ts`): an agent inside a channel lands in the CHANNEL's container, which `instructions.ts` states correctly on the same connection. **The two characters are what the true version cost.** ⚠ **+21 (2026-09-17, R-32): the second addressing key — see `dopl_agent` above for the whole argument.** // ⚠ **−30 (2026-09-18): THE `workspace=` ALIAS KEY, RETIRED AND BANKED.** The deprecated spelling was published bare for ONE release so a caller that already knew it got its answer instead of a `-32602`; that release shipped, so the key is deleted and this ceiling falls by what it cost on THIS schema. ⚠ **RE-DERIVE, NEVER QUOTE.**
  // ⚠ THESE THREE EACH FELL BY 7 AND ROSE BY 1, BOTH EDITS IN OTHER FILES —
  // `response-size.ts › RESPONSE_FORMAT_FIELD` and `shelf.ts › SHELF_ARG_DESCRIPTION`.
  dopl_status: 787,
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
const SERVED_TOTAL_CEILING = 48_315; // ⚠ **48,791 → 48,585 (2026-09-18, −206): KNOWLEDGE PINNING DELETED, AND EVERY CHARACTER IS ACCOUNTED FOR.** −63 is `dopl_kb`'s description (its op bullet) and −143 is `dopl_kb`'s schema (two enum values plus the target rule on `base` and `path`); 63 + 143 = 206, and no other tool moved. See `DESCRIPTION_CEILINGS.dopl_kb`. ⚠ **THIS CEILING CANNOT SEE WHAT THE CHARACTERS BOUGHT, AND HERE THEY BOUGHT NOTHING — THEY WERE SPENT ON A CAPABILITY THAT NO LONGER EXISTS**, which is the one shape where a fall needs no argument beyond the ruling. Samuel is reimplementing pinning later; a reimplementation that has to buy its characters back is the intended outcome, and leaving the ceiling at 48,791 would have funded it in advance. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **RE-DERIVED WHOLE AT INTEGRATION (2026-09-18)** — the home-channel scope fence and the addressing structure both moved this ceiling in the same wave, so neither branch's figure is the merged truth and this one is a fresh sum through the real `listTools()`. ⚠ **48,834 → 48,826 (2026-09-18, −8): THE ADDRESSING STRUCTURE, BANKED.** The whole fall is `dopl_channel`'s schema — `kind` gained `"record"` and `to` gained the recipient LIST, both funded by no-fact-twice cuts inside the same shape; see `SCHEMA_CEILINGS.dopl_channel`. ⚠ **THE RULE WENT TO THE PULLED DOCTRINE** (+1,080 there), which is why this side moves DOWN in a wave that adds a capability. // ⚠ **48,639 → 48,834 (2026-09-17, +195): R-32's CONTAINER ADDRESS, AND THE WHOLE RISE IS THE DEPRECATED ALIAS KEY.** +189 is nine schemas × 21 (`SCHEMA_CEILINGS.dopl_agent` carries the argument), +8 is `dopl_map`'s description gaining the container nodes it now renders, −2 is `dopl_channel`'s relabel. ⚠ **THIS CEILING CANNOT SEE WHAT THE CHARACTERS BUY**, which is why the rise is recorded rather than absorbed: 195 chars per connection buys a container a FIRST-CLASS ADDRESS — `home` for the caller's own, a slug for a home channel — on every op that takes one, and buys one release in which no caller that still sends `workspace=` breaks. ⚠ **THE TRIM CAME FIRST AND IT IS WHY THE NUMBER IS 195 RATHER THAN ~640**: the alias is published UNDESCRIBED, `container`'s description is 9 chars under the one it replaced while naming one more address form, and the instructions fell 6 in the same change. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **48,611 → 48,639 (2026-09-15, +28): the whole rise is `dopl_channel`'s schema — see `SCHEMA_CEILINGS.dopl_channel`. ⚠ **THIS CEILING CANNOT SEE WHAT THE CHARACTERS BUY**, which is why the rise is recorded rather than absorbed: 28 chars per connection buys an orchestrator learning the tag its own agent actually answers to, and the alternative is a post addressed to the wrong agent with nothing to show for it. // ⚠ **48,615 → 48,611 (2026-09-15, −4): THE AGENT-ID-VISIBILITY WAVE, BANKED.** The whole fall is `dopl_channel`'s schema: `name` gained the LAUNCH clause and lost the false one (*"nothing resolves an agent by its name"*). See `SCHEMA_CEILINGS.dopl_channel`. ⚠ **A FALSE SENTENCE IS NOT A BUDGET SAVING TO BE SPENT** — it is why the true one fit. ⚠ **48,605 → 48,615 (2026-09-15, +10): `dopl_kb`'s `ambiguous_slug` row, three de-duplications inside that one description paying ~74 of its ~84. The whole rise is that tool's; see `DESCRIPTION_CEILINGS.dopl_kb` for what was cut, and for the two cuts two gates reverted. ⚠ **48,607 → 48,605 (2026-09-15, −2): the whole fall is `dopl_channel`'s topic→description relabel, banked here in the same change that measured it. ⚠ 48,370 → 48,607 (2026-09-13, +237): THE AGENT-COLOUR PARAM, AND THE WHOLE RISE IS ONE SCHEMA'S.** See `SCHEMA_CEILINGS.dopl_channel`, and `channel-schema.ts › SCHEMA_MAX_CHARS` for the funding and for the two cheaper shapes that were measured and refused. ⚠ **THIS CEILING CANNOT SEE WHAT THE CHARACTERS BUY**, which is why the rise is recorded rather than absorbed: 237 chars per connection buys a launch lane that can NAME a colour, and the alternative is sixteen agents a reader cannot tell apart in a transcript. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **−35 (2026-09-18): BANKED.** The per-tool rows above account for every character: −2 × 9 schemas for the `container` arg, −5 for the launch `template` describe, −12 for `dopl_channel`'s description. ⚠ **48,639 → 48,834 (2026-09-17, +195): R-32's CONTAINER ADDRESS, AND THE WHOLE RISE IS THE DEPRECATED ALIAS KEY.** +189 is nine schemas × 21 (`SCHEMA_CEILINGS.dopl_agent` carries the argument), +8 is `dopl_map`'s description gaining the container nodes it now renders, −2 is `dopl_channel`'s relabel. ⚠ **THIS CEILING CANNOT SEE WHAT THE CHARACTERS BUY**, which is why the rise is recorded rather than absorbed: 195 chars per connection buys a container a FIRST-CLASS ADDRESS — `home` for the caller's own, a slug for a home channel — on every op that takes one, and buys one release in which no caller that still sends `workspace=` breaks. ⚠ **THE TRIM CAME FIRST AND IT IS WHY THE NUMBER IS 195 RATHER THAN ~640**: the alias is published UNDESCRIBED, `container`'s description is 9 chars under the one it replaced while naming one more address form, and the instructions fell 6 in the same change. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **48,611 → 48,639 (2026-09-15, +28): the whole rise is `dopl_channel`'s schema — see `SCHEMA_CEILINGS.dopl_channel`. ⚠ **THIS CEILING CANNOT SEE WHAT THE CHARACTERS BUY**, which is why the rise is recorded rather than absorbed: 28 chars per connection buys an orchestrator learning the tag its own agent actually answers to, and the alternative is a post addressed to the wrong agent with nothing to show for it. // ⚠ **48,615 → 48,611 (2026-09-15, −4): THE AGENT-ID-VISIBILITY WAVE, BANKED.** The whole fall is `dopl_channel`'s schema: `name` gained the LAUNCH clause and lost the false one (*"nothing resolves an agent by its name"*). See `SCHEMA_CEILINGS.dopl_channel`. ⚠ **A FALSE SENTENCE IS NOT A BUDGET SAVING TO BE SPENT** — it is why the true one fit. ⚠ **48,605 → 48,615 (2026-09-15, +10): `dopl_kb`'s `ambiguous_slug` row, three de-duplications inside that one description paying ~74 of its ~84. The whole rise is that tool's; see `DESCRIPTION_CEILINGS.dopl_kb` for what was cut, and for the two cuts two gates reverted. ⚠ **48,607 → 48,605 (2026-09-15, −2): the whole fall is `dopl_channel`'s topic→description relabel, banked here in the same change that measured it. ⚠ 48,370 → 48,607 (2026-09-13, +237): THE AGENT-COLOUR PARAM, AND THE WHOLE RISE IS ONE SCHEMA'S.** See `SCHEMA_CEILINGS.dopl_channel`, and `channel-schema.ts › SCHEMA_MAX_CHARS` for the funding and for the two cheaper shapes that were measured and refused. ⚠ **THIS CEILING CANNOT SEE WHAT THE CHARACTERS BUY**, which is why the rise is recorded rather than absorbed: 237 chars per connection buys a launch lane that can NAME a colour, and the alternative is sixteen agents a reader cannot tell apart in a transcript. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.**
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
const INSTRUCTIONS_CEILING = 1_795; // ⚠ **1,801 → 1,795 (2026-09-17, −6): R-32, BANKED IN THE SAME CHANGE THAT MEASURED IT.** The targeting clause names the GRAMMAR (`container=<slug|id|home>`) instead of one spelling of it and lost 15 chars doing so; that paid for the two sentences that now NAME the home space — the membership line ("a call naming none lands in your home space") and the identity line ("calls land in `home`") — with 6 left over. ⚠ **THE POINT IS THAT `home` IS TAUGHT WHERE THE ADDRESS IS TAUGHT AND NOWHERE ELSE** (Samuel: *home must be structurally distinct, never just a prompt line*) — the resolver decides it; this briefing only names it. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **UNMOVED ON 2026-09-03, AND THAT IS THE ONLY WAY THE WAITING RULE GOT IN.** One sentence ("To WAIT, HOLD — … never poll on a timer") plus its blank line, 130 chars, paid for by trimming exactly that much out of the contract around it: the WHICH TOOL parenthetical, five glosses that restated their own tool descriptions, and the `workspace=` clause. ⚠ **THE TRIM CAME FIRST** — this briefing is the only surface reaching a client that has not pulled the doctrine, so the rule had to be in it, and a ceiling raised to fit a sentence is a ceiling that stops being one.

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
const DOCTRINE_CEILING = 12_712; // ⚠ **12,120 → 12,712 (2026-09-18, +592, third pass): `@desktop`, the external-session group tag — banked on the resource side. MODEL gains the three audiences and READ gains the outside-session read contract; the argument, including why the audience rule moved out of `send` (the SECTION ratchet, not a preference) and why +592 is RECORDED rather than funded, is at `channel-doctrine-budget.test.ts › DOCTRINE_MAX_CHARS`. ⚠ The PUSHED surface is untouched by this pass — `SERVED_TOTAL_CEILING` does not move. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **12,059 → 12,120 (2026-09-18, +61, second pass): the LAW's ADDRESSING A PERSON bullet, which had become false — banked on the resource side; the argument is at `channel-doctrine-budget.test.ts › DOCTRINE_MAX_CHARS`. // ⚠ **10,979 → 12,059 (2026-09-18, +1,080): THE ADDRESSING STRUCTURE — the two states, the REFUSAL between them, the recipient LIST across both namespaces, and the chooser — banked on the resource side. The accounting in full, including the deletion that paid part of it (the LAW no longer teaches an agent to address by a handle in its BODY, because that became false in the same change), is at `channel-doctrine-budget.test.ts › DOCTRINE_MAX_CHARS`. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **10,955 → 10,979 (2026-09-16, +24): the direct lane's refusal naming its own switch, banked on the resource side. The argument, including the two trims that paid it down from +134 and why `blocked` needs no "on a DIRECTION" qualifier, is at `channel-doctrine-budget.test.ts › DOCTRINE_MAX_CHARS`. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **10,807 → 10,955 (2026-09-15, +148): the launch-time name-uniqueness rule, banked on the resource side. The argument is at `channel-doctrine-budget.test.ts › DOCTRINE_MAX_CHARS`. // ⚠ **10,837 → 10,807 (2026-09-15, −30): THE AGENT-ID-VISIBILITY WAVE, BANKED ON THE RESOURCE SIDE.** The doctrine itself fell 30; the argument — a rule ADDED (address an agent by its NAME; never write an id in a message) against three claims DELETED because they were false — is at `channel-doctrine-budget.test.ts › DOCTRINE_MAX_CHARS`. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **9,979 → 10,837 (2026-09-13, +858): THE PULLED HALF OF THE AGENT-COLOUR WAVE.** 134 of it is prose MOVED off the pushed describes and the rest is the colour rule itself, in `FIELDS` — the section whose whole subject is an argument whose rule does not fit in a `.describe()`. The argument in full, including why `FIELDS` rather than `MANAGE` (the per-section ratchet chose it), is at `channel-doctrine-budget.test.ts › DOCTRINE_MAX_CHARS`. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.**

const WS: WorkspaceListItem = {
  id: "11111111-1111-1111-1111-111111111111",
  ownerId: "owner",
  name: "Alpha",
  slug: "alpha",
  publicId: "pub-1",
  description: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  role: "owner",
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
    getOntology: vi.fn().mockResolvedValue({ clusters: [], objects: {} }),
  } as unknown as DoplClient;
}

let client: Client;
let listed: Awaited<ReturnType<Client["listTools"]>>;
let descriptions: Map<string, number>;
let schemas: Map<string, number>;
let instructions: string;
/** Every published resource's body, by URI. Doctrine is the only one today. */
let doctrine: Map<string, number>;

beforeAll(async () => {
  const server = createServer(stubClient(), {
    directory: [WS],
    workspace: WS,
    role: "owner",
    workspaceSource: "sole membership",
    scopes: ["dopl.read", "dopl.write"],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "budget-probe", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  listed = await client.listTools();
  descriptions = new Map(listed.tools.map((t) => [t.name, (t.description ?? "").length]));
  schemas = new Map(listed.tools.map((t) => [t.name, JSON.stringify(t.inputSchema).length]));
  instructions = client.getInstructions() ?? "";
  const published = await client.listResources();
  doctrine = new Map(
    await Promise.all(
      published.resources.map(async ({ uri }): Promise<[string, number]> => {
        const read = await client.readResource({ uri });
        // ⚠ A resource may answer text OR a blob; only text costs an agent
        // tokens, and a blob must not be silently counted as zero either — the
        // doctrine is markdown and a blob here would be a different bug.
        const body = read.contents
          .map((c) => ("text" in c ? c.text : ""))
          .join("");
        return [uri, body.length];
      }),
    ),
  );
});

afterAll(async () => {
  await client?.close();
});

/** Every measured char an external client is pushed on connection. */
function servedTotal(): number {
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  return sum(descriptions) + sum(schemas) + instructions.length;
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
        identity: {
          userId: null,
          homeChannels: 0,
          boundChannelId: null,
          liveAgents: undefined,
          posture: null,
        },
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
    const total = [...doctrine.values()].reduce((a, b) => a + b, 0);
    expectRatchet(
      "the pulled doctrine",
      ratchet(new Map([["all resources", total]]), { "all resources": DOCTRINE_CEILING }),
      "a rise is only legitimate against a LARGER fall in the pushed surface — record the trade here or it is prose laundering",
    );
  });
});
