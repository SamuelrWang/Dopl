import { type ToolResponse } from "./respond";
/**
 * **THE NAME A LAUNCH MUST CARRY, AND THE TWO REFUSALS THAT ENFORCE IT** (Samuel, 2026-09-15:
 * *"if agents are spinning up agents, they should be the ones that are naming the agent.
 * Shouldn't be a nameless agent. And certainly shouldn't be an agent with the id as the name."*).
 *
 * ⚠ **ITS OWN MODULE BECAUSE `channel-ops-launch.ts` IS AT THE CAP** (§1's hard 500 over
 * `packages/`, a CI job) — the seam is `channel-ops-launch-color.ts`'s: ONE FIELD, its rule and
 * its refusal prose, beside the op rather than inside it.
 *
 * ⚠ **REQUIRED, NOT OPTIONAL**: adding the field as optional would leave the defect reachable by
 * omission, and the caller here is a model that omits whatever it can.
 * ⚠ **REFUSED HERE RATHER THAN AT THE ROUTE'S ZOD, BECAUSE ONLY THIS LAYER CAN SAY WHAT TO PASS.**
 * `schema-launch.ts › LaunchCreateSchema.agentName` is the fence; a zod message reaches an
 * orchestrator as a validation string it cannot act on, and that is a retry loop.
 */
/**
 * **HAND-MIRRORED FROM `schema-launch.ts › LaunchCreateSchema.agentName`'s `.max(60)`** — and
 * from `main/agent-names.js › MAX_NAME`, the store at the far end that would bounce a longer
 * one with `bad-name` even if the route took it (S50, 2026-09-18).
 *
 * ⚠ **IT WAS UNPUBLISHED UNTIL 2026-09-18.** `name` carries no `.max()` in the published shape
 * — it serves four actions and the other three have no such bound — so a 61-character name
 * reached the route and came back as a bare `VALIDATION_FAILED` naming no field. The number is
 * in `name`'s own `.describe()` ("1-60 visible characters") and in `channel-errors.ts ›
 * fieldCapsNote()`; this is the third statement of it, and the only one that can refuse.
 */
export declare const LAUNCH_NAME_MAX_CHARS = 60;
/**
 * The name this launch should file, or the refusal to return instead.
 *
 * ⚠ **IT ANSWERS A UNION RATHER THAN THROWING**, matching every other refusal on this lane: the
 * op returns `ToolResponse` on both arms and nothing here needs a try/catch.
 * ⚠ **THE TRIMMED VALUE IS WHAT COMES BACK**, so the caller files the string this function
 * actually measured — filing `opts.name` raw would send one the checks never looked at.
 */
export declare function launchName(raw: string | undefined): {
    name: string;
} | ToolResponse;
/** TRUE for {@link launchName}'s refusal arm. ⚠ A PREDICATE RATHER THAN A CAST, so the op's
 *  narrowing is the compiler's rather than a reader's. */
export declare function isNameRefusal(answer: {
    name: string;
} | ToolResponse): answer is ToolResponse;
/**
 * **THE TAG A LAUNCHED AGENT ANSWERS TO** — its stored name, slugged (Samuel, 2026-09-15).
 *
 * ⚠ **THE SLUGGER IS RESTATED BECAUSE THIS PACKAGE CANNOT IMPORT `lib/mentions.ts ›
 * mentionSlug`** — the arrangement `channel-agent-id.ts` lives under for the id grammar. Pinned
 * against every other copy by `src/features/channels/agent-name-schema.test.ts`.
 * ⚠ **IT PRINTS WHAT THE CALLER WILL TYPE**: `Coder-1` is the stored NAME, `@coder-1` the
 * address, and publishing the first while the resolver accepts the second is how a caller writes
 * a token nothing tints.
 * ⚠ **THE CALLER MUST PASS THE MACHINE'S VALUE, NOT ITS OWN REQUEST** — echoing the ask would be
 * right whenever nothing collided and confidently wrong exactly when it mattered.
 */
export declare function launchedTag(name: string): string;
/**
 * What the launch result prints when the machine reported NO name (found reviewing
 * `4782677b`, 2026-09-16; re-worded for F-736, 2026-09-18).
 *
 * ⚠ **NOT A TAG, AND DELIBERATELY UNTYPEABLE.** Every other value of `name=` is an address a
 * caller copies; this one says the address is not known, so it carries no `@` and no slug.
 * `channel-facts.ts › renderValue` quotes it for the space, which is what keeps the
 * `key=value` pairs parseable.
 *
 * ⚠ **"NOT REPORTED", NOT "NOT APPLIED", AND THE DIFFERENCE IS THE WHOLE OF F-736.** The name
 * very likely WAS applied — the desktop stores it before it answers — and what is missing is the
 * REPORT of it. `(not applied)` stated the stronger of the two as if this process had observed
 * it, on exactly the launch where it had observed least. ⚠ **IT IS ALSO THE WORD `postureFacts`
 * ALREADY USES** for the same shape of silence on the same result line, so one line no longer
 * carries two vocabularies for one fact.
 */
export declare const NAME_NOT_REPORTED = "(not reported)";
/**
 * **THE `name=` FIELD ON A LAUNCHED RESULT** — the machine's value, or the one spelling of
 * "the machine did not say" (F-736, resolved 2026-09-18).
 *
 * ⚠ **IT USED TO SPLIT `undefined` FROM `null` AND ONE HALF WAS UNREACHABLE.** The `undefined`
 * arm meant *"this peer predates the field, so the name it stored IS the one that was asked for"*
 * and echoed the request. But the DTO never produces `undefined`:
 * `src/features/channels/server/service-launch-dto.ts` maps `applied_agent_name ?? null`, and the
 * column is `null` for a refusal, for a non-launch kind AND for every desktop older than
 * 2026-09-15 — so all three crossed the wire as `null` and a launch whose name was applied but
 * not reported rendered `(not applied)`. **Two halves each pretending the other existed**, which
 * is F-736's own phrasing of it.
 *
 * ⚠ **THE FIX IS TO DROP THE ARM, NOT TO RE-CARRY THE DISTINCTION.** The alternative on the
 * finding was an absent KEY for a directive predating the field — which needs this process to
 * date another machine's build from a row, and would buy one echo of a request this process
 * cannot confirm. `undefined` and `null` therefore land on the same honest answer, and no caller
 * is handed a tag nothing answers to.
 *
 * ⚠ **THE REQUEST IS NO LONGER AN ARGUMENT.** Echoing it was the only reason to pass it, and a
 * parameter that can only produce the wrong answer is worse than no parameter.
 */
export declare function launchedName(applied: string | null | undefined): string;
