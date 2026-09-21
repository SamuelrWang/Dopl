"use client";

/**
 * **THE RECIPIENT LINE — who this draft will reach, said before it is sent**
 * (2026-09-02, v2 wave B slice B10, Samuel's ruling).
 *
 * ⚠ **IT EXISTS BECAUSE THE ANSWER WAS ONLY EVER AVAILABLE AFTERWARDS, AND
 * ONLY BY WAITING.** A person in a channel *"doesn't know that there's a tagging
 * function and that the tagging function is required for the agent to see the
 * message"* — so an untagged message looked exactly like a tagged one until
 * nothing answered it. The picker above makes tagging discoverable; this states
 * its consequence while the draft is still editable.
 *
 * ⚠ **IT IS A REPORT, NOT A CONTROL, AND IT DECIDES NOTHING.** The whole rule
 * lives in `lib/draft-recipients.ts › draftReach`, which predicts what
 * `server/service-wake-verdict.ts › resolveWakeVerdict` will store. A second
 * opinion about who a message reaches is what the delivery keystone exists to end.
 *
 * ⚠ **NO EXPLAINER COPY** (Samuel's minimal-UI ruling, INVARIANTS §5). An arrow
 * and the names, with ONE word for the arms nobody typed — `default` for RR3's
 * responder, `thread` for RR1's other party. The line IS the teaching, because
 * the names change as the draft does.
 *
 * ⚠ **IT RENDERS AT EVERY STATE, INCLUDING "nobody".** A line that appeared only
 * when somebody is addressed would be invisible in exactly the case it was built
 * for. `role="status"` because it changes under a caret that is elsewhere.
 */

import { useMemo, type ReactNode } from "react";
import {
  draftReach,
  viewerUnaddressedResponder,
  type DraftReach,
  type LiveAgentSession,
} from "../lib/draft-recipients";
import type { ChannelMember } from "../types";

/**
 * 🔴 **THE `→ nobody` FACE IS DELETED (Samuel, 2026-09-20: *"instead of having it
 * show an arrow pointing to nobody, just have no arrow basically … if there is no
 * addressee just have it be nothing"*).**
 *
 * ⚠ **THE WORD IS KEPT AS AN EXPORT AND NOTHING RENDERS IT.** Two suites and the
 * parity tests name this constant as the line's own vocabulary; deleting the
 * symbol would be a rename dressed as a behaviour change. What changed is that an
 * empty reach now draws NO ELEMENT AT ALL — see the early return below.
 * ⚠ **AND THE OLD ARGUMENT FOR SHOWING IT IS SPENT.** It read "nobody" rather
 * than "the channel" because *"broadcast" is not a shape this product has* — true,
 * and it is exactly why the line is unnecessary now: since 2026-09-20 an
 * auto-addressed draft carries its tag in the BODY, so the line has something to
 * say precisely when somebody will be reached, and silence is the honest rest
 * state rather than a fact withheld.
 */
export const REACH_NOBODY = "nobody";

/** ⚠ MODULE-LEVEL so the default is one REFERENCE, not a fresh `[]` per render —
 *  the memo below has it in its dependency list. */
const EMPTY_RECENT: readonly string[] = [];

/** The one-word tell for an address the SERVER supplied. ⚠ Both are real
 *  resilience arms (RR3 / RR1), not guesses — but the author did not type them,
 *  and a line that cannot tell the two apart teaches that tagging is optional. */
const VIA_NOTE: Partial<Record<DraftReach["via"], string>> = {
  responder: "default",
  thread: "thread",
};

/**
 * THE WORD FOR RR3's ARM, when the server chose between several live agents
 * (2026-09-04).
 *
 * ⚠ **ARMS 1 AND 2 KEEP SAYING `default`** — a configured responder and a room
 * with one agent are both "the room's standing answer".
 * ⚠ **ARMS 3 AND 4 GET THEIR OWN WORDS BECAUSE THEY ARE A PICK**: several agents
 * are live and the server named one. Same string as the stored
 * `metadata.wake_reason` and the MCP read line, so three surfaces say one thing.
 */
/**
 * 🔒 **THE BADGE ON AN AUTO-ADDRESS SAYS HOW TO REFUSE IT** (Samuel, 2026-09-20:
 * *"instead of saying most recent, put esc to cancel"*).
 *
 * ⚠ **ONE WORD FOR ALL FOUR ARMS, AND THAT IS THE POINT.** `default`, `only
 * agent`, `most recent` and `most recently launched` used to name WHICH arm
 * picked — a distinction the author cannot act on and did not ask for. What they
 * can act on is the same in every case: the tag is about to be written for them,
 * and Escape stops it. The arm is still stored on `metadata.wake_reason` for the
 * read surfaces that explain a routing after the fact.
 * ⚠ **IT IS AN INSTRUCTION, SO IT IS ONLY EVER SHOWN BESIDE A CANCELLABLE
 * ADDRESS** — `via: "responder"`. RR1's `thread` note is untouched: that address
 * is the thread's own two parties and Escape does not apply to it.
 */
