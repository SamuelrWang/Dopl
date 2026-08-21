import { z } from "zod";

/**
 * A zod enum that is PROVABLY the same set as its TypeScript union — drift in
 * EITHER direction is a compile error.
 *
 * ⚠ IT EXISTS BECAUSE THE OBVIOUS ANNOTATION ONLY CATCHES ONE HALF, AND THE HALF
 * IT MISSES IS THE ONE THAT HAPPENS. Writing
 *
 *     const S: z.ZodType<ChannelVisibility> = z.enum(["private", "public"]);
 *
 * fails if the ENUM grows a member the union lacks — but adding `"secret"` to the
 * UNION and forgetting the enum compiles clean, because a narrower output type is
 * assignable to a wider `ZodType`. Measured, not assumed (2026-08-20): the union
 * was widened by hand against every annotated schema in `features/channels` and
 * `tsc` stayed silent. So the annotation read like a guarantee and was not one,
 * which is worse than no annotation — it is a check people stop thinking behind.
 *
 * The two constraints together are the proof:
 *   - `Values extends readonly [Union, ...Union[]]` — every VALUE is in the union.
 *   - `Exclude<Union, Values[number]> extends never` — every UNION MEMBER is a
 *     value. When it is not, the parameter type collapses to `never` and the call
 *     cannot be made, so the error lands on the schema rather than somewhere
 *     downstream.
 *
 * ⚠ A THIRD STATEMENT OF THESE SETS USUALLY EXISTS IN SQL (a `CHECK`), and no
 * TypeScript can reach it. This closes the TS↔zod gap and nothing else; a schema
 * test still has to hold the database's copy against these.
 *
 * @example
 *   const VisibilitySchema = closedEnum<ChannelVisibility>()(["private", "public"]);
 */
export function closedEnum<Union extends string>() {
  return <const Values extends readonly [Union, ...Union[]]>(
    values: Exclude<Union, Values[number]> extends never ? Values : never
  ): z.ZodType<Union> =>
    z.enum(values as unknown as readonly [Union, ...Union[]]) as z.ZodType<Union>;
}
