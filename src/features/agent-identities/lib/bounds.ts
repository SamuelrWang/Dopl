/**
 * Identity text bounds a client component needs, zod-free; `../schema.ts` re-exports them and
 * `schema-sql.test.ts` pins them against the migration's CHECKs.
 */

/** `agent_identities_name_charset_check`. */
export const MAX_NAME_CHARS = 120;

/** `agent_identities_prose_charset_check` (description half). */
export const MAX_DESCRIPTION_CHARS = 2000;
