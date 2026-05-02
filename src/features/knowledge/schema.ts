import { z } from "zod";

/**
 * Zod input schemas for the knowledge feature. Used by REST handlers
 * (Item 2) and MCP tools (Item 4) — the same parsed shape feeds the
 * service layer either way.
 *
 * Conventions:
 *   - `id`, `parentId`, `folderId` are UUIDs.
 *   - Slugs are second-segment URLs (`/[workspaceSlug]/knowledge/[kbSlug]`),
 *     so they follow the kebab-case shape of the workspace slugs.
 *   - All `*Update` schemas are partial — undefined fields are no-ops.
 *   - `null` is allowed where the column is nullable (e.g. clearing a
 *     description or moving an entry to a base's root folder).
 */

const slugRegex = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// Folder / entry names — design notes (audit fix #14):
//
//   Path-addressing (`/foo/bar/baz.md`) is **case-sensitive** and
//   **byte-exact**. `Foo.md` and `foo.md` coexist as distinct entries;
//   the agent must spell paths exactly as the user does. Filesystem
//   semantics. The URL-side handles the case-insensitive ergonomics —
//   `proxy.ts` lowercase-redirects mixed-case URLs (audit fix S-8) so
//   workspace / KB slugs don't suffer from typo case mismatches.
//
//   At the schema level we enforce:
//     - no '/' (would be unreachable via the path resolver)
//     - no leading or trailing whitespace (visual collisions like " foo"
//       vs "foo" are confusing and break filesystem-style mental models)
//     - no control / zero-width characters (would render identically
//       to a sibling and let an agent or attacker hide a duplicate)
//
// Exported so non-zod call sites (e.g. WriteFileSchema in the
// path-write route) can validate against the same constraint without
// re-declaring the literal — single source of truth for folder / entry
// name validation.
export const NAME_RE = /^(?!\s)(?!.*\s$)[^/\u0000-\u001F\u007F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]+$/;
export const NAME_INVALID_MESSAGE =
  "Cannot contain '/', control characters, zero-width characters, or leading/trailing whitespace";

// Backwards-compat aliases — kept so existing import sites don't churn.
const noSlashRegex = NAME_RE;
const noSlashMessage = NAME_INVALID_MESSAGE;

// Cap body size to 1 MB (audit fix #26). Without this an agent could
// upload arbitrarily large markdown that blows up the search_tsv
// generated column and the per-entry payload. Generous enough that
// real markdown documents fit; tight enough to bound DoS surface.
const MAX_BODY_BYTES = 1_048_576;
const bodyMaxMessage = "Body must be 1 MB or less";

export const KnowledgeEntryTypeSchema = z.enum([
  "note",
  "doc",
  "transcript",
  "imported",
]);

// ─── knowledge_bases ────────────────────────────────────────────────

export const KnowledgeBaseCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  // `nullable().optional()` for parity with KnowledgeBaseUpdateSchema —
  // both `undefined` (omit) and `null` (explicit clear) are valid.
  description: z.string().max(2000).nullable().optional(),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(slugRegex, "Slug must be kebab-case")
    .optional(),
  agentWriteEnabled: z.boolean().optional(),
});
export type KnowledgeBaseCreateInput = z.infer<typeof KnowledgeBaseCreateSchema>;

export const KnowledgeBaseUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  slug: z.string().min(1).max(80).regex(slugRegex).optional(),
  agentWriteEnabled: z.boolean().optional(),
});
export type KnowledgeBaseUpdateInput = z.infer<typeof KnowledgeBaseUpdateSchema>;

export const AgentWriteToggleSchema = z.object({
  agentWriteEnabled: z.boolean(),
});
export type AgentWriteToggleInput = z.infer<typeof AgentWriteToggleSchema>;

// ─── knowledge_folders ──────────────────────────────────────────────

export const KnowledgeFolderCreateSchema = z.object({
  knowledgeBaseId: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional(),
  name: z
    .string()
    .min(1, "Name is required")
    .max(200)
    .regex(noSlashRegex, noSlashMessage),
  position: z.number().int().min(0).optional(),
});
export type KnowledgeFolderCreateInput = z.infer<
  typeof KnowledgeFolderCreateSchema
>;

export const KnowledgeFolderUpdateSchema = z.object({
  name: z.string().min(1).max(200).regex(noSlashRegex, noSlashMessage).optional(),
  position: z.number().int().min(0).optional(),
});
export type KnowledgeFolderUpdateInput = z.infer<
  typeof KnowledgeFolderUpdateSchema
>;

export const KnowledgeFolderMoveSchema = z.object({
  parentId: z.string().uuid().nullable(),
  position: z.number().int().min(0).optional(),
});
export type KnowledgeFolderMoveInput = z.infer<
  typeof KnowledgeFolderMoveSchema
>;

// ─── knowledge_entries ──────────────────────────────────────────────

export const KnowledgeEntryCreateSchema = z.object({
  knowledgeBaseId: z.string().uuid(),
  folderId: z.string().uuid().nullable().optional(),
  title: z
    .string()
    .min(1, "Title is required")
    .max(300)
    .regex(noSlashRegex, noSlashMessage),
  excerpt: z.string().max(1000).nullable().optional(),
  body: z.string().max(MAX_BODY_BYTES, bodyMaxMessage).optional(),
  entryType: KnowledgeEntryTypeSchema.optional(),
  position: z.number().int().min(0).optional(),
});
export type KnowledgeEntryCreateInput = z.infer<
  typeof KnowledgeEntryCreateSchema
>;

export const KnowledgeEntryUpdateSchema = z.object({
  title: z.string().min(1).max(300).regex(noSlashRegex, noSlashMessage).optional(),
  excerpt: z.string().max(1000).nullable().optional(),
  body: z.string().max(MAX_BODY_BYTES, bodyMaxMessage).optional(),
  entryType: KnowledgeEntryTypeSchema.optional(),
  position: z.number().int().min(0).optional(),
});
export type KnowledgeEntryUpdateInput = z.infer<
  typeof KnowledgeEntryUpdateSchema
>;

export const KnowledgeEntryMoveSchema = z.object({
  folderId: z.string().uuid().nullable(),
  position: z.number().int().min(0).optional(),
});
export type KnowledgeEntryMoveInput = z.infer<typeof KnowledgeEntryMoveSchema>;
