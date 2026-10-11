import "server-only";
import type {
  ChannelArtifact,
  ChannelFoldedArtifact,
  ChannelMessage,
  ChannelReadEntry,
} from "../types";
import { mapArtifactRow } from "./dto";
import * as repoArtifacts from "./repository-artifacts";

/**
 * THE ARTIFACT FOLD, read side — split out of `service-artifacts.ts` (cleanup
 * C13, a pure move) so that file stays under the §1 cap. The addressing pin
 * (`readNamesMessages`), the pure fold (`foldEntries`) and the page wrapper
 * (`foldPage`) live here; the writes and the single-card read stay there.
 * ⚠ Still off the `service.ts` barrel on purpose: a handler reaching for the
 * fold would be deciding the addressing pin a second time. Its one caller is
 * `service-reads.ts › readTranscript`.
 */

/**
 * 🔒 **DOES THIS READ NAME MESSAGES?** — the addressing PIN of design §3, and
 * the one rule that keeps every citation in a room from degrading into "it is
 * in that box somewhere".
 *
 * "Folding may only affect the DEFAULT page. A read that NAMES a message — an
 * explicit seq, or a range containing it — returns the message itself, folded or
 * not." Spelled against the query shapes this codebase actually has:
 *
 *   - **`thread` set** → a thread-scoped read is already a named subset, and
 *     the design folds MAIN-ROOM runs. Never folds.
 *   - **`since` AND `before` together** → a BOUNDED WINDOW, which is exactly
 *     the "range containing it" the pin describes: a caller resolving `#1119`
 *     asks for the window around it and must get the message. Never folds.
 *   - **`since` alone / `before` alone / neither** → a CURSOR or the newest
 *     page. That is the default read, and it folds.
 *
 * ⚠ A cursor is NOT a range naming a message: `since` names where to start, not
 * what to return, and treating it as naming would mean nothing ever folds —
 * the incremental read IS the default read for every agent on the wire.
 *
 * ⚠ **CHEAP TO STATE TODAY, EXPENSIVE TO RETROFIT** once a caller assumes
 * otherwise, which is why the design pinned it before any code existed.
 */
export function readNamesMessages(query: {
  since?: number;
  before?: number;
  thread?: string;
}): boolean {
  if (query.thread !== undefined) return true;
  return query.since !== undefined && query.before !== undefined;
}

/**
 * THE FOLD — a page of messages becomes a page of ENTRIES.
 *
 * ⚠ **PURE, AND THAT IS DELIBERATE**: it takes the page and the artifact facts
 * already fetched, so the rule is testable without a database and cannot drift
 * into doing its own reads.
 *
 * ⚠ **THE CARD RENDERS AT THE POSITION OF ITS LOWEST MEMBER SEQ ON THIS PAGE**,
 * and every other member of that artifact on the page disappears into it —
 * ONE entry per artifact per page, no matter how many of its members are here.
 *
 * ⚠ **NON-MEMBERS INSIDE THE SPAN RENDER NORMALLY** (decision 5, contiguity).
 * An artifact holds an arbitrary SET, so a card can appear to interrupt a
 * conversation it does not contain all of. The alternative — silently boxing a
 * bystander's message to keep a range tidy — is worse, and it would drag the
 * authority question into every create.
 *
 * ⚠ **A MEMBER WHOSE ARTIFACT WE COULD NOT LOAD RENDERS AS A MESSAGE.** Missing
 * facts must degrade to "unfolded", never to "dropped": a transcript that
 * silently loses rows because a card lookup failed is data loss on a read path.
 */
export function foldEntries(
  messages: ChannelMessage[],
  artifacts: ReadonlyMap<string, ChannelArtifact>,
  spans: ReadonlyMap<string, repoArtifacts.ArtifactSpan>
): ChannelReadEntry[] {
  const out: ChannelReadEntry[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    const id = message.artifactId ?? null;
    const artifact = id ? artifacts.get(id) : undefined;
    const span = id ? spans.get(id) : undefined;
    if (!id || !artifact || !span) {
      out.push({ type: "message", message });
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const folded: ChannelFoldedArtifact = {
      artifact,
      count: span.count,
      firstSeq: span.firstSeq,
      lastSeq: span.lastSeq,
    };
    out.push({ type: "artifact", folded });
  }
  return out;
}

/**
 * The whole read side in one call: fold a page unless the query NAMES messages.
 *
 * ⚠ **TWO READS, BOTH BOUNDED BY THE PAGE**, and neither runs when the page has
 * no folded rows — an ordinary transcript pays nothing for this feature.
 */
export async function foldPage(
  channelId: string,
  messages: ChannelMessage[],
  query: { since?: number; before?: number; thread?: string }
): Promise<ChannelReadEntry[]> {
  // ⚠ A THUNK, not a computed array: both guards answer with the same
  // un-folded page, but the folding path must not pay to build one it discards
  // — "an ordinary transcript pays nothing for this feature" is the claim above.
  const unfolded = () =>
    messages.map((message) => ({ type: "message", message }) as const);
  if (readNamesMessages(query)) {
    return unfolded();
  }
  const ids = [
    ...new Set(
      messages
        .map((m) => m.artifactId ?? null)
        .filter((id): id is string => id !== null)
    ),
  ];
  if (ids.length === 0) {
    return unfolded();
  }
  const [rows, spans] = await Promise.all([
    repoArtifacts.listArtifactsByIds(channelId, ids),
    repoArtifacts.artifactSpans(channelId, ids),
  ]);
  const artifacts = new Map(rows.map((r) => [r.id, mapArtifactRow(r)]));
  return foldEntries(messages, artifacts, spans);
}
