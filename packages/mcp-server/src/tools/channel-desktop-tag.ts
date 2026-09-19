/**
 * **`@desktop` AND THE OUTSIDE-SESSION LABEL, AS THIS PACKAGE SEES THEM**
 * (2026-09-18, Samuel's ruling on the external-session group tag).
 *
 * ⚠ **HAND-COPIED CONSTANTS from `src/features/channels/lib/desktop-handle.ts`**
 * — `packages/*` cannot import the app's `src/` (INVARIANTS §13), the same
 * arrangement `identity.ts › DESKTOP_SESSION_RUNTIME` has with
 * `shared/auth/runtime-header.ts`. ⚠ Drift is SILENT and looks like "the tag
 * stopped working", so it is pinned by `channel-desktop-tag.test.ts`, which
 * reads the web tree's file directly.
 *
 * ⚠ **THIS PACKAGE ONLY READS.** The write side — resolution, stripping,
 * stamping — is entirely in the web tree; what lives here is how a STORED row
 * renders. So nothing in this file decides anything, and a value it does not
 * recognize must render as *absent*, never as a guess.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (`parity.test.ts`) and the removed-vocabulary source scan
 * (`channel-law.test.ts`).
 */

import type { ChannelMessage } from "@dopl/client";
import { metaString } from "./channel-shared";

/** The reserved group handle, bare. ⚠ Mirror of `lib/desktop-handle.ts`. */
export const DESKTOP_GROUP_HANDLE = "desktop";

/** How `@desktop` renders in an addressing arrow. ⚠ One spelling, imported. */
export const DESKTOP_HANDLE_TAG = `@${DESKTOP_GROUP_HANDLE}`;

/** Server-owned key carrying the operator whose outside sessions were addressed. */
export const DESKTOP_TO_METADATA_KEY = "to_desktop";

/** Server-owned key marking a post an OUTSIDE SESSION wrote. */
export const EXTERNAL_SESSION_METADATA_KEY = "external_session";

/**
 * **WHOSE OUTSIDE SESSIONS THIS MESSAGE WAS ADDRESSED TO**, or `undefined`.
 *
 * ⚠ **`undefined` IS "NOT ADDRESSED TO ANY DESKTOP LANE", AND THAT IS THE ONLY
 * READING.** It is also what every row written before this key existed carries,
 * and what an older server stamps — all three collapse to the same rendering,
 * which is the pre-2026-09-18 one. There is no third state to tell apart here,
 * unlike `recipientAgentIds`' `[]`-versus-`null`.
 */
export function desktopAddresseeOf(m: ChannelMessage): string | null {
  // ⚠ `null` RATHER THAN `metaString`'s `undefined`, so this answers in the same
  // vocabulary as the web tree's `lib/desktop-handle.ts › desktopAddresseeOf`.
  // Two spellings of "absent" across a hand-copied pair is how one side grows a
  // `=== undefined` the other never satisfies.
  return metaString(m, DESKTOP_TO_METADATA_KEY) ?? null;
}

/**
 * **WAS THIS POST WRITTEN BY AN OUTSIDE SESSION?**
 *
 * ⚠ **STRICTLY `=== true`.** The web tree stamps the key ONLY when the answer is
 * yes and never writes an explicit `false`, so any other value — absent, `null`,
 * a string some older build wrote — means *this server did not say*, and the
 * honest rendering of that is the ordinary agent label. Coercing with `!!` would
 * turn a truthy junk value into a confident claim about who wrote somebody's
 * message.
 */
export function isExternalSessionPost(m: ChannelMessage): boolean {
  const value = (m.metadata as Record<string, unknown> | undefined)?.[
    EXTERNAL_SESSION_METADATA_KEY
  ];
  return value === true;
}

/**
 * **THE AUTHOR VIEW — the word a renderer labels this row with** (2026-09-18).
 *
 * ⚠ **IT IS A PROJECTION, AND IT IS DELIBERATELY NOT `ChannelMessage.authorKind`.**
 * That field is the stored COLUMN, whose set is closed at three and gated by
 * `scripts/check-message-kind-drift.ts` — a gate that reads the `CHECK` out of
 * one named migration and fails on any later one that re-constrains a `kind`
 * column. Widening the column was therefore the expensive road; widening the
 * VIEW costs nothing and, more importantly, degrades correctly: a row with no
 * flag renders exactly as it rendered yesterday.
 *
 * ⚠ **BATCH A (`fix/r1-a`) READS THIS FUNCTION, NOT A DTO FIELD.** The agreed
 * word is `external`; the agreed carrier is this projection. Both `ChannelMessage`
 * declarations (`src/features/channels/types.ts` and the SDK's
 * `channel-types.ts`) sit AT the 500-line cap, so a new field would have forced a
 * §1 split in two trees for one boolean.
 */
