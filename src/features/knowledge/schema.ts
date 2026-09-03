import { z } from "zod";
import { DESCRIPTION_MAX, KB_BASE_DESCRIPTION_MAX } from "@/config";
import { safeLabel } from "@/shared/lib/safe-label";

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

/**
 * The BASE name was the gap in this file: folder names and entry titles have
 * carried `NAME_RE` since audit fix #14, but the base sitting above them was
 * bounded by length alone — and it is the one of the three that `dopl_map`
 * prints at session start and that every `dopl_kb` and `dopl_search` result
 * names. Same class as `NAME_RE` minus its '/' ban, which exists for the
 * path resolver and has nothing to say about a base name. `description` stays
 * prose (2000 chars of what the base is for).
 *
 * `knowledge_bases_editor_update` is a `public` UPDATE policy and
 * `authenticated` holds UPDATE, so any workspace editor can rename a base
 * straight through PostgREST without passing this schema. The DB CHECK is the
 * load-bearing half; this line is the one that produces a readable error.
 */
const KnowledgeBaseNameSchema = safeLabel("Knowledge base name", 120);

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

/** One team's grant on a KB — used by create + update sharing payloads. */
export const KbTeamGrantSchema = z.object({
  teamId: z.string().uuid(),
  level: z.enum(["read", "edit"]),
});
export type KbTeamGrantInput = z.infer<typeof KbTeamGrantSchema>;

/**
 * One (KB, channel) grant write — `PUT /api/knowledge/bases/[baseId]/channel-grants`.
 *
 * ⚠ `level: "none"` is the DELETE, spelled. Storage has no `'none'` (absence of
 * a row is "not shared"), so this enum is wider than `ChannelGrantLevel` by
 * exactly one wire-only value; the service collapses it.
 *
 * ⚠ `guestWrite` DEFAULTS TO FALSE, and the default is the safety property, not
 * ergonomics: an omitted flag must never inherit whatever the previous grant
 * carried. A caller raising `agent_only` → `visible` without naming
 * `guestWrite` gets a read-only guest audience. The service additionally FORCES
 * it false at `agent_only`, where no human is in the audience at all.
 */
export const ChannelGrantWriteSchema = z.object({
  channelId: z.string().uuid(),
  level: z.enum(["none", "agent_only", "visible"]),
  guestWrite: z.boolean().optional().default(false),
});
export type ChannelGrantWriteInput = z.infer<typeof ChannelGrantWriteSchema>;

/**
 * Shared refinement: teams mode can't be private, and grants only make
 * sense in teams mode. `requireGrants` (create) additionally demands at
 * least one grant — updates may send an empty set (deliberate "owner +
 * admins only" state; the UI warns before allowing it).
 */
function refineScope(requireGrants: boolean) {
  return (
    data: {
      visibility?: "public" | "private";
      accessMode?: "workspace" | "teams";
      teamGrants?: KbTeamGrantInput[];
    },
    ctx: z.RefinementCtx
  ) => {
    if (data.accessMode === "teams") {
      if (data.visibility === "private") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A private knowledge base cannot be teams-scoped",
          path: ["accessMode"],
        });
      }
      if (requireGrants && (!data.teamGrants || data.teamGrants.length === 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Teams-scoped knowledge bases need at least one team grant",
          path: ["teamGrants"],
        });
      }
    }
    if (data.teamGrants?.length && data.accessMode !== "teams") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "teamGrants requires accessMode 'teams'",
        path: ["teamGrants"],
      });
    }
  };
}

export const KnowledgeBaseCreateSchema = z
  .object({
    name: KnowledgeBaseNameSchema,
    // `nullable().optional()` for parity with KnowledgeBaseUpdateSchema —
    // both `undefined` (omit) and `null` (explicit clear) are valid.
    description: z.string().max(KB_BASE_DESCRIPTION_MAX).nullable().optional(),
    slug: z
      .string()
      .min(1)
      .max(80)
      .regex(slugRegex, "Slug must be kebab-case")
      .optional(),
    agentWriteEnabled: z.boolean().optional(),
    /**
     * Optional visibility at creation. Service-level `createBase`
     * defaults to `'private'` when omitted (start drafty, share later).
     */
    visibility: z.enum(["public", "private"]).optional(),
    /** `'teams'` scopes the base to the granted teams below. */
    accessMode: z.enum(["workspace", "teams"]).optional(),
    /** Initial team grants — only valid with `accessMode: 'teams'`. */
    teamGrants: z.array(KbTeamGrantSchema).max(50).optional(),
    /**
     * Put the new base on the PERSONAL SHELF (`types.ts › KbShelf`) instead of
     * the workspace Knowledge page. ⚠ A REQUEST, NOT A DECISION: the schema only
     * says the word is spellable — `shared/tenancy/personal-container.ts ›
     * personalWriteWorkspaceId` is the fence, and it 403s rather than
     * downgrading. ⚠ **IT ROUTES THE ROW AND NOTHING STORES IT** (2026-09-02,
     * slice B15): it decides the `workspace_id`, where it used to be written
     * onto a `home_scoped` column beside one. Omitted/false = the container the
     * call is in, which is every existing caller.
     */
    homeScoped: z.boolean().optional(),
    /**
     * Create the base AND share it into this channel in one call — the /home
     * Shared section's create button (Samuel's ruling 2026-08-27). The grant is
     * always `level: 'visible'`, `guestWrite: false`; anything else is the
     * base's own sharing settings, where a three-state control belongs.
     *
     * ⚠ A REQUEST, NOT A DECISION. The ROUTE fences the channel against the
     * caller's visible list (404 on a miss, never an oracle) and
     * `server/service-channel-grants.ts › setChannelKnowledgeGrant` owns the
     * rest; the base is rolled back if the grant fails, so this never half-lands.
     */
    shareToChannelId: z.string().uuid().optional(),
    /**
     * 🔒 "I know this publishes into a room somebody else is standing in."
     *
     * ⚠ A PRECONDITION, NOT A PERMISSION, AND IT IS REQUIRED ONLY ON THE NARROW
     * PREDICATE — `kind='link'` container, two or more active members, and the
     * base landing at `visibility: 'public'`. Everywhere else it is IGNORED,
     * never refused. `features/workspaces/server/shared-publish.ts` is the one
     * statement of both the predicate and the 400, shared with agent templates
     * so the two lanes cannot answer differently.
     *
     * ⚠ NOT THE SAME QUESTION AS `shareToChannelId`. That one asks for a
     * `channel_resource_grants` row — a base reaching ONE channel while staying
     * private. This one is about the WORKSPACE axis, which inside a container
     * means every member of it at once.
     */
    acknowledgeShared: z.boolean().optional(),
  })
  .superRefine(refineScope(true));
