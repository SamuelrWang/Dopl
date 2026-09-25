/**
 * ⚠ THE ONTOLOGY'S RETIRED MCP NAMES — never accepted, only answered with their successor.
 *
 * Samuel, 2026-09-23: *"The word "cluster" is obsolete, so it needs to be completely removed."*
 * `dopl_ontology` says `ontology=`, `op="create_ontology"` and `op="update_ontology"` since then.
 * A desktop at or below 1.36.0 still frames shared ontologies as `…op "map", cluster "<id>"`
 * (`dopl-desktop-app/main/prompt-framing-ontology.js` in that build), and an agent with an older
 * transcript may send the old op names. Neither is ACCEPTED — the schema never lists them, so no
 * agent-visible text carries the old word — but the refusal names the successor, which turns a
 * dead end into one retry. This is the only file in the package that spells the old word;
 * `src/features/ontology/vocabulary.test.ts` exempts it by path.
 *
 * ⚠ REMOVAL TRIGGER: the release after `src/shared/version/desktop-floor.ts ›
 * DEFAULT_MIN_VERSION` reaches 1.37.0 (the first desktop that frames `ontology`). Delete this
 * file and its two call sites (`registrar.ts › RENAMED_ARGS`, `tools/ontology.ts`'s op enum).
 */
/**
 * `container=personal` — the Home space's slug until `20261023120000_home_vocabulary_rename.sql`
 * re-slugged it `home` (Samuel, 2026-09-24: the `personal` layer is cut). An agent holding the old
 * spelling still lands in its Home space for ONE release. REMOVAL TRIGGER: the release after
 * 1.37.1; delete this function and its one call site (`workspace-directory.ts › resolveContainerRef`).
 */
export declare function isLegacyHomeAddress(foldedRef: string): boolean;
/** Retired `dopl_ontology` args → the arg that replaced each. */
export declare const LEGACY_ONTOLOGY_ARGS: Readonly<Record<string, string>>;
/**
 * The op enum's error for a retired op name, or `undefined` for zod's own message. No quotes in
 * the hint: the SDK JSON-serializes the issue, so they would arrive escaped.
 */
export declare function legacyOntologyOpMessage(issue: {
    input?: unknown;
}): string | undefined;
