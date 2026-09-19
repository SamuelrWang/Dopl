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
 * 🔒 **HTML ENTITIES IN A LABEL ARE DECODED AT THE BOUNDARY, ONCE (S35).**
 *
 * ⚠ **NOTHING IN THIS TREE EVER ESCAPED THEM.** Titles and names ride RAW from
 * the client to the column and back out again; the only `escapeHtml` that exists
 * is the web search popup's (`src/features/search/server/snippet.ts`), which
 * renders and stores nothing. So a stored `R&amp;D` was escaped by whatever
 * WROTE it — a client reading `innerHTML`, an agent pasting rendered HTML — and
 * it arrived with no signal at all: the row is valid, the charset rule passes,
 * and every surface prints `R&amp;D` forever. This transform is the first place
 * that is even noticed.
 *
 * ⚠ **ONE PASS, NEVER A LOOP.** `String.replace` does not re-scan what it
 * substitutes, so `&amp;lt;` becomes the literal `&lt;` and stops there. A loop
 * "until stable" would keep going and hand back `<` — rewriting a title a user
 * may have typed on purpose, and nothing downstream can tell the two apart.
 *
 * ⚠ **A SURROGATE OR OUT-OF-RANGE CODE POINT IS LEFT EXACTLY AS WRITTEN.**
 * `String.fromCodePoint` throws on both, and a 500 over a malformed entity in a
 * title is a worse answer than the title.
 */
const HTML_ENTITY_RE =
  /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos));/g;

/** The five NAMED forms. ⚠ `&#39;` / `&#x27;` are the numeric arm's job — one
 *  spelling of the apostrophe rule, not two. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/**
 * The normalizer. Exported because the path-write route mirrors the title rule
 * (`src/app/api/knowledge/bases/[baseId]/files/route.ts`) and a second decoder
 * would be a second opinion about what an entity is.
 */
export function decodeHtmlEntities(value: string): string {
  return value.replace(HTML_ENTITY_RE, (whole, dec?: string, hex?: string, named?: string) => {
    if (named !== undefined) return NAMED_ENTITIES[named];
    const cp = Number.parseInt(dec ?? hex ?? "", dec !== undefined ? 10 : 16);
    if (!Number.isInteger(cp) || cp < 1 || cp > 0x10ffff) return whole;
    // Lone surrogates are not scalar values; `fromCodePoint` throws on them.
    if (cp >= 0xd800 && cp <= 0xdfff) return whole;
    return String.fromCodePoint(cp);
  });
}

/**
 * Wrap a label rule so {@link decodeHtmlEntities} runs BEFORE it.
 *
 * ⚠ **THE ORDER IS THE POINT, NOT AN ACCIDENT OF CHAINING.** `&#10;` and
 * `&#x200B;` decode to exactly the structure-forging characters `NAME_RE` /
 * `SAFE_LABEL_RE` exist to reject, so a decode that ran AFTER the check would
 * store the newline the check had just certified absent. Decoding first also
 * means the length cap and `safeLabel`'s `.trim()` measure what actually lands
 * in the column — `&amp;` is five characters on the wire and one in storage.
 */
function decodedLabel<S extends z.ZodType<unknown, string>>(rule: S) {
  return z.string().transform(decodeHtmlEntities).pipe(rule);
}

/**
 * Same class as `NAME_RE` minus its '/' ban, which exists for the path resolver
 * and has nothing to say about a base name.
 *
 * Any workspace editor can rename a base straight through PostgREST without
 * passing this schema (`knowledge_bases_editor_update`), so the DB CHECK is the
 * load-bearing half; this line only produces a readable error.
 */
const KnowledgeBaseNameSchema = decodedLabel(safeLabel("Knowledge base name", 120));

// Folder / entry names. Path-addressing (`/foo/bar/baz.md`) is case-sensitive
// and byte-exact, so `Foo.md` and `foo.md` coexist. Enforced here:
//   - no '/' (would be unreachable via the path resolver)
//   - no leading/trailing whitespace (" foo" vs "foo" collide visually)
//   - no control / zero-width characters (would render identically to a
//     sibling and let an agent or attacker hide a duplicate)
// Exported so non-zod call sites (e.g. WriteFileSchema in the path-write route)
// validate against the same literal.
export const NAME_RE = /^(?!\s)(?!.*\s$)[^/\u0000-\u001F\u007F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]+$/;
export const NAME_INVALID_MESSAGE =
  "Cannot contain '/', control characters, zero-width characters, or leading/trailing whitespace";

// Backwards-compat aliases — kept so existing import sites don't churn.
const noSlashRegex = NAME_RE;
const noSlashMessage = NAME_INVALID_MESSAGE;

/**
 * THE ENTRY TITLE, ONE DECLARATION — create, update, the guest lane, and the
 * path-write route, which imports it rather than re-typing the chain it used to
 * carry under a "keep in sync" comment.
 *
 * ⚠ **THE PATH's LEAF IS NOT THIS FIELD AND IS DELIBERATELY NOT DECODED.**
 * `server/service-paths.ts › writeFileByPath` defaults an omitted title to the
 * last path segment, and a path is an ADDRESS: decoding it here would make
 * `write_file` create `R&D` under a path that then resolves to nothing, because
 * `resolvePath` matches segments against stored titles byte-for-byte. Those rows
 * are what the read-path signal and the backfill migration are for.
 */
