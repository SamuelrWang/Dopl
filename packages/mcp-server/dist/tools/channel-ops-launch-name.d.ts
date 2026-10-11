import { type ToolResponse } from "./respond";
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
