/**
 * THE ONE @-MENTION PARSER. Shared by the SERVER's resolution at insert
 * (`server/service-writes-metadata-mentions.ts`, which stamps the resolved id
 * set into reserved `metadata.mentionedUserIds`) and by the CLIENT's transcript
 * highlight (`components/channels-v2/transcript.tsx`).
 *
 * ⚠ ONE PARSER, DELIBERATELY. A second copy is how the two ends disagree about
 * what counts as a tag: the server stamps nobody, the transcript tints a name,
 * and the operator reads a tint as "they were told". This module is pure and
 * framework-free precisely so both trees can hold it.
 *
 * ⚠ NOT AN ADDRESSING RULE. Addressing is `metadata.to_user_id`, which comes
 * from the validated `toUserId` and nowhere else (INVARIANTS §5). A mention
 * puts a message in somebody's Tags inbox; it starts nobody's agent, and
 * nothing here may ever be read as consent to spawn.
 *
 * ── THE MATCH RULE, IN FULL ─────────────────────────────────────────────────
 *  1. A TOKEN is `@` followed by one or more characters that are neither
 *     whitespace nor `@`. A display name with a space is therefore reachable
 *     only by its SQUASHED form (`@DianaTaylor`) or its first word (`@Diana`) —
 *     `@Diana Taylor` is the token `@Diana` followed by prose.
 *  2. Trailing punctuation comes off the token ({@link TRAILING_PUNCTUATION}),
 *     so `@diana,` and `@diana` are the same handle. Leading punctuation does
 *     NOT: `@(diana` is a different handle and resolves to nobody, because
 *     guessing where a handle starts is how `@…` inside a URL becomes a tag.
 *  3. Comparison is lowercase EXACT EQUALITY against the roster-derived handle
 *     set. Never a prefix, never a substring — the composer's autocomplete is
 *     substring-matched because a human then PICKS one; a resolver that guessed
 *     would tag `@dan` at Daniel.
 *  4. Each roster member claims up to four handles, from their display name and
 *     from the local part of their email: the whole source with whitespace
 *     removed, and its first whitespace-delimited word.
 *  5. ⚠ AMBIGUITY FAILS CLOSED. A handle claimed by two DIFFERENT members
 *     resolves to NOBODY. The alternative is that the order a roster read
 *     happens to return decides whose inbox a message lands in — silent, and
 *     wrong for exactly one of the two people every time.
 *
 * The author's own id is dropped by the SERVER resolver, not here: "who does
 * this text name" and "who should be told" are different questions, and the
 * transcript still tints your own name where you wrote it.
 */

/** Roster row reduced to what the match rule reads. Structural on purpose:
 *  the server's `channel_members` + profile join and the client's
 *  `ChannelMember` both satisfy it without either tree importing the other. */
export interface MentionCandidate {
  userId: string;
  displayName: string | null;
  email: string | null;
}

/**
 * ⚠ Used ONLY with `String.prototype.split`, which clones the regex per spec —
 * so the `g` flag cannot leak a `lastIndex` between calls. Do not `.exec()` it.
 * The capture group is load-bearing: `split` keeps the delimiters, which is how
 * the transcript rebuilds the line with the tokens still in place.
 */
export const MENTION_TOKEN_RE = /(@[^\s@]+)/g;

/** Stripped from the END of a token. A handle cannot end in one of these, and
 *  prose routinely does. */