export type KnowledgeBaseCreateInput = z.infer<typeof KnowledgeBaseCreateSchema>;

export const KnowledgeBaseUpdateSchema = z
  .object({
    name: KnowledgeBaseNameSchema.optional(),
    description: z.string().max(KB_BASE_DESCRIPTION_MAX).nullable().optional(),
    slug: z.string().min(1).max(80).regex(slugRegex).optional(),
    agentWriteEnabled: z.boolean().optional(),
    /**
     * Two-way visibility: scope is fully changeable by the owner or a
     * workspace admin. Narrowing transitions (→ private, grant removal)
     * are applied as-is by the service (no cross-resource check remains).
     */
    visibility: z.enum(["public", "private"]).optional(),
    accessMode: z.enum(["workspace", "teams"]).optional(),
    /**
     * Declarative FULL set of team grants when `accessMode: 'teams'` —
     * the service diffs against current rows (upserts added/changed,
     * removes missing).
     */
    teamGrants: z.array(KbTeamGrantSchema).max(50).optional(),
    /**
     * 🔒 "I know this publishes into a room somebody else is standing in."
     *
     * ⚠ A PRECONDITION, NOT A PERMISSION, AND IT IS REQUIRED ONLY ON THE NARROW
     * PREDICATE — `kind='link'` container, two or more active members, and the
     * base landing at `visibility: 'public'`. Everywhere else it is IGNORED,
     * never refused. `features/workspaces/server/shared-publish.ts` is the one
     * statement of both the predicate and the 400, shared with agent templates
     * so the two lanes cannot answer differently.
     *
     * ⚠ NOT THE SAME QUESTION AS `shareToChannelId`. That one asks for a
     * `channel_resource_grants` row — a base reaching ONE channel while staying
     * private. This one is about the WORKSPACE axis, which inside a container
     * means every member of it at once.
     */
    acknowledgeShared: z.boolean().optional(),
  })
  .superRefine(refineScope(false));
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
  description: z.string().max(DESCRIPTION_MAX).nullable().optional(),
  position: z.number().int().min(0).optional(),
});
export type KnowledgeFolderCreateInput = z.infer<
  typeof KnowledgeFolderCreateSchema
>;

export const KnowledgeFolderUpdateSchema = z.object({
  name: z.string().min(1).max(200).regex(noSlashRegex, noSlashMessage).optional(),
  description: z.string().max(DESCRIPTION_MAX).nullable().optional(),
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
  excerpt: z.string().max(DESCRIPTION_MAX).nullable().optional(),
  body: z.string().max(MAX_BODY_BYTES, bodyMaxMessage).optional(),
  entryType: KnowledgeEntryTypeSchema.optional(),
  position: z.number().int().min(0).optional(),
});
export type KnowledgeEntryCreateInput = z.infer<
  typeof KnowledgeEntryCreateSchema
>;

export const KnowledgeEntryUpdateSchema = z.object({
  title: z.string().min(1).max(300).regex(noSlashRegex, noSlashMessage).optional(),
  excerpt: z.string().max(DESCRIPTION_MAX).nullable().optional(),
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

/**
 * `PUT /api/channels/{channelId}/knowledge/entries/{entryId}` — the GUEST LANE's
 * entry write (M2, plan §3.4), and it is a STRICT SUBSET of
 * `KnowledgeEntryUpdateSchema` rather than a reuse of it.
 *
 * ⚠ THE MISSING FIELDS ARE THE SCHEMA'S POINT. `excerpt`, `entryType` and
 * `position` are all writable on the workspace PATCH and none of them is an
 * EDIT: `position` reorders somebody else's tree, `entryType` reclassifies a
 * document, `excerpt` rewrites what the base's owner sees in a list without
 * touching the page. Samuel's ruling 3 scopes guest writes to "edit existing
 * entries", and the cheapest honest reading of that is title + body. A caller
 * that sends more gets a 400 at the boundary, not a silent drop — zod's default
 * strip would have made the refusal invisible, so this object is `.strict()`.
 *
 * ⚠ `expectedVersion` IS THE ENTRY'S `updatedAt` and rides in the BODY, where
 * the workspace PATCH takes the same value in `X-Updated-At`. Optional: absent
 * means last-write-wins, present and stale means 412.
 */
export const ChannelLaneEntryUpdateSchema = z
  .object({
    title: z
      .string()
      .min(1)
      .max(300)
      .regex(noSlashRegex, noSlashMessage)
      .optional(),
    body: z.string().max(MAX_BODY_BYTES, bodyMaxMessage).optional(),
    expectedVersion: z.string().min(1).optional(),
  })
  .strict();
export type ChannelLaneEntryUpdateInput = z.infer<
  typeof ChannelLaneEntryUpdateSchema
>;
