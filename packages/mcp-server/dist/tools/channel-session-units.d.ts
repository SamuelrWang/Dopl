/**
 * THE COARSE UNITS A SESSION LINE IS WRITTEN IN — an age, and a count.
 *
 * ⚠ **ITS OWN MODULE SINCE 2026-09-01, AND THE REASON IS A CYCLE RATHER THAN A
 * LINE COUNT.** These three lived in `channel-session-render.ts`, which is where
 * they are still mostly used. When `channel-session-health.ts` was split out of
 * that file (the §2 cap, plus a different reason to change), it needed the same
 * three — and importing them back out of the renderer while the renderer imports
 * the health clauses is an import CYCLE. The alternative was a second copy of
 * `coarseAge`, which is how two surfaces start disagreeing about whether 90
 * seconds is "2m" or "1m". So the primitives moved DOWN, where both callers can
 * reach them and neither reaches the other.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan (the tool-group
 * scan in `tool-group-files.ts` globs `<stem>-*.ts`, and a helper in an
 * unprefixed file is invisible to every invariant suite).
 *
 * ⚠ **THE ONE RULE THEY ALL SHARE: AN UNKNOWN VALUE IS `null`, NEVER `0`.** A
 * stamp that cannot be parsed is a stamp we know nothing about, and rendering
 * "0s ago" for one invents a report. Nothing here has a `?? 0` and nothing here
 * may get one — `channel-session-render.ts`'s header states the rule for the
 * whole family.
 */
/** "6m" / "2h" / "3d" — coarse on purpose; nobody acts on seconds here. */
export declare function coarseAge(ms: number): string;
/**
 * How long ago `iso` was, or `null` when it is absent or unparseable.
 * ⚠ UNPARSEABLE IS `null`, NOT `0`. A stamp we cannot read is a stamp we know
 * nothing about, and rendering "0s ago" for one invents a report.
 */
export declare function ageMs(iso: string | null | undefined, now: number): number | null;
/** `41k` / `912` — compact, and never for a null. */
export declare function compactCount(n: number): string;
