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
