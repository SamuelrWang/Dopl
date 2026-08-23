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
 *  6. ⚠ CODE DOES NOT TAG. A handle inside an inline code span or a fenced code
 *     block names NOBODY ({@link maskCodeRegions}) — see THE CODE RULE below.
 *  7. ⚠ MARKUP IS NOT A HANDLE, IN BOTH DIRECTIONS ({@link maskMarkupRegions},
 *     {@link TRAILING_PUNCTUATION}, {@link TRAILING_HTML_TAG}). Delimiters that
 *     WRAP a handle come off it, so `**@diana**`, `~~@diana~~` and
 *     `<b>@diana</b>` all tag; text markdown reads as structure rather than as
 *     words is blanked, so an escaped `\@diana`, a link/image DESTINATION and a
 *     link reference definition tag nobody. Every case is a MEASURED
 *     disagreement with the transcript's tint, not a guess — F-266.
 *
 * The author's own id is dropped by the SERVER resolver, not here: "who does
 * this text name" and "who should be told" are different questions, and the
 * transcript still tints your own name where you wrote it.
 *
 * ── THE CODE AND MARKUP RULES LIVE IN `mentions-mask.ts` ────────────────────
 * Rules 6 and 7 are enforced by masking, and both the masks and the reasoning
 * that bought them moved into `lib/mentions-mask.ts` at the 2026-08-22 split.
 * ⚠ The short version, because a reader here must not conclude the rules are
 * optional: code is QUOTED TEXT and tags nobody — measured, not theorised, after
 * two agents writing DOCUMENTATION about @-tagging put backticked handles in
 * their bodies and TAGGED BOTH OPERATORS for real (channel seqs 647 / 653,
 * 2026-08-21). Markup is not a handle either, in both directions. The full
 * argument, and the measurement each mask answers to, is in that file.
 * ── TWO MECHANISMS, ONE OUTCOME — AND EXACTLY ONE KNOWN GAP ─────────────────
 * They are still two different predicates (the renderer lexes with `marked`, the
 * server masks text) and that is not going to change without moving the server
 * onto `marked`. What changed on 2026-08-22 (F-266, RESOLVED) is that they now
 * AGREE on every shape anybody measured but one.
 *
 * ⚠ THE AGREEMENT IS A MEASUREMENT AND IT IS RE-RUNNABLE, which is the only
 * reason it is safe to write down. `mentions-tint-parity.test.ts` walks
 * `marked` the way `message-markdown.tsx` walks it, collects every string that
 * reaches `MentionText`, and asserts tint === stamp over the whole case table.
 * **It is the guard; this paragraph is only its summary.** Before this, the
 * SPA suite pinned the tint for `**@dianataylor**` while the server stamped
 * nobody — a test on each side, agreeing with neither.
 *
 * ⚠ THE ONE SURVIVING GAP IS INDENTED (four-space) CODE: `marked` calls it code
 * and does not tint; this masker does not model it and the server tags. It is
 * excluded from the parity table BY NAME, with the reason, so the exclusion is a
 * decision a reader can see rather than a case nobody thought of. See
 * {@link maskCodeRegions}.
 *
 * ⚠ AUTOLINKS LOOK LIKE A GAP AND ARE NOT ONE. A `<https://…/@handle>` and a
 * bare `https://…/@handle` both TINT — `marked` makes the url its own link TEXT
 * — and both tag. Making a URL's `@` stop tagging would break that agreement,
 * so it is not a fix; it is a new divergence wearing a fix's clothes.
 */

import { maskNonTaggingRegions } from "./mentions-mask";

/**
 * ⚠ THE MASKS ARE RE-EXPORTED, NOT RE-DECLARED. `mentions-mask.ts` is the split
 * half of this module (2026-08-22); every existing `lib/mentions` import keeps
 * working, and there is no second path to the same symbol.
 */
export {
  maskCodeRegions,
  maskMarkupRegions,
  maskNonTaggingRegions,
} from "./mentions-mask";

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

/**
 * Stripped from the END of a token. A handle cannot end in one of these, and
 * prose routinely does.
 *
 * ⚠ `*`, `_` AND `~` JOINED THIS CLASS ON 2026-08-22 (F-266), AND THAT IS THE
 * LOAD-BEARING HALF OF THE FIX. `**@diana**` yields the token `@diana**`, which
 * resolved to nobody while the transcript tinted it — so a BOLD escalation, which
 * is exactly how an agent writes "a human has to see this", showed a highlight
 * and stamped an empty set. Measured: `**`, `*`, `__`, `_` and `~~` all tinted
 * and all stamped nothing.
 *
 * ⚠ THE `@(diana` ARGUMENT DOES NOT APPLY, because these are TRAILING. Leading
 * punctuation still comes off nothing (rule 2): guessing where a handle STARTS is
 * how `@…` inside a URL becomes a tag, and that reasoning is about the front of
 * the token only.
 *
 * ⚠ THE RESIDUAL IS A HANDLE WHOSE LAST CHARACTER IS ONE OF THESE — `@diana_`
 * clips to `diana`. That is a PRE-EXISTING class, not a new one: a display name
 * ending in `!` or `.` has always clipped the same way, and `insertableHandle`
 * has always been able to offer such a handle. `_` is legal INSIDE a handle and
 * is untouched (`@diana_taylor` resolves whole — pinned in `mentions.test.ts`),
 * which is the case the finding asked to verify before adding it.
 */
