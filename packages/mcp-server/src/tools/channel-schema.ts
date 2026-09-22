/**
 * THE PUBLISHED INPUT SHAPE for `dopl_channel` — one flat schema of optional params, plus the
 * `op` discriminator and the `action` sub-verb the two dispatching ops take, with the per-op
 * requirements enforced at runtime by `missingParams` in the registrar.
 *
 * This is the DECLARED SURFACE an MCP client introspects (names, types, caps, per-param
 * teaching); the registrar is routing. ⚠ The parity suite reads both: every declared param must
 * be referenced by some handler in the `channel-*` group, and no handler may read an arg not
 * declared here.
 *
 * ⚠ **FIVE OPS SINCE 2026-09-02 (MCP v2 wave B slice B8, Samuel's ruling B9), AND FIVE AT RUNTIME
 * TOO SINCE SLICE B16.** `send` · `read` · `status` · `manage` · `rooms`, down from twenty-three.
 * The other twenty-two names parsed for one release and answered a one-line redirect; that window
 * is CLOSED, so the runtime enum and the published one are the same five and a retired name is
 * refused by schema validation with {@link unknownOpRefusal}'s line. The names are kept as dead
 * vocabulary in `law-removed-vocabulary.ts › RETIRED_CHANNEL_OPS`, which is what stops a shipped
 * string teaching one.
 *
 * ⚠ **EVERY `.describe()` HERE IS PUSHED ON EVERY CONNECTION, EXACTLY LIKE THE TOOL DESCRIPTION,
 * AND IS BUDGETED LIKE ONE** (A6, 2026-09-02). It was 20,844 characters over 46 blocks — 11.7×
 * the description the T82 cap governs — because each block carried the RULE behind its field as
 * well as its contract. A rule belongs in `channel-doctrine.ts`, which is PULLED by the agent
 * that asks for it; a `.describe()` carries the CONTRACT of one field and stops. One sentence
 * each, and `channel-schema-budget.test.ts` is what keeps it there.
 *
 * ⚠ **NO `.describe()` HAND-TYPES A BOUND THE SCHEMA PUBLISHES.** A cap reaches the client as a
 * `maxLength` / `maximum` keyword and once more in the description's rendered `Limits:` block
 * (`tool-style.ts › renderLimits`); a third copy in the prose is the copy that goes stale, and
 * `tool-style.test.ts` fails one.
 *
 * ⚠ Caps and minimums HAND-MIRROR the routes' zod schemas (src/features/channels/schema.ts): body
 * 16000, summary 200, client_msg_id 200, `.min(1)` on body / client_msg_id. Declared here they
 * publish as maxLength and are enforced before the call; omit one and the route rejects it as an
 * opaque 400 the write ops mis-narrate. `.trim()` where — and ONLY where — the route trims before
 * measuring, so the two agree on what a character count counts.
 *
 * ⚠ **`summary` IS ONE NUMBER NOW (200), AND THAT IS A RULING** (Samuel, wave B). It declared the
 * LOOSER 2000 so an over-length summary would be the route's to refuse with the field named; the
 * route enforces 200, so the schema published a cap the surface does not have. One field, one
 * bound, both ends.
 */

import { z } from "zod";
import { RESPONSE_FORMAT_FIELD } from "./response-size";
// ⚠ THE LAUNCH LANE'S FIELDS — their own module since 2026-09-14 (§1's cap).
import { LAUNCH_INPUT_FIELDS } from "./channel-schema-launch-fields";
// ⚠ THE ROOMS LANE'S FIELDS — their own module since 2026-09-18, same cap.
import { ROOMS_INPUT_FIELDS } from "./channel-schema-rooms-fields";
// ⚠ AND THE `kind="decision"` FIELDS SINCE 2026-09-18, on that file's precedent and for the
// same reason. Both are spread in their original positions, so nothing published moved.
import { DECISION_INPUT_FIELDS } from "./channel-schema-decision-fields";
import { HOLD_CAP_MS } from "./channel-hold-budget";

/**
 * ⚠ **THE OP / ACTION VOCABULARY AND ITS TWO REFUSALS MOVED TO `channel-vocab.ts`
 * (2026-09-14)** and are re-exported here unchanged, so **NO IMPORTER MOVED**. The seam is a
 * REASON TO CHANGE — a word in those lists moves when an OP does, this file when a PARAMETER
 * does — and what forced it was the 500-line cap (§1, the `size-check` CI job, F-689).
 */
// ⚠ IMPORTED **AND** RE-EXPORTED: the shape below spends three of these, and every
// existing importer reads them off this module.
import {
  CHANNEL_OPS,
  CHANNEL_ACTION_NAMES,
  unknownOpRefusal,
} from "./channel-vocab";
export {
  CHANNEL_OPS,
  CHANNEL_ACTIONS,
  CHANNEL_ACTION_NAMES,
  unknownOpRefusal,
  unknownActionRefusal,
} from "./channel-vocab";
export type {
  ChannelOp,
  ManageAction,
  RoomsAction,
  ArtifactAction,
} from "./channel-vocab";

