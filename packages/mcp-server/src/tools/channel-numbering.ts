/**
 * **WHICH NUMBER A RENDERED LINE PRINTS, AND THE ONE PLACE THAT DECIDES IT**
 * (2026-10-12, per-channel numbering B4).
 *
 * ⚠ **TWO NAMESPACES, AND THE WHOLE POINT IS THAT THEY NEVER MIX.**
 *
 *   `#N`            the PER-CHANNEL number — a display identity a person cites.
 *                   What this module returns.
 *   `seq N`         the TABLE-WIDE identity. A cursor, and the only thing
 *                   `since=`, `cursor=` and a hold may ever carry.
 *
 * So every `#…` in a rendered transcript moves to this module, and every
 * `since seq …` / `cursor=…` line stays EXACTLY as it is. A reader who copies a
 * number out of a cursor line is passing a cursor; a reader who copies one out of
 * a `#` is naming a message. Mixing them is the failure the design exists to
 * avoid — `#12` is a valid global seq in some other room, so a wrong-namespace
 * number resolves CONFIDENTLY to the wrong message rather than erroring.
 *
 * ⚠ **THE FALLBACK IS THE LIVE PATH TODAY, NOT A DEFENSIVE AFTERTHOUGHT.** The
 * migration that fills these columns is HELD
 * (`supabase/migrations-held/20261124120000`), so every row arrives with no
 * number and every caller below takes the `seq` arm. Rendered output is therefore
 * byte-identical to before this branch until Samuel applies it. That is what
 * makes the wave safe to merge ahead of the schema.
 *
 * ⚠ **WHY THE PARAMETER IS AN INTERSECTION AND NOT A CAST.** `channelSeq` and
 * `threadSeq` are on `ChannelMessage` in `packages/dopl-client/src/`, but this
 * package compiles against the client's COMMITTED `dist/`, which has not been
 * rebuilt yet (the merge owner commits the rebuild, as for mcp-server). Taking
 * `ChannelMessage & NumberedMessage` reads the fields with no `as` anywhere:
 * every field of `NumberedMessage` is optional, so a plain `ChannelMessage`
 * satisfies the intersection and callers pass one unchanged. ⚠ A cast would have
 * been the defect here, not the field name — `artifact-card.test.tsx` records
 * exactly that lesson. Once `dist/` carries the fields this annotation becomes
 * redundant and can be narrowed to `ChannelMessage`; nothing breaks either way.
 */

import type { ChannelMessage } from "@dopl/client";

/**
 * The numbering half of the message contract, stated locally.
 *
 * ⚠ All-optional on purpose — see the note above about `dist/`. This is a READ
 * shape, never a constructor: nothing in this package writes either field.
 */
export type NumberedMessage = {
  channelSeq?: number | null;
  threadSeq?: number | null;
};

/** A number a reader can cite: a positive integer, or nothing. */
function citable(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

/**
 * **THE NUMBER FOR `#N` ON A TRANSCRIPT LINE** — the per-channel one when the row
 * has it, else the global `seq`.
 *
 * ⚠ **NEVER FEED THE RESULT TO `since=`.** Once the migration lands this returns
 * a per-channel number, and a per-channel number used as a cursor reads another
 * room's history without erroring. The cursor is `m.seq`, taken directly.
 */
export function channelNoOf(m: ChannelMessage & NumberedMessage): number {
  return citable(m.channelSeq) ?? m.seq;
}

/**
 * **THE PER-THREAD COUNT — `#1`, `#2`, `#3` INSIDE ONE EXCHANGE** — or `null` when
 * the row is in no thread, or carries no number yet.
 *
 * ⚠ **THIS IS THE ONE THAT READS AS 1, 2, 3**, and it is why the per-channel
 * number is allowed to be gappy: a thread-scoped read hides nothing (it drops no
 * lifecycle row and never folds an artifact), so the count inside a thread is
 * dense even though the count across a channel cannot be. Threads are small —
 * median 2, max 103 (production, 2026-10-12).
 *
 * ⚠ **`null` IS NOT AN ERROR AND MUST NOT RENDER AS ONE.** A main-room post has
 * no thread number because it is in no thread; the caller omits the token rather
 * than printing `#null` or `#0`.
 */
export function threadNoOf(m: ChannelMessage & NumberedMessage): number | null {
  return citable(m.threadSeq);
}
