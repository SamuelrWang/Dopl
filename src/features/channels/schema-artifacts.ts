import { z } from "zod";
import { safeLabel, safeOptionalProse } from "@/shared/lib/safe-label";

/**
 * THE ARTIFACT WRITE SCHEMAS — `op="artifact"`'s four actions (design #1220 §5,
 * accepted wholesale at #1222).
 *
 * ⚠ ITS OWN FILE, re-exported by `schema.ts`, on the precedent
 * `schema-reads.ts` / `schema-members.ts` / `schema-sessions.ts` already set:
 * `schema.ts` is the BARREL, so every existing `@/features/channels/schema`
 * import is unchanged and there is still no second path to a symbol.
 */

/**
 * ⚠ **THE CEILING ON ONE CREATE.** An artifact is a wrap-up of a run, not an
 * archive of a room, and the fold statement is a single `IN (...)` — an
 * unbounded list would be an unbounded query. A caller with more to fold uses
 * `add`, which is the op that exists for it.
 */
export const ARTIFACT_CREATE_MAX_MESSAGES = 200;

/** ⚠ Same class as `channels.name` and `channel_tasks.title`, by ruling: these
 *  strings render into `dopl_channel` results, so they take the bounds this tree
 *  already sets rather than inventing a third rule. */
const ArtifactNameSchema = safeLabel("Artifact name", 200);

/**
 * ⚠ SUMMARY IS **PROSE**, NOT A LABEL, and the distinction is the one
 * `safe-label.ts` draws: a label is spliced into a line we wrote, prose is
 * rendered as itself. A summary is a sentence or two about what the run was, so
 * newlines are legitimate; it is neutralized at render where it is flattened
 * onto one line. Empty is legal and is the default — an artifact with a good
 * name and no summary is a normal thing to make.
 */
const ArtifactSummarySchema = safeOptionalProse("Artifact summary", 2000);

/**
 * ⚠ **MEMBERS ARE NAMED BY `seq`, NOT BY MESSAGE ID**, and that is the design's
 * vocabulary rather than a shortcut: `seq` is what the read prints, what a
 * citation quotes (`#1119`) and what an agent has in hand after reading a room.
 * Making the caller resolve ids first would be a second addressing scheme for
 * the same rows.
 *
 * ⚠ NON-EMPTY. A create that folds nothing is an artifact over no messages —
 * a card that stands in for nothing, which renders as a hole in the transcript.
 */
const ArtifactSeqsSchema = z
  .array(z.coerce.number().int().positive())
  .min(1, { error: "Name at least one message seq to fold" })
  .max(ARTIFACT_CREATE_MAX_MESSAGES);

/**
 * `op="artifact"` — the four actions, as a DISCRIMINATED UNION on `action`.
 *
 * ⚠ DISCRIMINATED rather than a bare object with optional fields: the wire
 * shape is `{action, …}` and a plain object would make every field
 * optional-by-omission, so a `dissolve` that forgot its `artifact` would parse
 * and then fail somewhere less honest.
 *
 * ⚠ **THERE IS NO `delete`, AND THAT IS THE WHOLE SAFETY ARGUMENT** (design
 * §5): `dissolve` clears the column from every member and retires the card.
 * Nothing is deleted, which is the same non-destructive shape as every other op
 * on this tool — and it is why offering dissolve at all is safe.
 */
export const ArtifactActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: ArtifactNameSchema,
    summary: ArtifactSummarySchema.optional().default(""),
    messages: ArtifactSeqsSchema,
    /**
     * ⚠ **THE DESIGN ASKS FOR THIS BY NAME** (§5), for the reason `send` has
     * one: "an agent retrying a create with no key makes a second artifact over
     * messages the first one already took, and then half the run is in each."
     * ⚠ Optional, because a PERSON pressing a button in the app is not
     * retrying; it is agents that need it, and the tool description says so.
     */
    clientMsgId: z.string().trim().min(1).max(200).optional(),
  }),
  z.object({
    action: z.literal("add"),
    artifact: z.string().uuid(),
    /** ⚠ ONE message in — the design's `add` is singular, and a bulk arm would
     *  need its own partial-success shape. Loop it, or create with the set. */
    message: z.coerce.number().int().positive(),
  }),
  z.object({
    action: z.literal("remove"),
    artifact: z.string().uuid(),
    /** ⚠ The per-message UN-BOX, free for the message's AUTHOR and for the
     *  artifact's CREATOR (decision 1). The service decides that, not this. */
    message: z.coerce.number().int().positive(),
  }),
  z.object({
    action: z.literal("dissolve"),
    artifact: z.string().uuid(),
  }),
]);
export type ArtifactActionInput = z.infer<typeof ArtifactActionSchema>;