/**
 * THE INPUT-SCHEMA BUDGET, and it is the same budget as the description's (A6, 2026-09-02). A
 * tool's `inputSchema` is PUSHED on every connection exactly as its description is, and
 * `dopl_channel`'s was **21,778 chars served — 11.7× the 1,775 the T82 cap governs** — because 46
 * `.describe()` blocks carried the RULE behind each field as well as its contract.
 *
 * ⚠ MEASURED AS **SERVED**, over a real `Client.listTools()`, and with the registrar-injected
 * `workspace` argument EXCLUDED: that one belongs to `registrar.ts › WORKSPACE_ARG_SHAPE` and is
 * a different slice's to shrink, so counting it here would let this ratchet move on somebody
 * else's edit. ⚠ IT ONLY EVER MOVES DOWN. `channel-schema-budget.test.ts` fails both ways —
 * growing past it, and shrinking below it without lowering the number. / // ⚠ 11,341 → 8,410 ON
 * 2026-09-02 (B8), AND EVERY CHARACTER OF IT CAME FROM // DELETING PARAMS AND OPS RATHER THAN
 * FROM SHORTENING PROSE. Thirteen params // left the shape — `topic`, `member`, `title`,
 * `handoff`, `agent_id`, // `ping_kind`, `recipient`, `metadata`, `goal`, `issue`, `context`, //
 * `timeout_ms`, and the three posture axes, which became one `posture` object — // because the
 * concept each named already had a field: a recipient is `to`, an // intent is `summary`, a goal
 * is `body`, a hold is `wait_ms`. Eighteen op names // left the published enum. A cut a re-worded
 * sentence cannot make twice.
 */
