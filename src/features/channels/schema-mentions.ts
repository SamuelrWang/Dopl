import { z } from "zod";
import { CHANNEL_MENTION_MARK_MAX } from "./constants";

/**
 * The MENTIONS INBOX's write contract. Its own module rather than a block in
 * `schema.ts` for the reason that file's siblings exist (`schema-sessions.ts`):
 * that one is at the edge of the 500-line cap, and a schema is the last thing
 * that should be split under pressure later.
 */

/**
 * Mark mentions read — ONE shape for both the single click and "Mark all read".
 *
 * ⚠ MARK-ALL SENDS IDS, not a flag. Three reasons, and the first is the rule:
 *  1. the badge is CLIENT-SIDE arithmetic over the projection (wiring plan
 *     Phase 6, decision 3), so a server-side "all" would be a SECOND derivation
 *     of the same set, free to disagree with the one on screen;
 *  2. the list is BOUNDED and says when it clipped (INVARIANTS §9). "Mark all"
 *     over a clipped page can only honestly mean the page — and naming the ids
 *     makes that true by construction instead of by a comment;
 *  3. one shape means one authorization path. Every id is checked to be a
 *     message IN THIS CHANNEL that really tags the caller
 *     (`server/repository-mentions.ts › findMentionMessageIds`).
 *
 * Idempotent: re-marking is `ON CONFLICT DO NOTHING`, so a double click is a
 * 200 no-op and never an error.
 */
export const MentionReadSchema = z.object({
  messageIds: z
    .array(z.string().uuid())
    .min(1)
    .max(CHANNEL_MENTION_MARK_MAX),
});
export type MentionReadInput = z.infer<typeof MentionReadSchema>;
