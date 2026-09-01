import { z } from "zod";
import { safeLabel } from "@/shared/lib/safe-label";

/**
 * Title, project tag and folder name are the three short labels chats puts
 * into agent narration (`dopl_chats` op="list", `dopl_search` hit headers),
 * so they are charset-bounded — see `@/shared/lib/safe-label`.
 * ⚠ `overview`, `learnings`, deliverable labels and message summary/verbatim
 * are NOT bounded and must not be: they are the transcript itself, rendered
 * as bodies under framing that says so.
 * `chats` / `chat_folders` carry no INSERT/UPDATE RLS policy, so the service
 * role is the only writer and this schema is the only gate before the DB
 * CHECK.
 */
const ChatTitleSchema = safeLabel("Chat title", 200);
const ChatProjectSchema = safeLabel("Project", 120);
/** Folder NAME (resolved / created by the service), not an id. */
const ChatFolderNameSchema = safeLabel("Folder name", 80);

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "agent"]),
  summary: z.string().min(1).max(4000),
  verbatim: z.string().min(1).max(20000).nullish(),
});

export const DeliverableSchema = z.object({
  label: z.string().min(1).max(300),
  done: z.boolean(),
});

const SourceSchema = z.enum([
  "claude-code",
  "claude-desktop",
  "codex",
  "cursor",
  "other",
]);
const VisibilitySchema = z.enum(["private", "public"]);
const AccessModeSchema = z.enum(["workspace", "teams"]);
const SessionDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine(
    (s) => {
      const [y, m, d] = s.split("-").map(Number);
      const date = new Date(Date.UTC(y, m - 1, d));
      return (
        date.getUTCFullYear() === y &&
        date.getUTCMonth() === m - 1 &&
        date.getUTCDate() === d
      );
    },
    { message: "Not a real calendar date" }
  );

/**
 * Agent export payload. `clientSessionId` is the idempotency key: re-export
 * UPDATES the existing chat, preserving by default — a header field is
 * overwritten only when passed, and the transcript is reconciled (upsert by
 * position), so op="append" messages survive. `folder` is a NAME, resolved
 * case-insensitively and created when missing. `format` is derived
 * server-side, never caller input.
 * ⚠ Preserve-on-omit fields (overview/source/visibility/deliverables/
 * learnings) are `.optional()` WITHOUT `.default()` — a default erases the
 * "caller didn't pass this" signal the re-export merge relies on. Fresh-create
 * defaults are applied in the service.
 */
export const ChatExportSchema = z.object({
  title: ChatTitleSchema,
  overview: z.string().max(2000).optional(),
  source: SourceSchema.optional(),
  project: ChatProjectSchema.nullish(),
  sessionDate: SessionDateSchema.optional(),
  clientSessionId: z.string().min(1).max(200).optional(),
  folder: ChatFolderNameSchema.optional(),
  visibility: VisibilitySchema.optional(),
  deliverables: z.array(DeliverableSchema).max(50).optional(),
  learnings: z.array(z.string().min(1).max(1000)).max(50).optional(),
  messages: z.array(ChatMessageSchema).min(1).max(500),
});
export type ChatExportInput = z.infer<typeof ChatExportSchema>;

export const ChatUpdateSchema = z
  .object({
    title: ChatTitleSchema.optional(),
    overview: z.string().max(2000).optional(),
    project: ChatProjectSchema.nullable().optional(),
    sessionDate: SessionDateSchema.optional(),
    folderId: z.string().uuid().nullable().optional(),
    folder: ChatFolderNameSchema.nullable().optional(),
    visibility: VisibilitySchema.optional(),
    accessMode: AccessModeSchema.optional(),
    /** Teams granted read access; only meaningful with accessMode 'teams'. */
    teamIds: z.array(z.string().uuid()).max(50).optional(),
    pinned: z.boolean().optional(),
    deliverables: z.array(DeliverableSchema).max(50).optional(),
    learnings: z.array(z.string().min(1).max(1000)).max(50).optional(),
  })
  .refine(
    (patch) => !(patch.folderId !== undefined && patch.folder !== undefined),
    { message: "Pass folderId or folder, not both" }
  )
  .refine(
    (patch) =>
      patch.teamIds === undefined ||
      (patch.visibility === "public" && patch.accessMode === "teams"),
    { message: "teamIds requires visibility 'public' + accessMode 'teams'" }
  )
  .refine(
    (patch) =>
      patch.visibility === undefined ||
      ((patch.folderId === undefined || patch.folderId === null) &&
        (patch.folder === undefined || patch.folder === null)),
    {
      message:
        "Can't set visibility while filing into a folder — filed chats inherit the folder's sharing",
    }
  )
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Empty patch",
  });
export type ChatUpdateInput = z.infer<typeof ChatUpdateSchema>;

export const ChatAppendSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1).max(500),
});
export type ChatAppendInput = z.infer<typeof ChatAppendSchema>;

export const ChatFolderCreateSchema = z.object({
  name: ChatFolderNameSchema,
});
export type ChatFolderCreateInput = z.infer<typeof ChatFolderCreateSchema>;

/** Folder rename and/or scope change. ⚠ Scope propagates to every chat filed
 *  in the folder — the folder's scope is authoritative. */
export const ChatFolderUpdateSchema = z
  .object({
    name: ChatFolderNameSchema.optional(),
    visibility: VisibilitySchema.optional(),
    accessMode: AccessModeSchema.optional(),
    /** Teams granted read access; only meaningful with accessMode 'teams'. */
    teamIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .refine(
    (patch) =>
      patch.teamIds === undefined ||
      (patch.visibility === "public" && patch.accessMode === "teams"),
    { message: "teamIds requires visibility 'public' + accessMode 'teams'" }
  )
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Empty patch",
  });
export type ChatFolderUpdateInput = z.infer<typeof ChatFolderUpdateSchema>;