export const CANCEL_NOTE = "esc to cancel";

/**
 * ⚠ **IT TAKES THE FACTS AND DERIVES THE ANSWER, rather than being handed one** — the derivation
 * is this component's own reason to change, and every input below exists only so that this line
 * can be drawn. `draftReach` remains the rule, pure and separately tested.
 */
export function ComposerRecipients({
  body,
  members,
  sessions,
  currentUserId,
  recentAgentIds = EMPTY_RECENT,
  threadOtherParty = null,
  cancelled = false,
  working = null,
}: {
  body: string;
  members: ChannelMember[];
  sessions: readonly LiveAgentSession[];
  currentUserId: string;
  /** **ESCAPE WAS PRESSED FOR THIS DRAFT** — the whole line goes, because the
   *  address did (`components/composer.tsx` owns the flag and clears it on send). */
  cancelled?: boolean;
  /** **"N WORKING" — MY OWN AGENTS MID-TURN, TO THE RIGHT** (Samuel, 2026-09-20:
   *  *"put agents working to the right"*). ⚠ A NODE, NOT A LIST: this component
   *  reports the DRAFT's reach and must not learn to read a session feed.
   *  `channel-surface.tsx` builds it, `agent-activity.tsx` draws it. */
  working?: ReactNode;
  /** RR3 arm 3's input, derived once from the transcript this pane already
   *  holds (`derivations.ts`). ⚠ A STABLE reference — see {@link EMPTY_RECENT}. */
  recentAgentIds?: readonly string[];
  threadOtherParty?: ChannelMember | null;
}) {
  const reach: DraftReach = useMemo(
    () =>
      draftReach({
        body,
        members,
        sessions,
        currentUserId,
        // ⚠ **DERIVED HERE, FROM THE ROSTER THIS COMPONENT ALREADY TAKES** (2026-09-07, items
        // 10 and 11) — the setting is PER MEMBER now, a fact about the viewer's own membership
        // row. `defaultResponderAgentName` had to be threaded down four components, and every
        // surface that forgot it (the thread pop-out did) silently disagreed with the server.
        unaddressedResponder: viewerUnaddressedResponder(members, currentUserId),
        recentAgentIds,
        threadOtherParty,
      }),
    [
      body,
      members,
      sessions,
      currentUserId,
      recentAgentIds,
      threadOtherParty,
    ]
  );
    // ⚠ **CANCELLED DRAWS NOTHING, THE SAME AS AN EMPTY REACH** — Escape removed the
  // address, so there is no address to report and the line must not linger as a
  // ghost of one.
  if (cancelled || reach.recipients.length === 0) return null;
  const note =
    reach.via === "responder" ? CANCEL_NOTE : VIA_NOTE[reach.via];
  return (
    <p
      role="status"
      aria-label="Recipients"
      // ⚠ `justify-start` — half of the ABOVE-THE-CARD, top-left placement Samuel called on
      // 2026-09-08 (`composer.tsx` owns the other half). It was `justify-end` for the 2026-09-04
      // top-RIGHT placement, and the two halves move together.
      // The element still stretches the card's full width, so `min-w-0` + `truncate` keep a long
      // recipient list shrinking rather than pushing the card wider.
      className="flex min-w-0 items-center justify-start gap-1 px-0.5 pb-1 text-caption text-text-muted"
    >
      <span aria-hidden>→</span>
      <span className="truncate">
        {reach.recipients.map((r) => r.label).join(", ")}
      </span>
      {note && (
        <span className="shrink-0 rounded-[6px] bg-surface-raised-1 px-1.5 text-micro">
          {note}
        </span>
      )}
      {/* **THE WORKING STRIP FOLLOWS THE BADGE, PACKED LEFT** (Samuel,
          2026-09-20, twice: first *"put agents working to the right"* — out of
          its own band above the line — then *"I want it to be left aligned,
          except after the most recent agent thingy"*, once he saw it pinned to
          the far edge).
          ⚠ **SO THERE IS NO `ml-auto`, AND ITS ABSENCE IS THE RULING.** This row
          is `justify-start`; the strip is simply the last item in it, one gap
          after the badge. A spacer would push it to the pane's right edge, which
          is what he corrected — the two facts read as one line together, not as
          two things at opposite ends of the pane.
          ⚠ `min-w-0` + `shrink` so the strip is what elides (`…`) when the room
          runs out, rather than the recipients it follows. */}
      {working && <span className="min-w-0 shrink">{working}</span>}
    </p>
  );
}