export const SCHEMA_MAX_CHARS = 9_001; // ⚠ **9,106 -> 9,001 (2026-09-22, −105): THE SANCTIONED MOVE, PERFORMED — AND IT IS A MOVE, NOT A TRIM.** 🔒 Samuel ruled the move on 2026-09-22 — *"fund it."* `kind`'s record CHOOSER (his ruling Q5, *"nobody need act or know now — in doubt, address someone"*) and `artifact`'s DEFINITION (*"An artifact folds messages into ONE named card"*) left the PUSHED `.describe()` text in `channel-schema.ts` for `channel-doctrine.ts › FIELDS`, which is PULLED. ⚠ **NOT ONE WORD AN AGENT READS WAS DELETED**: both phrases stand verbatim in their new home, and `channel-schema-budget.test.ts` now pins each one THERE and asserts neither has come back onto a describe — so the gates can tell this relocation apart from a trim. ⚠ **BOTH SURFACES, FRESHLY MEASURED, NEVER ARITHMETIC ON THE OLD NUMBERS.** PUSHED: `SCHEMA_MAX_CHARS` 9,106 → 9,001, `SCHEMA_CEILINGS.dopl_channel` 9,362 → 9,257, `SERVED_TOTAL_CEILING` 49,363 → 49,258 (−105 each). PULLED: `DOCTRINE_MAX_CHARS` 12,864 → 13,040 and `DOCTRINE_CEILING` 13,608 → 13,784 (+176 each), with the `fields` section 1,484 → 1,660 against a 3,600 cap. **The pulled rise is 71 larger than the pushed fall**, because a line in `FIELDS` must NAME the argument it is about where a `.describe()` got that free by sitting on one — 105 off EVERY connection against 176 on the caller that asks is the same trade the 2026-09-06, -13, -15 and -18 waves took. ⚠ **NO STALE SLACK WAS FOUND TO BANK**: all five constants measured EXACTLY equal to their ceilings before the move, so 2026-09-18's five-character drift has no successor here. ⚠ 🔴 **AND THE DEBT IS NOT FULLY REPAID — PLAINLY.** The merge note predicted ~8,645 and UNDER 8,653; the move measures 9,001, missing 8,653 by 348 and the pre-U9 baseline of 8,715 by 286. **It paid off the 2026-09-22 addressing ruling's +105 exactly and NONE of U9's +286.** The prediction was written before those two rises landed and was not wrong about the MOVE, only about the surface it would land on: U9's `runtime` field is still RECORDED rather than funded, and the next honest payment is owed there. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **9,001 -> 9,106 (2026-09-22, +105): THE ADDRESSING-IS-METADATA RULING, AND IT IS RECORDED RATHER THAN FUNDED — READ THE NEXT FOUR SENTENCES BEFORE ACCEPTING IT.** 🔒 Samuel, 2026-09-22: the recipient of a post is set ONLY by `to=`, and every surface RENDERS the recipient from that metadata — so an agent must not write a routing header (`FROM→TO | KIND |`), its own name, or the recipient's handle into `body`. ⚠ **WHAT A CALLER CANNOT DERIVE IS THE WHOLE COST**: nothing validates a body's first line and nothing should, so the envelope habit POSTS PERFECTLY and no result, refusal or read ever corrects it — a rule with no enforcement surface exists only in prose, which is what this budget buys. ⚠ **THE SPLIT IS THIS GATE'S OWN INSTRUCTION FOLLOWED, NOT WORKED AROUND**: the RULE and its reason are in `channel-doctrine.ts › MODEL` (PULLED, +273 — its subject is literally who a message is for), and the PUSHED half is ONE clause on `body`'s describe (+105), the surface an agent is looking at while it writes one. ⚠ **AND THE LAW PAID FOR ITSELF**: its blocked-and-need-a-person bullet now says the address IS `to=` and the room renders it, and came out 6 chars SHORTER than the tag-them-in-the-body sentence it replaced. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **8,715 -> 9,001 (2026-09-21, +286): THE MCP LAUNCH RUNTIME FIELD (U9), AND IT IS RECORDED RATHER THAN FUNDED — READ THE NEXT FOUR SENTENCES BEFORE ACCEPTING IT.** 🔒 The defect it closes, verbatim from `docs/plans/2026-09-21-001-fix-codex-runtime-parity-plan.md`: *a live MCP launch carrying `model: "codex"` was accepted but started a Claude Sonnet agent, because the MCP contract has no runtime field and an unknown model falls through to the default adapter.* ⚠ **WHAT A CALLER CANNOT DERIVE IS THE WHOLE COST**: that `runtime` and `model` are TWO fields and neither selects the other, and that an unavailable runtime is REFUSED rather than swapped — which is the OPPOSITE of `model`'s own silent-fallback rule one field up, so an agent generalising from its neighbour would plan for the wrong outcome. ⚠ **THE TRIM CAME FIRST AND THE STANDING RULE WAS MOVED, WHICH IS THIS GATE'S OWN INSTRUCTION**: the full asymmetry lives in `channel-doctrine.ts > MANAGE` (PULLED), and the pushed describe was cut to one clause per fact — what it is, what it is not, what omitting means, what an unavailable one does. ⚠ **AND TWO CHEAPER SHAPES WERE REFUSED.** (a) A `z.enum(["claude","codex","cursor"])` is not cheaper AND is wrong: the roster is the operator's DESKTOP REGISTRY and moves with a desktop release, so the enum would refuse a runtime a newer machine already ships. (b) Overloading `model` IS the defect. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **8,653 → 8,708 (2026-09-19, +55): RECORDED AT THE MERGE, NOT FUNDED — AND THIS CONSTANT'S OWN GATE SAYS "DO NOT RAISE THE NUMBER", SO READ THE NEXT THREE SENTENCES BEFORE ACCEPTING IT.** Two branches of one wave each ADDED to this shape and each FUNDED its addition out of the same slack, so the funding netted once and the spend netted twice. The contributors, largest first: batch D's `kind` record CHOOSER (Samuel's ruling Q5, *"record = nobody needs to act or know now; if in doubt, address someone"*), batch D's `artifact` DEFINITION (+28 measured, *"An artifact folds messages into ONE named card"*), batch B's `body` launch cap `(launch: <=2000)` (+17), and ~21 for the merged `to`, which carries batch D's three-line layout AND batch B's per-op handle scoping because both are true and neither is derivable from the other. ⚠ **THE TRIM CAME FIRST AND IT WAS NOT ENOUGH**: the merged `to` was written at 308 and cut to 280 (batch B shipped 259, batch D 256), which is 28 of the 90 this started at. ⚠ **AND IT COULD NOT GO LOWER**: `channel-ops-agent-target.test.ts` pins this describe in BOTH directions by phrase — `` `@agent-<id>` ONLY `` for the manage half and `agent handle` for the send half — so two shorter spellings were written, failed that pin, and were reverted. 🔴 **THE SANCTIONED FIX IS A MOVE, NOT A RAISE, AND IT IS OWED.** `kind`'s chooser and `artifact`'s definition are standing RULES, which is exactly what `channel-doctrine.ts › FIELDS` is for and what this gate's own message asks for; moving both measures ~8,645 and puts this back UNDER 8,653 without deleting a word an agent reads. It was NOT done at the merge because moving Samuel-ruled prose between the PUSHED and PULLED surfaces changes what every connection is handed and what several suites pin BY PHRASE — a product decision, not a conflict resolution. **Samuel rules on the move; until he does, the cost is visible here rather than hidden.** ⚠ **NEVER QUOTE THIS NUMBER — re-derive it** with `channel-schema-budget.test.ts`. // ⚠ **8,648 → 8,646 (2026-09-18, −2): THE R1 CONSISTENCY WAVE, AND IT IS A NET FALL OVER FOUR ADDITIONS.** Three describes gained a fact an agent could not derive — `to` states its THREE meanings as three lines instead of one run-on (S13), `kind` carries Samuel's record CHOOSER (*"record = nobody needs to act or know now; if in doubt, address someone"*, ruling Q5), and `artifact` finally says WHAT an artifact IS in one clause (S16) — and all of it was FUNDED inside this same shape rather than recorded. ⚠ **WHAT PAID FOR IT IS THIS FILE'S OWN TWO RULES, APPLIED FOUR MORE TIMES**: `recommendation` lost *"but almost always right"* (editorial, not contract), `options` lost the hand-typed `2-6` and `to` lost a sentence the three lines under it demonstrate (a BOUND the schema publishes as `minItems`/`maxItems`, which is the rule the header states), and `artifact` lost *"exactly"*. ⚠ **THE TRIM CAME FIRST AND THE NUMBER WENT DOWN, WHICH IS THE ONLY SHAPE THIS CONSTANT ACCEPTS.** ⚠ **NEVER QUOTE THIS NUMBER — re-derive it** with `channel-schema-budget.test.ts`. // ⚠ **8,628 → 8,654 (2026-09-15, +28): THE LAUNCH-TIME NAME-UNIQUENESS RULE (Samuel, 2026-09-15), AND IT IS A RISE ON A DOCUMENT THAT FELL EARLIER THE SAME DAY.** *"I think we should enforce a rule where no two agents that are addressable can have the same name … it will automatically auto-resolve to coder-1 … coder-2 and so on and so forth."* ⚠ **WHAT A CALLER CANNOT DERIVE IS THE PART THAT COSTS**: that the name it ASKED for may not be the name it GOT, and that the result's `name=` is therefore the tag to use. An orchestrator that assumed its own argument came back would tag `@coder` and reach the OTHER agent — a silent mis-delivery, which is the class this whole surface's prose budget exists to buy out of. ⚠ **THE RULE ITSELF IS IN THE PULLED DOCTRINE AND THE CONTRACT IS IN THE DESCRIBE**, which is this gate's own instruction followed rather than worked around: `FIELDS` carries why names are unique and what `-1` means; the pushed `name` describe carries only *a launch answers the name it GOT, so read its `name=`*. ⚠ **AND THE DAY IS NET-DOWN AGAINST WHERE IT STARTED**: the morning's id-visibility wave deleted three FALSE clauses from this same surface, which is what left the room for this one. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **8,632 → 8,628 (2026-09-15, −4): THE AGENT-ID-VISIBILITY WAVE.** `name` gained the op="manage" action="launch" clause — an agent that launches an agent NAMES it (Samuel's ruling) — and lost `@agent-<id>` stays the only address, nothing resolves an agent by its name, and the label reaches no server`, which had been PUSHED to every client on every connection since 2026-09-06 and had been false since 2026-08-28: the name door resolves in all three trees (`main/agent-handles.js`, `lib/agent-mentions.ts`, `server/service-wake-verdict-handles.ts`), and `channel_sessions.display_name` has carried the name to the server and to peers since `20260905120000`. ⚠ **DELETING A FALSE SENTENCE IS NOT A SAVING TO SPEND ELSEWHERE — it is the reason the true one fits**, and the net is DOWN, which is the only direction this constant takes without an argument. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it.** // ⚠ **8,634 → 8,632 (2026-09-15, −2): THE TOPIC→DESCRIPTION RELABEL PAID FOR ITSELF.** `summary`'s "it is the channel topic" became "it is the description" — the clause is already scoped to action="open", so "channel" was a word the sentence's own subject already carried. Down-only, and lowered in the same change that measured it. // ⚠ **8,405 → 8,634 (2026-09-13, +229): THE AGENT-COLOUR PARAM, AND THE FIRST RISE THIS CONSTANT HAS TAKEN.** `op="manage" action="launch"` gained `color`, which costs 363 served — 233 of it the sixteen `enum` members. **134 was funded rather than recorded**, all of it standing contract prose MOVED into the PULLED doctrine and WRITTEN there first on `template`'s precedent: `model`'s silent-fallback sentence (101) to `MANAGE`, `info_card`'s "everyone sees it" (33) to `ROOMS`. ⚠ **TWO CHEAPER SHAPES WERE MEASURED AND REFUSED, WHICH IS THE PART THAT LICENSES THE OTHER 229.** (a) `z.string().regex(/^agent-(0[1-9]|1[0-6])$/)` measures 80 against the enum's 233 — refused by `tool-style.test.ts › no published schema validates a date with a regex`, because a character class is a contract the agent must reverse-engineer and its failure is an opaque -32602 where an enum's NAMES THE SIXTEEN. (b) `posture`'s clamp sentence (135) was moved to the doctrine and PUT BACK: `channel-ops-agent-mode.test.ts` and `channel-session-handle.test.ts` pin it on that describe by phrase. ⚠ **AND WHY THE REMAINDER IS RECORDED RATHER THAN ABSORBED**, on `tool-budget.test.ts › SCHEMA_CEILINGS.dopl_agent`'s +1,093 precedent: this gate counts what a connection costs BEFORE it has done anything, and every describe still standing is at its smallest honest size — buying 229 more would mean deleting a disclosure, which is paying a budget by telling the truth less. ⚠ **NEVER QUOTE THIS NUMBER — re-derive it** with `channel-schema-budget.test.ts`. // ⚠ 8,410 → 8,405 ON 2026-09-03: `section=`'s enum gained `waiting` (the hold-not-poll doctrine is unreachable without a name to pull it by) and that field's own `.describe()` more than paid for it. It still only ever moves DOWN. // ⚠ **8,648 → 8,653 (2026-09-18, +5 ON THE CONSTANT, +10 ON THE MEASUREMENT): THE LAUNCH GOAL'S CAP, PUBLISHED — AND 5 CHARS OF STALE SLACK BANKED IN THE SAME CHANGE (S50/S51).** ⚠ **THE CONSTANT AND THE MEASUREMENT HAD DRIFTED APART**: the served shape measured 8,643 against a ceiling of 8,648, i.e. five characters somebody's trim had won and nobody had banked — exactly what this ratchet's own down-arm exists to catch, and it does not, because its slack window is 500. **So this number is a FRESH MEASUREMENT, not arithmetic on the old one**, and the five are gone for good. ⚠ **THE +10 IS TWO EDITS, AND ONE OF THEM PAYS FOR PART OF THE OTHER.** `body` gained `(launch: <=2000)` (+17): the schema publishes `.max(16000)`, which is `op="send"`'s and is right, while `schema-launch.ts › LaunchCreateSchema.goal` enforces 2000 — an 8× gap with NO pre-flight, so an over-long launch goal came back as a bare `VALIDATION_FAILED: Request body failed validation` naming no field at all. ⚠ **IT IS NOT THE HAND-TYPED-BOUND ANTI-PATTERN** `tool-style.test.ts` forbids: that rule is about restating a bound the JSON Schema ALREADY publishes, and this field serves three routes with three caps (16000 / 4000 / 2000), of which the schema can publish exactly one. The other two are per-call text in `channel-errors.ts › FIELD_CAPS_NOTE`, which is governed by `write-result-budget.test.ts` and costs nothing on connection. ⚠ `to` FUNDED −7 BY LOSING A PROMISE THAT WAS HALF FALSE: *"an agent (`@agent-<id>` or its handle)"* sat in the HEADLINE, over every op. It is true on `op="send"` (the server's union resolver takes a name) and false on `op="manage"`, where nothing resolves a name to an instance id — `bareAgentId` stripped the `@` and the value died against an anchored eight-character grammar. The forms moved DOWN into the per-op clauses, which is where they differ, and the headline's type list is DELETED rather than reworded. **A half-false sentence deleted is not a saving to spend elsewhere; it is why the true one fits.** ⚠ **NEVER QUOTE THIS NUMBER — re-derive it** with `channel-schema-budget.test.ts`.

