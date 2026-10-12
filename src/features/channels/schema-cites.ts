import { z } from "zod";

import { CHANNEL_CITES_MAX } from "./constants";

/**
 * **A CITATION ON THE WIRE** — grammar B's field, validated (2026-10-12).
 *
 * One entry names ONE message, by exactly one of two explicitly different
 * numbers, plus an optional thread the cited row must belong to.
 *
 * ⚠ **EXACTLY ONE OF `no` / `seq`, NAMED, NEVER INFERRED.** `#12` is a valid
 * per-channel number AND a valid global `seq` in some other room, so a single
 * untagged number cannot be resolved without guessing — and a guess here
 * resolves CONFIDENTLY to the wrong message rather than failing. The caller says
 * which namespace it means or the send is refused; the `ambiguous_slug` posture
 * (F-701), applied to a number instead of a slug.
 *
 * ⚠ **NO `z.coerce`, AND THIS IS THE DE-DUPE PRECEDENT RATHER THAN THE READ-ARG
 * ONE** (`schema-collab.ts › ConsentMessageSeqSchema`). `z.coerce.number()` turns
 * `""` and `[]` into 0 and `true` into **1** — and 1 is a perfectly good
 * citation, so a junk value would manufacture a confident pill at message one.
 * The read args in `schema-reads.ts` coerce because MCP clients send numbers as
 * strings and a bad cursor is merely a bad page; a citation is a POINTER, and the
 * same leniency here invents a destination.
 *
 * ⚠ **A NUMERIC STRING IS STILL ACCEPTED, DELIBERATELY** — MCP clients do send
 * `"12"` — but through an explicit digits-only transform, which `true`, `""` and
 * `[]` cannot pass. That is the whole difference between accepting a string and
 * coercing anything.
 */
const CiteNumberSchema = z.union([
  z.number().int().positive(),
  z
    .string()
    .regex(/^\d+$/, { error: "a citation number must be digits only" })
    .transform(Number)
    .refine((n) => Number.isSafeInteger(n) && n > 0, {
      error: "a citation number must be a positive integer",
    }),
]);

export const CiteInputSchema = z
  .object({
    /**
     * The PER-CHANNEL number — the `#N` a reader sees on a row in this channel.
     *
     * ⚠ Unresolvable until the held numbering migration
     * (`supabase/migrations-held/20261122120000`) is applied, because the column
     * it reads does not exist yet. Refused explicitly rather than silently
     * dropped — see `service-writes-metadata-cites.ts`.
     */
    no: CiteNumberSchema.optional(),
    /** The table-wide `seq` — what `#NNNN` has always meant and what reads hand back. */
    seq: CiteNumberSchema.optional(),
    /** The thread the cited row must belong to, when the caller knows it. */
    thread: z.string().trim().min(1).max(200).optional(),
  })
  .refine((c) => (c.no === undefined) !== (c.seq === undefined), {
    error: "Give a citation exactly one of `no` (per-channel) or `seq` (global).",
  });

export type CiteInput = z.infer<typeof CiteInputSchema>;

/**
 * The field as it arrives on a send.
 *
 * ⚠ **AN EMPTY ARRAY IS A REAL VALUE, NOT A MISSING ONE.** `cites: []` says "I
 * cited nothing", which under grammar B is the common case and is exactly what
 * every un-citing post means once the stamp is in place. Nothing may normalise it
 * to `undefined`.
 */
export const CitesInputSchema = z.array(CiteInputSchema).max(CHANNEL_CITES_MAX);
