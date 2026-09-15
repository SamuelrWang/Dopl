import { type ToolResponse } from "./respond";
/**
 * **THE NAME A LAUNCH MUST CARRY, AND THE TWO REFUSALS THAT ENFORCE IT** (Samuel, 2026-09-15,
 * verbatim: *"if agents are spinning up agents, they should be the ones that are naming the
 * agent. Shouldn't be a nameless agent. And certainly shouldn't be an agent with the id as the
 * name."*).
 *
 * ⚠ **ITS OWN MODULE BECAUSE `channel-ops-launch.ts` IS AT THE CAP** (§1's hard 500 over
 * `packages/`, a CI job), and the seam is `channel-ops-launch-color.ts`'s exactly — ONE FIELD,
 * its rule and its refusal prose, beside the op rather than inside it. That file's header calls
 * itself "the third such neighbour rather than a new pattern"; this is the fourth.
 *
 * ⚠ **THE CAPABILITY AND THE REQUIREMENT LANDED TOGETHER, AND THAT IS THE DESIGN.** Until this
 * wave the launch op had no `name` argument AT ALL, so every agent an agent launched was nameless
 * by construction and rendered on every human surface as its own instance id
 * (`docs/specs/agent-id-visibility.md`). Adding the field as OPTIONAL would have left the defect
 * reachable by omission, and the caller here is a model that omits whatever it can.
 *
 * ⚠ **REFUSED HERE RATHER THAN AT THE ROUTE'S ZOD, BECAUSE ONLY THIS LAYER CAN SAY WHAT TO PASS.**
 * `schema-launch.ts › LaunchCreateSchema.agentName` also requires it — that is the fence — but a
 * zod message reaches an orchestrator as a validation string it cannot act on, and a refusal an
 * orchestrator cannot act on is a retry loop.
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
 * ⚠ **IT LIVES BESIDE THE NAME RULE BECAUSE IT IS THE OTHER HALF OF ONE SUBJECT**: this module
 * decides what a launch may be CALLED, and this is how that name is SPELLED back to the caller.
 * (`channel-ops-launch.ts` is at the §1 cap, which is why both are here rather than there.)
 *
 * ⚠ **THE SLUGGER IS RESTATED BECAUSE THIS PACKAGE CANNOT IMPORT `lib/mentions.ts ›
 * mentionSlug`** — the arrangement `channel-agent-id.ts` lives under for the id grammar. Four
 * characters, one rule: trim, lowercase, whitespace runs to a single `-`.
 * ⚠ **IT PRINTS WHAT THE CALLER WILL TYPE.** `Coder-1` is the stored NAME; `@coder-1` is the
 * address, and publishing the first while the resolver accepts the second is how a caller writes
 * a token nothing tints.
 * ⚠ **THE CALLER MUST PASS THE MACHINE'S VALUE, NOT ITS OWN REQUEST.** The uniqueness rule may
 * have stored `Coder-1`; echoing the ask would be right whenever nothing collided and confidently
 * wrong exactly when it mattered.
 */
export declare function launchedTag(name: string): string;
