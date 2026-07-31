import { z } from "zod";
import { safeLabel } from "@/shared/lib/safe-label";

/**
 * A chat title, its project tag and its folder name are the three short labels
 * the chats feature puts into agent narration: `dopl_chats` op="list" prints
 * one line per chat (title, folder, project) and `dopl_search` prints titles
 * as hit headers. Bounded on the charset for the same reason as every other
 * label — see `@/shared/lib/safe-label`.
 *
 * `overview`, `learnings`, the deliverable labels and the message
 * summary/verbatim pair are NOT bounded: those are the transcript, the payload
 * the feature exists to hand an agent, and they are rendered as bodies under
 * framing that says what they are.
 *
 * `chats` and `chat_folders` carry no INSERT/UPDATE RLS policy (verified
 * against prod), so unlike skills or knowledge bases these rows can only be
 * written by the service role — this schema really is the only writer, and the
 * DB CHECK is the layer that survives the next one.
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

const SourceSchema = z.enum(["claude-code", "claude-desktop", "cursor", "other"]);
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
 * Agent export payload. `clientSessionId` is the idempotency key:
 * re-exporting the same session UPDATES the existing chat, preserving by
 * default — a header field is only overwritten when the caller passes it,
 * and the transcript is reconciled (upsert by position), never destroyed,
 * so messages added via op="append" survive a re-export. `folder` is a
 * folder NAME — resolved case-insensitively against the caller's folders,
 * created when missing. The chat's `format` is derived server-side from
 * the messages' verbatim mix — it is not caller input.
 *
 * The preserve-on-omit fields (overview/source/visibility/deliverables/
 * learnings) are intentionally left `.optional()` WITHOUT a `.default()`:
 * a default would erase the "caller didn't pass this" signal the re-export
 * merge relies on. Defaults for a fresh create are applied in the service.
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

/**
 * Folder update — rename and/or scope change. Changing the scope
 * propagates to every chat filed in the folder (the folder's scope is
 * authoritative for its chats).
 */
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
