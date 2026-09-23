/**
 * The identity text bounds a CLIENT component needs, zod-free so the editor can
 * clamp at the schema's own numbers (P7-05). `../schema.ts` re-exports them and
 * `schema-sql.test.ts` pins them against the migration's CHECKs.
 */

/** Matches `agent_identities_name_charset_check`. */
export const MAX_NAME_CHARS = 120;

/** Matches `agent_identities_prose_charset_check` (description half). */
export const MAX_DESCRIPTION_CHARS = 2000;
