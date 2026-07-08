import { z } from "zod";

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
 * re-exporting the same session updates the existing chat (header and
 * transcript are replaced wholesale). `folder` is a folder NAME —
 * resolved case-insensitively against the caller's folders, created
 * when missing. The chat's `format` is derived server-side from the
 * messages' verbatim mix — it is not caller input.
 */
export const ChatExportSchema = z.object({
  title: z.string().min(1).max(200),
  overview: z.string().max(2000).default(""),
  source: SourceSchema.default("other"),
  project: z.string().min(1).max(120).nullish(),
  sessionDate: SessionDateSchema.optional(),
  clientSessionId: z.string().min(1).max(200).optional(),
  folder: z.string().min(1).max(80).optional(),
  visibility: VisibilitySchema.default("private"),
  deliverables: z.array(DeliverableSchema).max(50).default([]),
  learnings: z.array(z.string().min(1).max(1000)).max(50).default([]),
  messages: z.array(ChatMessageSchema).min(1).max(500),
});
export type ChatExportInput = z.infer<typeof ChatExportSchema>;

export const ChatUpdateSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    overview: z.string().max(2000).optional(),
    project: z.string().min(1).max(120).nullable().optional(),
    sessionDate: SessionDateSchema.optional(),
    folderId: z.string().uuid().nullable().optional(),
    folder: z.string().min(1).max(80).nullable().optional(),
    visibility: VisibilitySchema.optional(),
    pinned: z.boolean().optional(),
    deliverables: z.array(DeliverableSchema).max(50).optional(),
    learnings: z.array(z.string().min(1).max(1000)).max(50).optional(),
  })
  .refine(
    (patch) => !(patch.folderId !== undefined && patch.folder !== undefined),
    { message: "Pass folderId or folder, not both" }
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
  name: z.string().min(1).max(80),
});
export type ChatFolderCreateInput = z.infer<typeof ChatFolderCreateSchema>;

export const ChatFolderRenameSchema = z.object({
  name: z.string().min(1).max(80),
});
export type ChatFolderRenameInput = z.infer<typeof ChatFolderRenameSchema>;
