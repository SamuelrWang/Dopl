/**
 * **THE LAUNCH GOAL'S OWN CAP, AND THE PRE-FLIGHT THAT NAMES IT** (S50, 2026-09-18).
 *
 * ⚠ **THE SURFACE PUBLISHES 16000 AND THE LAUNCH ROUTE ENFORCES 2000 — AN 8× GAP WITH
 * NOTHING BETWEEN THEM.** `channel-schema.ts › CHANNEL_INPUT_SHAPE.body` is `.max(16000)`,
 * which is CORRECT for `op="send"` and for a thread's opening post; `channel-dispatch-agents.ts`
 * then maps that same field onto `goal` for `op="manage" action="launch"`, where
 * `src/features/channels/schema-launch.ts › LaunchCreateSchema.goal` is
 * `.trim().min(1).max(2000)`. A 2,001-character goal therefore passed every check this
 * process had and came back as a bare `VALIDATION_FAILED: Request body failed validation` —
 * no field, no number, nothing to act on. An orchestrator reading that has no way to tell a
 * too-long goal from a malformed thread id, so it retries the same call.
 *
 * ⚠ **THE FIX IS A PRE-FLIGHT, NOT A LOWERED SCHEMA.** Dropping `body` to 2000 would break
 * `op="send"`, which is the field's other and far commoner lane. What was wrong is that the
 * 2000 was UNPUBLISHED — so it is published now (`body`'s `.describe()` and
 * `channel-errors.ts › fieldCapsNote`) and refused here, before any request goes out.
 *
 * ⚠ **REFUSED HERE RATHER THAN AT THE ROUTE'S ZOD, BECAUSE ONLY THIS LAYER CAN SAY WHAT TO
 * DO INSTEAD** — the same argument `channel-ops-launch-name.ts` opens with. A goal that long
 * is a BRIEF that wanted to be a document: it belongs in a knowledge entry the agent is
 * pointed at, or in a post it can read, and the goal is the opening instruction that names
 * one of those. A zod message cannot say any of that.
 *
 * ⚠ **ITS OWN MODULE BECAUSE `channel-ops-launch.ts` IS AT THE CAP** (§1's hard 500 over
 * `packages/`, a CI job) — the seam `channel-ops-launch-color.ts` and
 * `channel-ops-launch-name.ts` already draw: ONE FIELD, its rule and its refusal prose,
 * beside the op rather than inside it.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan (`parity.test.ts`) and the
 * removed-vocabulary source scan (`channel-law.test.ts`, `law-scan.test.ts`).
 */
import { type ToolResponse } from "./respond";
/**
 * **HAND-MIRRORED FROM `schema-launch.ts › LaunchCreateSchema.goal`'s `.max(2000)`**, the
 * bound that actually rejects the request — the same hand-mirror discipline
 * `channel-schema.ts`'s caps and `channel-errors.ts › fieldCapsNote` follow, and for the
 * same reason: this package cannot import from `src/`. ⚠ **IT IS NOT `body`'s 16000 AND MUST
 * NOT BE "CORRECTED" TO IT.** The two numbers are two different routes' and both are right.
 */
export declare const LAUNCH_GOAL_MAX_CHARS = 2000;
/**
 * The goal this launch may file, or the refusal to return instead.
 *
 * ⚠ **IT ANSWERS A UNION RATHER THAN THROWING**, matching every other refusal on this lane:
 * the op returns `ToolResponse` on both arms and nothing here needs a try/catch.
 * ⚠ **MEASURED AFTER A TRIM, BECAUSE THE ROUTE TRIMS BEFORE IT MEASURES** (`.trim().max(2000)`).
 * Measuring the raw string would refuse a goal the route would have taken — a refusal for a
 * request that was legal is worse than the bare 400 this replaces.
 * ⚠ **IT RETURNS THE CALLER'S OWN VALUE UNTOUCHED, NOT THE TRIMMED ONE.** The trim is a
 * MEASUREMENT here; the route does its own, and `channel-ops-launch.ts › idle` reads the same
 * argument. Substituting a normalized string would be this module quietly editing the
 * instruction an agent was given.
 * ⚠ **AN ABSENT GOAL IS NOT A REFUSAL.** A launch with no goal registers a stand-by agent
 * (`idle=yes`), which is a supported outcome — this function bounds a goal, it does not
 * require one.
 */
export declare function launchGoal(raw: string | undefined): {
    goal: string | undefined;
} | ToolResponse;
/** TRUE for {@link launchGoal}'s refusal arm. ⚠ A PREDICATE RATHER THAN A CAST, so the op's
 *  narrowing is the compiler's rather than a reader's — `channel-ops-launch-name.ts ›
 *  isNameRefusal`'s shape, and deliberately: two neighbours of one op that narrowed
 *  differently would be two idioms for one thing. */
export declare function isGoalRefusal(answer: {
    goal: string | undefined;
} | ToolResponse): answer is ToolResponse;
