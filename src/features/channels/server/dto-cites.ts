/**
 * **THE ONE PLACE A ROW'S CITATION STATE IS DECIDED** (grammar B, 2026-10-12).
 *
 * `metadata` is peer-typed storage. This is the boundary where it becomes a
 * typed, three-state field (`lib/cites.ts › MessageCites`) that a renderer can
 * trust without parsing anything.
 *
 * ⚠ **THE STATE COMES FROM THE STAMP, NEVER FROM THE LIST.** `citeMode` present
 * means the row was written under grammar B, so its prose numbers are inert and
 * only the allowlist draws pills — and that is true whether it cited twenty
 * messages or none. Deriving the state from `cites` instead would collapse
 * "written under the rule, cited nothing" into "not written under the rule", and
 * every uncited message — the overwhelming majority — would get its typed `#12`
 * linkified again. That IS the defect the ruling is against, reached by reading
 * the wrong key.
 *
 * ⚠ **IT DEGRADES, IT NEVER THROWS.** A read renders a page; one malformed row
 * must not 500 it, and a bad entry is dropped rather than carried as a pill that
 * points nowhere. That is the opposite of the WRITE path, which refuses the send
 * outright (`service-writes-metadata-cites.ts`) — and the asymmetry is the point:
 * refuse while the author can still fix it, degrade once it is history.
 */

import {
  CITES_METADATA_KEY,
  CITE_MODE_METADATA_KEY,
  CITE_MODE_CURRENT,
  type MessageCites,
  type ResolvedCite,
} from "../lib/cites";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A positive integer, or `null` for anything else — including `true` and `"12"`. */
function positiveIntOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

/**
 * One stored entry, narrowed — `null` if it cannot be trusted.
 *
 * ⚠ **`messageId` AND `seq` ARE BOTH REQUIRED**, because each carries half the
 * job: the id is what navigation uses and the seq is what the body's number is
 * matched against. An entry missing either is unusable for drawing a pill, so it
 * is not kept as a half-citation.
 */
function citeOrNull(value: unknown): ResolvedCite | null {
  if (!isRecord(value)) return null;
  const messageId = typeof value.messageId === "string" ? value.messageId : null;
  const seq = positiveIntOrNull(value.seq);
  if (messageId === null || messageId === "" || seq === null) return null;
  return {
    messageId,
    seq,
    // ⚠ A MISSING NUMBER IS `null`, NOT DROPPED: the renderer's match order
    // (`lib/cites.ts › findCite`) asks for `no` first, and `undefined` vs `null`
    // would be two spellings of "this row has no per-channel number yet".
    no: positiveIntOrNull(value.no),
    thread: typeof value.thread === "string" ? value.thread : null,
  };
}

/**
 * **WHICH OF THE THREE STATES THIS ROW IS IN.**
 *
 * ⚠ **THE STAMP IS CHECKED FOR EQUALITY WITH THE CURRENT MODE, NOT MERELY FOR
 * PRESENCE.** A row stamped with a mode this build does not know (a newer server
 * writing mode 3, read by an older one) is NOT claimed as grammar B here — it
 * falls back to the legacy face, which is the only behaviour an older build can
 * actually honour. Treating an unknown mode as "current" would have it apply mode
 * 2's allowlist rules to a row written under rules it has never seen.
 */
export function messageCitesOf(metadata: unknown): MessageCites {
  if (!isRecord(metadata)) return null;
  if (metadata[CITE_MODE_METADATA_KEY] !== CITE_MODE_CURRENT) return null;

  const raw = metadata[CITES_METADATA_KEY];
  if (!Array.isArray(raw)) return [];

  const out: ResolvedCite[] = [];
  for (const entry of raw) {
    const cite = citeOrNull(entry);
    if (cite !== null) out.push(cite);
  }
  return out;
}