export const EntryTitleSchema = decodedLabel(
  z.string().min(1, "Title is required").max(300).regex(noSlashRegex, noSlashMessage)
);

/** The folder name — same class, same decode, its own cap. */
const FolderNameSchema = decodedLabel(
  z.string().min(1, "Name is required").max(200).regex(noSlashRegex, noSlashMessage)
);

// Cap body size to 1 MB: unbounded markdown blows up the search_tsv generated
// column and the per-entry payload.
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
 * `level: "none"` is the delete, spelled: storage has no `'none'`, so this enum
 * is wider than `ChannelGrantLevel` by one wire-only value.
 *
 * `guestWrite` defaults to false for safety, not ergonomics: an omitted flag
 * must never inherit what the previous grant carried. The service also forces
 * it false at `agent_only`, where no human is in the audience.
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
     * the workspace Knowledge page. A request, not a decision:
     * `shared/tenancy/personal-container.ts › personalWriteWorkspaceId` is the
     * fence and it 403s rather than downgrading. It routes the row and nothing
     * stores it — it decides the `workspace_id`. Omitted/false = the container
     * the call is in.
     */
    homeScoped: z.boolean().optional(),
    /**
     * Create the base AND share it into this channel in one call — the /home
     * Shared section's create button (Samuel's ruling 2026-08-27). The grant is
     * always `level: 'visible'`, `guestWrite: false`; anything else is the
     * base's own sharing settings, where a three-state control belongs.
     *
     * A request, not a decision: the route fences the channel against the
     * caller's visible list (404 on a miss, never an oracle) and
     * `server/service-channel-grants.ts › setChannelKnowledgeGrant` owns the
     * rest. The base is rolled back if the grant fails, so this never half-lands.
     */
    shareToChannelId: z.string().uuid().optional(),
    /**
     * "I know this publishes into a room somebody else is standing in."
     *
     * A precondition, not a permission, required only on the narrow predicate —
     * `kind='link'` container, two or more active members, and the base landing
     * at `visibility: 'public'`. Ignored elsewhere, never refused;
     * `features/workspaces/server/shared-publish.ts` states predicate and 400.
     *
     * Not the same question as `shareToChannelId`: that asks for a
     * `channel_resource_grants` row (one channel, base stays private), this is
     * the WORKSPACE axis — every member of the container at once.
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
    /** Two-way: owner or workspace admin may change scope either direction;
     *  narrowing transitions are applied as-is by the service. */
    visibility: z.enum(["public", "private"]).optional(),
    accessMode: z.enum(["workspace", "teams"]).optional(),
    /** Declarative FULL set of team grants when `accessMode: 'teams'` — the
     *  service diffs against current rows. */
    teamGrants: z.array(KbTeamGrantSchema).max(50).optional(),
    /**
     * "I know this publishes into a room somebody else is standing in."
     *
     * A precondition, not a permission, required only on the narrow predicate —
     * `kind='link'` container, two or more active members, and the base landing
     * at `visibility: 'public'`. Ignored elsewhere, never refused;
     * `features/workspaces/server/shared-publish.ts` states predicate and 400.
     *
     * Not the same question as `shareToChannelId`: that asks for a
     * `channel_resource_grants` row (one channel, base stays private), this is
     * the WORKSPACE axis — every member of the container at once.
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
  name: FolderNameSchema,
  description: z.string().max(DESCRIPTION_MAX).nullable().optional(),
  position: z.number().int().min(0).optional(),
});
export type KnowledgeFolderCreateInput = z.infer<
  typeof KnowledgeFolderCreateSchema
>;

export const KnowledgeFolderUpdateSchema = z.object({
  name: FolderNameSchema.optional(),
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
  title: EntryTitleSchema,
  excerpt: z.string().max(DESCRIPTION_MAX).nullable().optional(),
  body: z.string().max(MAX_BODY_BYTES, bodyMaxMessage).optional(),
  entryType: KnowledgeEntryTypeSchema.optional(),
  position: z.number().int().min(0).optional(),
});
export type KnowledgeEntryCreateInput = z.infer<
  typeof KnowledgeEntryCreateSchema
>;

export const KnowledgeEntryUpdateSchema = z.object({
  title: EntryTitleSchema.optional(),
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
 * The missing fields are the point: `excerpt`, `entryType` and `position` are
 * writable on the workspace PATCH but none is an edit (they reorder, reclassify
 * or rewrite what the owner sees). Samuel's ruling 3 scopes guest writes to
 * editing existing entries — title + body. `.strict()` so a caller that sends
 * more gets a 400 rather than a silent strip.
 *
 * `expectedVersion` is the entry's `updatedAt`, in the BODY where the workspace
 * PATCH takes `X-Updated-At`. Absent = last-write-wins, stale = 412.
 */
export const ChannelLaneEntryUpdateSchema = z
  .object({
    title: EntryTitleSchema.optional(),
    body: z.string().max(MAX_BODY_BYTES, bodyMaxMessage).optional(),
    expectedVersion: z.string().min(1).optional(),
  })
  .strict();
export type ChannelLaneEntryUpdateInput = z.infer<
  typeof ChannelLaneEntryUpdateSchema
>;
