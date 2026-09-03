import { z } from "zod";

/**
 * THE GRANT WRITE'S SHAPE — `PUT /api/resource-grants`, the door that REPLACED
 * the two copy ops (Wave B slice B15, Samuel's ruling B11: *grants replace
 * copies*).
 *
 * ⚠ **EVERY ENUM HERE IS A HAND-MIRROR OF A `CHECK` IN
 * `20260914120000_resource_grants.sql`, AND THE MIGRATION IS THE AUTHORITY.**
 * Widening one of these without widening the constraint produces a 500 at the
 * statement rather than a 400 at the door — the failure direction this file
 * exists to close. `@dopl/contracts` cannot hold them: the SQL side is text in
 * a migration, so the pairing is a test's job, not a type's.
 *
 * ⚠ **THE LEVEL PAIR IS CROSS-FIELD AND SO IS ITS VALIDATION.** `agent_only` /
 * `visible` are CHANNEL words and `read` / `edit` are the other two scopes'
 * (`resource_grants_level_check`'s `CASE`), so the refinement below is not a
 * nicety — without it a legal-looking body reaches Postgres to be refused with
 * `23514` and no field name.
 */

export const GRANT_SCOPE_TYPES = ["channel", "container", "team"] as const;

export const GRANT_RESOURCE_TYPES = [
  "knowledge_base",
  "agent_template",
  "skill",
  "chat",
  "chat_folder",
] as const;

/** ⚠ Channel scopes only — two AUDIENCES, never a high/low pair. */
export const CHANNEL_GRANT_LEVELS = ["agent_only", "visible"] as const;

/** ⚠ Container and team scopes only. */
export const CONTAINER_GRANT_LEVELS = ["read", "edit"] as const;

/** Which vocabulary a scope speaks. ⚠ ONE STATEMENT, read by the zod refinement
 *  below and by the MCP tool's own argument descriptions, so the surface and the
 *  fence cannot name different words. */
export function levelsForScope(
  scopeType: (typeof GRANT_SCOPE_TYPES)[number]
): readonly string[] {
  return scopeType === "channel" ? CHANNEL_GRANT_LEVELS : CONTAINER_GRANT_LEVELS;
}

/**
 * ⚠ **POSTGRES'S `uuid`, NOT RFC 4122's.** `z.string().uuid()` in zod v4 pins
 * the VERSION and VARIANT nibbles; `uuid` the column type accepts any 32 hex
 * digits, and this repo's own fixtures and several live ids are not v4. A
 * stricter door than the column would 400 rows that exist.
 */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const ResourceGrantWriteSchema = z
  .object({
    resourceType: z.enum(GRANT_RESOURCE_TYPES),
    resourceId: z.string().regex(UUID_RE, "must be a UUID"),
    scopeType: z.enum(GRANT_SCOPE_TYPES),
    scopeId: z.string().regex(UUID_RE, "must be a UUID"),
    level: z.enum([...CHANNEL_GRANT_LEVELS, ...CONTAINER_GRANT_LEVELS]),
  })
  .superRefine((v, ctx) => {
    if (levelsForScope(v.scopeType).includes(v.level)) return;
    ctx.addIssue({
      code: "custom",
      path: ["level"],
      message: `level "${v.level}" is not a ${v.scopeType} level — use ${levelsForScope(v.scopeType).join(" or ")}.`,
    });
  });

export type ResourceGrantWrite = z.infer<typeof ResourceGrantWriteSchema>;