export type MessageAuthorView = ChannelMessage["authorKind"] | "external";

/**
 * **WHAT THIS LINE IS TO AN OUTSIDE SESSION READING THE PAGE** (2026-09-18,
 * Samuel's ruling (b)).
 *
 * VERBATIM, because the whole design of this classifier follows from it: *"at
 * the end of the day, it's much worse if a message meant for an audience/agents
 * is silently forgotten/dropped then like too many messages going to an agent
 * and the agent having to filter."*
 *
 * ⚠ **SO THIS MARKS; IT NEVER FILTERS.** The hold and the read return every
 * message in the channel exactly as they did before — see
 * `channel-render.ts › formatMessages`, where this is applied as a SUFFIX to
 * lines that are all rendered regardless. There is no opt-in "only tagged"
 * mode in this wave, deliberately; Round 2 measures how many messages meant for
 * an outside session arrived untagged, and THAT measurement is the argument for
 * or against ever adding one. The seam is this type: a filter would be a
 * `.filter()` on the value it returns, and there is exactly one place to put it.
 */
export type OutsideRelevance =
  /** `to=@desktop` named THIS operator's outside sessions. Unambiguous. */
  | "addressed"
  /**
   * Nobody tagged it, but it is probably yours. TWO CLASSES, and both come from
   * the ruling's observation that *"the agents might not always tag the desktop
   * agent"*:
   *   (i)  an AGENT addressed the OPERATOR as a person. Before `@desktop`
   *        existed this was the only way to reach this lane at all, so it is
   *        what every agent already does and what every older transcript is
   *        full of.
   *   (ii) an agent-authored RECORD or unaddressed post that FOLLOWS a message
   *        this operator's outside session wrote in the same room — the shape of
   *        a reply to something you just said, filed rather than addressed.
   */
  | "likely"
  /** Nothing suggests it is yours. ⚠ STILL RENDERED, and still yours to read. */
  | null;

/**
 * Classify one PAGE, in order. ⚠ **A PAGE-WIDE PASS RATHER THAN A PER-LINE
 * PREDICATE**, because class (ii) is positional: it depends on whether this
 * operator's own outside session has spoken EARLIER in the same room, which no
 * single row knows.
 *
 * ⚠ **THE "SAME ROOM" FENCE IS REAL.** A page can span channels (the workspace
 * hold, the account-wide read), so the "has my outside session spoken" flag is
 * kept per `channelId` — otherwise a record in a quiet room would inherit
 * relevance from an exchange in a different one.
 *
 * ⚠ **`selfUserId === null` YIELDS NOTHING.** A connection that could not
 * resolve its own user id cannot say which messages are for it, and a guess
 * here would mark a peer's traffic as the caller's.
 */
export function outsideRelevance(
  messages: readonly ChannelMessage[],
  selfUserId: string | null,
): Map<string, OutsideRelevance> {
  const out = new Map<string, OutsideRelevance>();
  if (selfUserId === null) return out;
  const spokeHere = new Set<string>();
  for (const m of messages) {
    const mine = m.authorUserId === selfUserId;
    if (desktopAddresseeOf(m) === selfUserId) {
      out.set(m.id, "addressed");
    } else if (m.authorKind === "agent" && !isExternalSessionPost(m)) {
      // (i) — an agent named the operator as a person.
      const named = (m.recipientUserIds ?? []).includes(selfUserId);
      // (ii) — a record or unaddressed post after my own outside session spoke.
      //   ⚠ `recipientUserIds` and `recipientAgentIds` BOTH empty is the
      //   "resolved to nobody" answer; `null`/absent is a pre-verdict row and
      //   must NOT be read as unaddressed, which is the same three-way
      //   distinction `addressTag` keeps.
      const resolvedToNobody =
        (m.recipientUserIds ?? null) !== null &&
        (m.recipientAgentIds ?? null) !== null &&
        (m.recipientUserIds ?? []).length === 0 &&
        (m.recipientAgentIds ?? []).length === 0;
      const trailing = resolvedToNobody && spokeHere.has(m.channelId);
      out.set(m.id, named || trailing ? "likely" : null);
    } else {
      out.set(m.id, null);
    }
    // ⚠ SET AFTER CLASSIFYING, so an outside session's OWN post never marks
    // itself as a reply to itself — the flag is about what comes NEXT.
    if (mine && isExternalSessionPost(m)) spokeHere.add(m.channelId);
  }
  return out;
}

export function authorViewOf(m: ChannelMessage): MessageAuthorView {
  // ⚠ ONLY AN `agent` ROW CAN BE ONE. A human composer post is `user` whatever
  // metadata it carries, and `system` is server-minted — promoting either would
  // be inventing an authorship claim from a flag that was never about them.
  return m.authorKind === "agent" && isExternalSessionPost(m)
    ? "external"
    : m.authorKind;
}
