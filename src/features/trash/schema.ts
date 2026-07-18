import { z } from "zod";

/**
 * Request body for the unified workspace Trash restore/purge routes.
 * `kind` is left as a free string (not a strict enum) on purpose: the
 * dispatch in `server/service.ts` is the single source of truth for which
 * kinds exist, and an unrecognized kind must surface there as a 400 so the
 * validation lives in one place.
 */
export const TrashActionSchema = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
});

export type TrashAction = z.infer<typeof TrashActionSchema>;
