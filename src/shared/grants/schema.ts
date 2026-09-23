import { z } from "zod";

/**
 * Body of `PUT /api/resource-grants`. Every enum mirrors a `CHECK` in
 * `20260914120000_resource_grants.sql` (the authority): widening one here alone turns a 400 into a 500.
 * Level vocabulary depends on scope (`resource_grants_level_check`), hence the cross-field refinement.
 */

export const GRANT_SCOPE_TYPES = ["channel", "container", "team"] as const;

export const GRANT_RESOURCE_TYPES = [
  "knowledge_base",
  "agent_identity",
  "skill",
  "chat",
  "chat_folder",
] as const;

/** Channel scopes only — two audiences, not a high/low pair. */
export const CHANNEL_GRANT_LEVELS = ["agent_only", "visible"] as const;

/** Container and team scopes only. */
export const CONTAINER_GRANT_LEVELS = ["read", "edit"] as const;

/** The level vocabulary a scope speaks. */
export function levelsForScope(
  scopeType: (typeof GRANT_SCOPE_TYPES)[number]
): readonly string[] {
  return scopeType === "channel" ? CHANNEL_GRANT_LEVELS : CONTAINER_GRANT_LEVELS;
}

/** Postgres `uuid`, not RFC 4122: zod v4's `.uuid()` pins version/variant nibbles and would 400 ids
 *  that exist. */
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
