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
 * `server/service-wake-verdict.ts › resolveWakeVerdict` will store. This file
 * renders that answer and holds no rule of its own — a second opinion about who
 * a message reaches is the class of bug the delivery keystone exists to end.
 *
 * ⚠ **NO EXPLAINER COPY** (Samuel's minimal-UI ruling, INVARIANTS §5). An arrow
 * and the names, with ONE word for the arms nobody typed — `default` for RR3's
 * responder, `thread` for RR1's other party. Not a sentence about what tagging
 * is: the line IS the teaching, because the names change as the draft does.
 *
 * ⚠ **IT RENDERS AT EVERY STATE, INCLUDING "nobody".** A line that appears only
 * when somebody is addressed would be invisible in exactly the case it was built
 * for — the reader has nothing to notice the absence of. `role="status"` because
 * it changes under a caret that is elsewhere.
 */

import { useMemo } from "react";
import { draftReach, type DraftReach, type LiveAgentSession } from "../../lib/draft-recipients";
import type { ChannelMember } from "../../types";

/**
 * What the line says when the draft would wake nobody.
 *
 * ⚠ **THE WORD IS "nobody", NOT "the channel" OR "everyone".** An unaddressed
 * message lands in the room and triggers no agent, at any member count
 * (INVARIANTS §5) — **"broadcast" is not a shape this product has**, and copy
 * implying reach it does not have is the failure this line was added to fix.
 */
export const REACH_NOBODY = "nobody";

/** The one-word tell for an address the SERVER supplied. ⚠ Both are real
 *  resilience arms (RR3 / RR1), not guesses — but the author did not type them,
 *  and a line that cannot tell the two apart teaches that tagging is optional. */
const VIA_NOTE: Partial<Record<DraftReach["via"], string>> = {
  responder: "default",
  thread: "thread",
};

/**
 * ⚠ **IT TAKES THE FACTS AND DERIVES THE ANSWER, rather than being handed one.** The composer is
 * at the 500-line cap (§1) and, more to the point, the derivation is this component's own reason
 * to change: every input below exists only so that this line can be drawn. `draftReach` remains
 * the rule, pure and separately tested.
 */
export function ComposerRecipients({
  body,
  members,
  sessions,
  currentUserId,
  defaultResponderAgentName = null,
  threadOtherParty = null,
}: {
  body: string;
  members: ChannelMember[];
  sessions: readonly LiveAgentSession[];
  currentUserId: string;
  defaultResponderAgentName?: string | null;
  threadOtherParty?: ChannelMember | null;
}) {
  const reach: DraftReach = useMemo(
    () =>
      draftReach({
        body,
        members,
        sessions,
        currentUserId,
        defaultResponderAgentName,
        threadOtherParty,
      }),
    [body, members, sessions, currentUserId, defaultResponderAgentName, threadOtherParty]
  );
  const note = VIA_NOTE[reach.via];
  return (
    <p
      role="status"
      aria-label="Recipients"
      className="flex min-w-0 items-center gap-1 px-0.5 text-caption text-text-muted"
    >
      <span aria-hidden>→</span>
      {reach.recipients.length === 0 ? (
        <span>{REACH_NOBODY}</span>
      ) : (
        <span className="truncate">
          {reach.recipients.map((r) => r.label).join(", ")}
        </span>
      )}
      {note && (
        <span className="shrink-0 rounded-[6px] bg-surface-raised-1 px-1.5 text-micro">
          {note}
        </span>
      )}
    </p>
  );
}
