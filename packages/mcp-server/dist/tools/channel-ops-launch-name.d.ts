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
 * FIELD_CAPS_NOTE`; this is the third statement of it, and the only one that can refuse.
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
 * `4782677b`, 2026-09-16).
 *
 * ⚠ **NOT A TAG, AND DELIBERATELY UNTYPEABLE.** Every other value of `name=` is an address a
 * caller copies; this one says the address is not known, so it carries no `@` and no slug.
 * `channel-facts.ts › renderValue` quotes it for the space, which is what keeps the
 * `key=value` pairs parseable.
 */
export declare const NAME_NOT_APPLIED = "(not applied)";
/**
 * **THE `name=` FIELD ON A LAUNCHED RESULT** — the machine's value, the older-desktop fallback,
 * and the third case that used to be silently folded into the second (found reviewing
 * `4782677b`, 2026-09-16).
 *
 * ⚠ **`null` AND `undefined` ARE DIFFERENT ANSWERS AND `??` COLLAPSED THEM.** The field is
 * OPTIONAL on the SDK's `LaunchDirective`, so:
 *   · `undefined` — the desktop/server predates the field. The name it stored IS the one that was
 *     asked for, and echoing the request is the honest answer. This is the only fallback.
 *   · `null` — the field IS carried and the machine reported no name. `4782677b` closed the two
 *     desktop arms that produced it, so it should now be unreachable; echoing the REQUEST here
 *     published a tag nothing answers to, on exactly the launch that went wrong.
 * ⚠ **AN UNREACHABLE CASE STILL GETS A SPELLING.** "Cannot happen" is what the previous version
 * relied on, and the six unnamed launches of 2026-09-16 are what it cost.
 */
export declare function launchedName(applied: string | null | undefined, requested: string): string;