/**
 * ⚠ THE PER-FIELD HALF, AND IT IS THE ONE THAT ACTUALLY HOLDS THE LINE. A total can absorb one
 * 900-character paragraph by trimming nine short fields; this cannot. A `.describe()` states the
 * CONTRACT of one field — which ops take it, what it is, its bound — in one sentence. The rule
 * behind it belongs in `channel-doctrine.ts › FIELDS`, which is PULLED by the agent that asks.
 */
export const PARAM_DESCRIPTION_MAX_CHARS = 400;

export const CHANNEL_INPUT_SHAPE = {
  // ⚠ ONE FIELD, TWO READ OPS ("read" and "status"), and its wording is `response-size.ts`'s
  // so the five tools that take this knob cannot promise five different things about what
  // `concise` drops. It is INERT on every other op rather than refused: a knob that 400s where
  // it is meaningless teaches an agent to stop passing it where it is not.
  response_format: RESPONSE_FORMAT_FIELD,

  // ⚠ **ONE ENUM NOW — THE RUNTIME SET AND THE PUBLISHED SET ARE THE SAME FIVE**
  // (slice B16). They were deliberately different for one release: the twenty-two
  // retired names had to PARSE so their redirect could run, and had to be absent
  // from the JSON Schema so no model could see one. Both halves retire together —
  // a hidden name that no longer answers anything is a name that only ever
  // produces a confusing success. What replaces the redirect is the REFUSAL:
  // zod's own error carries {@link unknownOpRefusal}, so a caller pinned to an
  // older desktop still reads one line naming the five instead of an opaque
  // `-32602 invalid enum value`.
  op: z
    .enum(CHANNEL_OPS, { error: (issue) => unknownOpRefusal(issue.input) })
    .describe("Operation to perform."),

  // ⚠ ONE SUB-VERB PARAM FOR BOTH DISPATCHERS, not two. The vocabularies are disjoint, so one
  // field can never be ambiguous — and two spellings for "which act" is how a caller guesses.
  action: z
    .enum(CHANNEL_ACTION_NAMES)
    .optional()
    .describe(
      'op="manage" (required): "launch", "end", "rename", "posture" or "direct" — all on YOUR OWN operator\'s machine. op="rooms" (required): "list", "open", "invite", "members", "threads", "thread_mode", "update" or "help". op="artifact" (required): "create", "add", "remove" or "dissolve".',
    ),

  channel: z
    .string()
    .optional()
    .describe(
      // ⚠ THE WIDER-READ RULE IS THE DOCTRINE'S (`FIELDS › OMITTING \`channel\`
      // IS A WIDER READ`), which states the scope this sentence used to repeat —
      // every channel you are in, across every workspace and home container.
      // What stays is the CONTRACT: which calls require it, and what omitting it
      // does. `channel-schema-budget.test.ts` pins the doctrine line, so the fact
      // is relocated rather than dropped.
      'Channel slug or id. Required except on op="rooms" action="list" / "open" / "help"; omitting it WIDENS op="read" and op="status".',
    ),

  // ⚠ **ONE RECIPIENT PARAM FOR THE WHOLE SURFACE** (B8). It replaced `to`, `member`,
  // `recipient` and `agent_id` — four spellings of "the party this call is about", each with
  // its own resolution story. The server resolves the union at the door
  // (`service-writes-metadata-recipient.ts › resolveToRecipients`), and an `@name` that
  // resolves to NOBODY is a 400 listing the live handles, never a silent `delivery=none`.
  // ⚠ **ON `op="send"` IT IS A COMMA-SEPARATED LIST SINCE 2026-09-18** (Samuel's
  // multi-recipient ruling), inside the SAME string field: a `string | string[]` union
  // publishes as `anyOf` on a schema every client introspects, and a single-string `to` had to
  // keep working byte-for-byte.
  to: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      // ⚠ "which triggers their side" IS THE LAW'S SENTENCE, not this field's. The per-op
      // meanings stay, because they are what a caller cannot derive from the type.
      // ⚠ **THREE MEANINGS, THREE LINES (S13), AND THE HANDLE PROMISE SCOPED TO THE OP
      // THAT KEEPS IT (S51).** Both halves were written on separate branches of this wave
      // and are one string here (merge, 2026-09-19). The run-on said `an agent
      // (@agent-<id> or its handle)` over the WHOLE field: true on op="send", where the
      // server's union resolver takes a name, and FALSE on op="manage", where nothing
      // resolves a name to an instance id and the value dies against an anchored
      // eight-character grammar. So the forms live on the per-op lines, which is where
      // they differ, and `channel-agent-target.ts` refuses by name what this no longer
      // promises.
      'WHO this call is about.\nop="send": who it is FOR — a member (email or user id), `@agent-<id>` or an agent handle; SEVERAL, comma-separated, mixed.\nop="manage": which ONE of YOUR OWN agents — `@agent-<id>` ONLY, no handle.\nop="rooms": the member to "invite", or open a 1:1 with.',
    ),

  body: z
    .string()
    .min(1)
    .max(16000)
    .optional()
    .describe(
      // ⚠ WHAT `body` MEANS PER `kind` IS THE DOCTRINE'S `send` SECTION, which
      // states both in full ("kind=\"milestone\": ONE line marking a step…",
      // "kind=\"decision\": … `body` what they need to know"). A field's describe
      // carries which ops take it and what it is; the per-kind shape is the op's
      // contract and is pulled with the op.
      // ⚠ **THE LAUNCH CAP IS PUBLISHED HERE BECAUSE THE SCHEMA CANNOT PUBLISH IT** (S50,
      // 2026-09-18). `.max(16000)` above is `op="send"`'s and is CORRECT; the launch route
      // enforces 2000 (`schema-launch.ts › LaunchCreateSchema.goal`), so the published bound
      // and the enforced one disagreed by 8× with nothing in between — an over-long goal came
      // back as a bare `VALIDATION_FAILED`. ⚠ THIS IS NOT THE HAND-TYPED-BOUND ANTI-PATTERN
      // (`tool-style.test.ts`): that rule forbids restating a bound the JSON Schema ALREADY
      // publishes, and 2000 is one it cannot — this field serves three routes with three caps.
      // ⚠ 17 CHARS, WHICH IS THE SMALLEST TRUE FORM; the other two caps are per-call text
      // (`channel-errors.ts › FIELD_CAPS_NOTE`) and are not pushed.
      // 🔒 **THE RECIPIENT CLAUSE IS PUSHED, AND IT IS THE ONE THING THIS FIELD CANNOT LEAVE
      // TO THE PULLED DOCTRINE (Samuel's ruling, 2026-09-22: the recipient is set ONLY by
      // `to=`, and the surface renders the tag from that metadata).** An agent writing a
      // BODY is looking at THIS describe; the routing header it would otherwise type
      // (`FROM→TO | KIND |`) is a habit no result and no refusal corrects, because a body
      // with an envelope in it posts perfectly. The rule behind it — why the envelope is
      // chrome the reader sees twice — is `channel-doctrine.ts › MODEL`, PULLED.
      // ⚠ **IT IS GUIDANCE, NOT A FENCE**: nothing validates a body's first line, and
      // nothing here should. Writing one is a style refusal, not a `-32602`.
      'op="send" (required): the message text. ⚠ The recipient is `to=` and is rendered from it — never write a routing header or a name into the body. op="manage" (required on "launch" and "direct"): the agent\'s opening instruction (launch: <=2000), or the private message.',
    ),

  // ⚠ FOUR VALUES, EACH WITH A FENCE (spec §2.1). `milestone` stores `task_progress` and
  // keeps G14's one-line cap; `decision` stores `message` plus the validated escalation
  // payload, and it MUST stay `message` or `targeting.js › classify` drops the card and the
  // human it asks is never notified. ⚠ `question` / `blocked` / `done` are NOT adopted: a
  // value with no distinct behaviour is prose wearing a schema.
  //
  // ⚠ **`record` IS THE FOURTH (2026-09-18, Samuel's ruling), AND IT IS AN EXISTING
  // CONCEPT GIVEN A NAME RATHER THAN A NEW STORED SHAPE.** It sends `intent:"chat"` —
  // the route's own *"it STATES that this post is not work for anybody"* — on an ordinary
  // `message` row, so no migration and no renderer arm is involved. What it buys is the
  // SECOND HALF of the addressing structure: with a record available, a send that names
  // nobody can be REFUSED instead of guessed at. ⚠ NOT `milestone`, which is a thread
  // marker capped at one line and required to carry a `thread`.
  kind: z
    .enum(["message", "milestone", "decision", "record"])
    .optional()
    .describe(
      // ⚠ WHICH FIELDS A DECISION NEEDS IS SAID BY THOSE FIELDS AND BY THE DOCTRINE, not a
      // third time here. This one keeps what the VALUES mean, the enum's own contract.
      // ⚠ **THE CHOOSER MOVED TO `channel-doctrine.ts › FIELDS` ON 2026-09-22 (Samuel: "fund
      // it"), AND NOT ONE WORD OF IT WAS DELETED.** *"nobody need act or know now — in doubt,
      // address someone"* is Samuel's ruling Q5 and is a standing RULE — WHEN to pick a value,
      // which is not this enum's contract — so it is PULLED now rather than pushed to every
      // client on every connection. What stays is what the VALUES are, and `"record" takes no
      // `to`` stays because it is the one arm whose ARGUMENT SHAPE differs.
      'op="send" (optional, default "message"): "record" takes no `to`; "milestone" marks a step on a thread; "decision" is a card answered in one press.',
    ),

  thread: z
    .string()
    .optional()
    .describe(
      // ⚠ THE LEGACY `task-<channel>-<seq>` LABEL IS STILL ACCEPTED — the doctrine's
      // `send` section is where it is explained now, with the consequence this
      // sentence never carried (no thread row behind it, so a send onto one
      // reports `landed=adhoc`). ⚠ "its metadata header plus only that exchange"
      // is PINNED by `channel-law.test.ts` against ARG_PROSE; it stays verbatim.
      'A thread id. ⚠ "new" on op="send" OPENS one and returns its id, with `summary` as its title. Required on op="send" kind="milestone" and on op="rooms" action="thread_mode"; on op="read" it narrows to its metadata header plus only that exchange.',
    ),

  summary: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe(
      // ⚠ THE THREAD-TITLE CLAUSE CAME OFF UNDER THIS FILE'S OWN NO-FACT-TWICE
      // RULE, the one the `name` field applied in 2026-09-06: `thread`'s describe
      // already says thread="new" opens one "with `summary` as its title", and
      // both strings are pushed on the same connection. The other three meanings
      // have no second home and stay.
      // ⚠ **"TOPIC" → "DESCRIPTION" (ruling, Samuel, 2026-09-15)** — one word for
      // one thing, on both popups and both Info cards. **WIRE AND COLUMN STAY
      // `topic`**; a LABEL. −2 not +6: the clause is already scoped to open.
      'The one-line intent. ALWAYS set it on op="send" — it becomes the notification the receiving member sees; on kind="decision" it is the QUESTION the card asks, on op="rooms" action="open" it is the description, and on op="artifact" it is what the folded run was about.',
    ),

  // ⚠ ONE SENTENCE, BECAUSE THERE IS NOW ONE RULE (2026-09-02, C14). Both routes dedupe
  // PER-AUTHOR: `channel_messages` on `(channel_id, client_msg_id, author_user_id)` and
  // `channel_tasks` on `(channel_id, client_msg_id, created_by)`. Until the second landed this
  // description had to teach the WEAKER of two keys — a documented way to be silently
  // redirected into somebody else's exchange.
  client_msg_id: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      // ⚠ THE COST OF RETRYING WITHOUT ONE IS STATED WHERE IT BITES: the doctrine's
      // `manage` section ("re-issuing without the SAME `client_msg_id` starts a
      // SECOND agent" — pinned by four suites) and its `fields` section
      // ("`client_msg_id` IS WHAT MAKES A RETRY SAFE", pinned by
      // `channel-schema-budget.test.ts`). ⚠ PER-AUTHOR and both op names are
      // PINNED here by `channel-schema-caps.test.ts` and stay verbatim.
      'op="send" / op="manage" / op="artifact" (optional): an idempotency key; a re-sent key hands back YOUR first call\'s result instead of acting twice. The dedupe is PER-AUTHOR on every op.',
    ),

  // ── kind="decision" ──────────────────────────────────────────────────────
  // ⚠ **`options` AND `recommendation` MOVED TO `channel-schema-decision-fields.ts`
  // (2026-09-18)** and are spread here IN THEIR ORIGINAL POSITION, so the published schema is
  // unchanged to the byte. What forced it is this file passing the 500-line cap again (§1,
  // `size-check`) — the same move, for the same reason, that `LAUNCH_INPUT_FIELDS` made below.
  ...DECISION_INPUT_FIELDS,

  // ── op="artifact" ────────────────────────────────────────────────────────
  // ⚠ TWO FIELDS FOR FOUR ACTIONS, and the name+summary+key they also need are
  // the ones this surface already has. An artifact is named like a room, summed
  // up like a thread and retried like a send; three more params would have been
  // three more spellings for fields already declared above.
  // ⚠ **NO `.uuid()`, AND THE REASON IS A PUBLISHED-SCHEMA RULE RATHER THAN A
  // LOOSER CONTRACT** (2026-09-06). Zod 4 renders `.uuid()` as BOTH `format` and
  // a `pattern` keyword, and `tool-style.test.ts › the reference's anti-patterns`
  // refuses ANY `pattern` on a published property: a regex is a rule the agent has
  // to reverse-engineer from a character class, and breaking it costs an opaque
  // -32602 instead of a sentence naming the argument. The remedy is the one that
  // test names — say the shape in the describe and let the handler answer with a
  // code — and the describe below does exactly that by pointing at where the id
  // comes from, which is more useful to a caller than the alphabet it is drawn
  // from. A malformed id now reaches `channel-ops-artifact.ts` and is refused
  // there by name.
  // ⚠ IT IS THE ONLY PROPERTY ON THIS SURFACE THAT PUBLISHED ONE: the other
  // `.uuid()` uses sit inside ARRAY ITEMS, where the keyword lands on the item
  // schema rather than on the property, which is why nothing caught them and why
  // this is not a licence to add one there.
  artifact: z
    .string()
    .optional()
    .describe(
      // ⚠ **THE DEFINITION MOVED TO `channel-doctrine.ts › FIELDS` ON 2026-09-22 (Samuel:
      // "fund it"), AND NOT ONE WORD OF IT WAS DELETED.** *"An artifact folds messages into
      // ONE named card"* says what the NOUN is — a standing rule about the concept, true
      // before any call and unchanged by every one — where a describe carries what the
      // ARGUMENT is. It is PULLED now; `channel-schema-budget.test.ts` pins it there.
      'op="artifact" (required on "add", "remove", "dissolve"): its id, as action="create" returned it.',
    ),

  // ⚠ **ONE PARAM, AND THE "EXACTLY ONE" RULE IS A SEAM CHECK RATHER THAN A
  // SECOND FIELD** (`channel-ops-artifact.ts › oneMessage`). A singular
  // `message` beside this would be the same field with a different bound, which
  // is how a caller learns to guess which spelling an action wants — the same
  // argument that made `to` one param for four namespaces.
  // ⚠ MESSAGES ARE NAMED BY `seq`, not by id: `seq` is what a read PRINTS and
  // what a citation quotes, so resolving ids first would be a second addressing
  // scheme for the same rows. Cap hand-mirrors
  // `src/features/channels/schema-artifacts.ts › ARTIFACT_CREATE_MAX_MESSAGES`.
  messages: z
    .array(z.coerce.number().int().positive())
    .min(1)
    .max(200)
    .optional()
    .describe(
      // ⚠ **THE LAST 11, TAKEN AS FILLER RATHER THAN AS A FACT** (budget wave
      // fix-up): "this call is about" said nothing the clause after the dash does
      // not say precisely — the whole set on one action, exactly one on the other
      // two. Every fact, every quoted action and the `seq` addressing rule are
      // untouched, and the handler states the same bound at the point of refusal
      // (`channel-ops-artifact.ts › oneMessage`). Nothing greps this string.
      'op="artifact" (required on "create", "add" and "remove"): the message `seq`s — the whole set on "create", exactly ONE on "add" and "remove".',
    ),

  // ── op="read" ────────────────────────────────────────────────────────────
  // ⚠ coerce: MCP clients send numbers as strings, and strict z.number() 400s an opaque -32602.
  since: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      // ⚠ THE TABLE-WIDE CLAUSE IS THE DOCTRINE'S `fields` LINE ("ONE CURSOR
      // SPACE, ONE `since` — `seq` is table-wide, so one cursor covers every
      // channel"), which `channel-schema-budget.test.ts` pins. ⚠ BOTH HALVES OF
      // THE JOIN STAY VERBATIM: "THREAD-SCOPED read" and "hands back none" are
      // pinned twice over, by `channel-schema-caps.test.ts` AND
      // `channel-thread-scope.test.ts`, which reads them against the result line.
      'op="read" (optional, and REQUIRED with `wait_ms`): the last MESSAGE seq you have processed; only higher ones come back. A THREAD-SCOPED read hands back none.',
    ),

  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe(
      // ⚠ **THE TAIL CAME OFF 2026-09-18 UNDER THIS FILE'S OWN NO-FACT-TWICE RULE**, to
      // fund `kind="record"`. The doctrine's `read` section carries the whole sentence
      // verbatim and is PULLED, where this is pushed on every connection.
      'op="read" (optional): max messages to return — with no `since` that is the NEWEST page.',
    ),

  // ⚠ **ONE HOLD PARAM, TWO LANES, AND THEY ARE THE SAME QUESTION.** `wait_ms` asked the
  // operator's desktop to answer a directive; `timeout_ms` asked the server to hold for a
  // message. Both are "how long may this call take before it comes back with nothing", both
  // cap server-side, and two names for one knob is how a caller learns to guess. ⚠ The
  // published cap is the HOLD's (`HOLD_CAP_MS`); the directive lane clamps to its own
  // (`channel-ops-launch.ts › WAIT_CAP_MS`).
  wait_ms: z.coerce
    .number()
    .int()
    .min(0)
    .max(HOLD_CAP_MS)
    .optional()
    .describe(
      // ⚠ THE TIMEOUT RULE IS THE DOCTRINE'S, AND IN ITS STRONGER FORM: "A
      // TIMEOUT IS NOT A FAILURE: the request stays PENDING, and re-issuing
      // without the SAME `client_msg_id` starts a SECOND agent" — one sentence
      // carrying the consequence this copy left out, and pinned verbatim by
      // `channel-directions`, `channel-ops-agent-mode` and
      // `channel-ops-agent-doctrine`. Deleting the weaker copy loses nothing.
      'Optional HOLD. op="read": long-poll for messages after `since` instead of returning a page. op="manage": how long to hold for your operator\'s desktop to answer.',
    ),

  // ── op="rooms" ───────────────────────────────────────────────────────────
  // ⚠ **THE ROOMS LANE'S FIELDS MOVED TO `channel-schema-rooms-fields.ts` (2026-09-18)**
  // and are spread here IN THEIR ORIGINAL POSITION, so the published schema is unchanged.
  // What forced it was this file sitting AT the 500-line cap (§1, `size-check`, F-689) —
  // the same seam, and the same reason, as the launch lane's below.
  ...ROOMS_INPUT_FIELDS,

  // ⚠ **THE LAUNCH LANE'S FIELDS MOVED TO `channel-schema-launch-fields.ts` (2026-09-14)**
  // and are spread here IN THEIR ORIGINAL POSITION, so the published schema is unchanged.
  // What forced it was this file passing the 500-line cap (§1, `size-check`, F-689).
  ...LAUNCH_INPUT_FIELDS,
};