const TRAILING_PUNCTUATION = /[.,:;!?'"`)\]}>]+$/;

/** Handle -> the member it names, or `null` when two or more members claim it
 *  (rule 5: ambiguity resolves to nobody). */
export type MentionIndex = ReadonlyMap<string, string | null>;

/** The handles one member answers to. May repeat; the index de-dupes. */
function handlesOf(candidate: MentionCandidate): string[] {
  const out: string[] = [];
  const sources = [
    candidate.displayName,
    candidate.email ? candidate.email.split("@")[0] : null,
  ];
  for (const source of sources) {
    const trimmed = (source ?? "").trim();
    if (trimmed.length === 0) continue;
    const squashed = trimmed.replace(/\s+/g, "").toLowerCase();
    if (squashed.length > 0) out.push(squashed);
    const first = trimmed.split(/\s+/)[0].toLowerCase();
    if (first.length > 0) out.push(first);
  }
  return out;
}

/**
 * Roster -> handle index. ⚠ A handle two members claim is mapped to `null`
 * rather than dropped, so {@link resolveMentionToken} can tell "no such handle"
 * from "this handle names more than one person" if a surface ever wants to say
 * so. Both resolve to nobody today.
 */
export function buildMentionIndex(
  candidates: readonly MentionCandidate[]
): MentionIndex {
  const index = new Map<string, string | null>();
  for (const candidate of candidates) {
    for (const handle of handlesOf(candidate)) {
      if (!index.has(handle)) {
        index.set(handle, candidate.userId);
        continue;
      }
      const held = index.get(handle);
      if (held !== null && held !== candidate.userId) index.set(handle, null);
    }
  }
  return index;
}

/** A token (`@diana,`) -> its comparable handle (`diana`), or null when the
 *  token carries no handle at all. */
export function mentionHandleOf(token: string): string | null {
  if (!token.startsWith("@")) return null;
  const handle = token.slice(1).replace(TRAILING_PUNCTUATION, "").toLowerCase();
  return handle.length > 0 ? handle : null;
}

/** The member a single token names, or null. The transcript's per-token
 *  question; {@link resolveMentions} is the whole-body one. */
export function resolveMentionToken(
  token: string,
  index: MentionIndex
): string | null {
  const handle = mentionHandleOf(token);
  if (handle === null) return null;
  return index.get(handle) ?? null;
}

/** Every `@…` run in a body, in order, delimiters kept by `split`. */
export function mentionTokensOf(body: string): string[] {
  if (!body.includes("@")) return [];
  return body.split(MENTION_TOKEN_RE).filter((part) => part.startsWith("@"));
}

/**
 * THE WHOLE-BODY RESOLUTION: every roster member the text names, de-duped, in
 * first-appearance order.
 *
 * ⚠ Cheap-exit on a body with no `@` at all, which is the common post. The
 * server's resolver leans on that to keep its roster read off the write path
 * for every message that could not possibly mention anybody.
 */
export function resolveMentions(
  body: string,
  candidates: readonly MentionCandidate[]
): string[] {
  const tokens = mentionTokensOf(body);
  if (tokens.length === 0) return [];
  const index = buildMentionIndex(candidates);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    const userId = resolveMentionToken(token, index);
    if (userId === null || seen.has(userId)) continue;
    seen.add(userId);
    out.push(userId);
  }
  return out;
}

/**
 * RESERVED metadata key carrying the server's own resolution — the id set of
 * every roster member this message tags, author excluded.
 *
 * ⚠ STRIPPED FROM CALLER INPUT UNCONDITIONALLY and re-stamped only from the
 * server's resolution (INVARIANTS §5; the strip lives in
 * `server/service-writes-metadata.ts › resolvePostMetadata`). A caller-settable
 * mention set is a notification-forgery primitive: it decides whose Tags inbox
 * a message lands in, and Phase 7 gates NOTIFICATIONS on the same key.
 *
 * Absent means "this message tags nobody" — the key is stamped only when the
 * set is non-empty, so no existing row shape changes.
 */
export const MENTIONS_METADATA_KEY = "mentionedUserIds";

/** The stamped id set of a stored message, or `[]`. ⚠ Tolerant by
 *  construction: rows written before Phase 6 carry no key, and a row whose
 *  value is not an array of strings is read as no mention rather than trusted
 *  into a filter. */
export function mentionedUserIdsOf(
  metadata: Record<string, unknown> | null | undefined
): string[] {
  const value = metadata?.[MENTIONS_METADATA_KEY];
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string");
}