const TRAILING_PUNCTUATION = /[.,:;!?'"`)\]}>*_~]+$/;

/**
 * One trailing HTML tag, stripped BEFORE the punctuation class gets to it.
 *
 * ⚠ ORDER IS LOAD-BEARING AND THAT IS THE WHOLE REASON THIS IS A SEPARATE STEP.
 * `>` is already in {@link TRAILING_PUNCTUATION}, so stripping punctuation first
 * turns `@diana</b>` into `@diana</b` — a shape nothing else can recover. The
 * loop in {@link mentionHandleOf} therefore runs this first, then punctuation,
 * then repeats until neither moves (`**@diana**.` needs two passes).
 *
 * ⚠ WHY IT COUNTS AS A DELIMITER AT ALL. `message-markdown.tsx` renders inline
 * `html` tokens as their own LITERAL TEXT and lexes the run between them as an
 * ordinary text leaf, so `<b>@diana</b>` TINTS (measured). The tag is markdown
 * structure to the lexer and never part of the handle.
 */
const TRAILING_HTML_TAG = /<\/?[A-Za-z][A-Za-z0-9-]*\s*\/?>$/;

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

/**
 * THE HANDLE A PICKER SHOULD INSERT for a chosen member: the first handle they
 * claim that {@link buildMentionIndex} resolves BACK to them, or `null` when
 * every one of them is ambiguous.
 *
 * ⚠ THIS IS WHAT MAKES THE COMPOSER'S AUTOCOMPLETE AGREE WITH THE RESOLVER BY
 * CONSTRUCTION RATHER THAN BY KEEPING TWO RULES IN STEP (F-210). The picker
 * suggests on a SUBSTRING match, which is wider than the resolver's exact
 * equality and correctly so — a human then confirms. What was missing is that
 * the confirmation had to insert text the resolver accepts, and the only place
 * that can be decided is here, beside the derivation it has to match. A picker
 * that inserted `@Diana Taylor` (or `@Taylor`) would show a name and tag
 * nobody.
 *
 * ⚠ IT ASKS THE INDEX, NOT JUST {@link handlesOf}. Rule 5 fails ambiguity
 * CLOSED, so a handle two members claim maps to `null` — inserting it would be
 * inserting a token that resolves to nobody. Falling back through the member's
 * remaining handles is exactly right: `@dianataylor` still lands when `@diana`
 * is contested. `null` means every handle they answer to is contested, and the
 * caller must not offer them.
 *
 * ⚠ ORDER IS THE INDEX'S OWN (squashed display name, its first word, then the
 * same two off the email local part), so the inserted token is the one the
 * index claimed FIRST for that person.
 */
export function insertableHandle(
  candidate: MentionCandidate,
  index: MentionIndex
): string | null {
  for (const handle of handlesOf(candidate)) {
    if (index.get(handle) === candidate.userId) return handle;
  }
  return null;
}

/**
 * A token (`@diana,`) -> its comparable handle (`diana`), or null when the token
 * carries no handle at all.
 *
 * ⚠ THE STRIP IS A LOOP, not two calls (2026-08-22). A token routinely carries
 * BOTH kinds of trailing run and in either order: `**@diana**.` is emphasis then
 * punctuation, `@diana</b>` is a tag whose `>` the punctuation class would eat
 * first. One pass in a fixed order gets one of those wrong, and which one depends
 * on the order you picked — so it runs to a fixed point instead.
 */
export function mentionHandleOf(token: string): string | null {
  if (!token.startsWith("@")) return null;
  let handle = token.slice(1);
  for (;;) {
    const before = handle;
    handle = handle
      .replace(TRAILING_HTML_TAG, "")
      .replace(TRAILING_PUNCTUATION, "");
    if (handle === before) break;
  }
  handle = handle.toLowerCase();
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


/**
 * Every `@…` run in a body, in order, delimiters kept by `split`.
 *
 * ⚠ THE MASK RUNS ON EVERY @-CARRYING BODY (2026-08-22). It used to be gated on
 * `body.includes("`") || body.includes("~")` — a char list that had to be kept in
 * step with the masker's own patterns, and the markup pass added three more
 * (`\`, `]`, `<`). A gate that must enumerate what it is gating is a second copy
 * of the rule; the cheap exit that MATTERS is the `@` check above it, which is
 * what keeps the roster read off the hot write path, and the masking is regex
 * over a body already capped at 16k.
 *
 * ⚠ THIS IS THE ONE FUNNEL both {@link resolveMentions} and the server's
 * cheap-exit check run through, so nothing masked can reach the resolver by
 * either door.
 */
export function mentionTokensOf(body: string): string[] {
  if (!body.includes("@")) return [];
  return maskNonTaggingRegions(body)
    .split(MENTION_TOKEN_RE)
    .filter((part) => part.startsWith("@"));
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
