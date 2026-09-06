import { useState } from "react";
import { useApiQuery } from "@/shared/hooks/use-api-query";

/**
 * 🔒 **THE FAIL-CLOSED BACKFILL, TOLD ONCE** — ruling (c) of task 11 (design
 * #1077, approved #1080): *"do existing agent sessions in shared rooms lose
 * personal reach on upgrade? I'd say yes, fail-closed, and tell people once —
 * it is the only user-visible regression in the whole change."*
 *
 * ⚠ **THE REGRESSION IS REAL AND IT IS SILENT, WHICH IS WHY THIS EXISTS.**
 * `resolve-resource.ts` clause 3 let an agent session in a shared room reach its
 * operator's personal shelf; `shared/tenancy/personal-reach.ts` narrows that to
 * armed rooms only. Nothing failed loudly at the moment of the change — the
 * shelf simply stopped being there, and a fence that answers 404-never-403
 * cannot be the thing that explains itself. So the explanation has to be given
 * to the PERSON, on the surface that holds the switch.
 *
 * 🔒 **IT IS OPERATOR-FACING, AND THAT IS THE FENCE, NOT A UI PREFERENCE.**
 * `PersonalReach.refusal` ("unarmed_room") must never be rendered to an agent —
 * an unarmed room has to answer exactly what an empty one answers, or arming
 * state becomes readable through the surfaces it gates. A notice in the app
 * tells the one person who is allowed to know: the owner, about their own shelf,
 * in their own room.
 *
 * ⚠ **ONCE MEANS ONCE, AND "ONCE" IS PER PERSON PER DEVICE.** The flag is
 * `localStorage`, keyed by user id — the `dopl:welcome` precedent, with the
 * polarity INVERTED and that inversion is worth reading twice: `dopl:welcome` is
 * SET to make the popup appear and cleared on dismissal, while this key is
 * ABSENT until the notice is dismissed. Absent = never told. ⚠ The consequence
 * of the device scope is stated rather than hidden: a second machine tells them
 * a second time. A server-side per-user flag would be the fix, and it is a
 * migration this slice did not take.
 *
 * ⚠ **IT SHOWS ONLY WHERE IT IS TRUE AND ACTIONABLE** — an UNARMED room, after
 * the read lands. In an armed room the person has already met the switch and
 * pressed it, so the notice would be news about nothing; while the read is in
 * flight it says nothing at all, for the reason the control beside it gives.
 */
export function PersonalReachBackfillNotice({
  channelId,
  workspaceId,
  userId,
}: {
  channelId: string;
  /** The CHANNEL'S container — the arming row is keyed by channel, so the
   *  request must carry the tenancy the channel lives in. */
  workspaceId: string;
  /** ⚠ PART OF THE KEY, not of the query: two people on one machine are two
   *  people to tell. */
  userId: string;
}) {
  const key = `dopl:personal-reach-notice:${userId}`;
  const [dismissed, setDismissed] = useState(
    () => readFlag(key) !== null,
  );
  const state = useApiQuery<{ armed: boolean }>(
    `/api/channels/${encodeURIComponent(channelId)}/personal-arming`,
    { workspaceId },
  );

  // ⚠ Hooks first, refusals after — the three reasons to say nothing are
  // checked below rather than above so this component's hook order cannot
  // depend on a flag or on a read that has not landed.
  if (dismissed) return null;
  if (state.data?.armed !== false) return null;

  return (
    <div className="mb-3 rounded-md border border-border-subtle bg-bg-inset p-3">
      <p className="text-micro text-text-secondary">
        Agent sessions in a channel with somebody else in it no longer reach
        your personal knowledge, unless you let them. This is new: they used to
        reach it everywhere. Yours is untouched and still yours everywhere you
        go — it is only what your agents can see from a shared channel that
        changed. Use the switch above to turn it back on for this channel.
      </p>
      <button
        type="button"
        className="mt-2 text-micro font-medium text-link"
        onClick={() => {
          // ⚠ WRITE FIRST, THEN HIDE. A failed write with the notice already
          // gone is a notice nobody sees again and nobody was told; this order
          // makes the worst case "told twice", which is the harmless one.
          writeFlag(key);
          setDismissed(true);
        }}
      >
        Got it
      </button>
    </div>
  );
}

/**
 * ⚠ **BOTH ACCESSORS SWALLOW, AND THE TWO DIRECTIONS ARE DELIBERATELY
 * DIFFERENT.** `localStorage` throws on a locked-down or full store. An
 * unreadable flag reads as NOT TOLD (the notice shows, possibly again), and an
 * unwritable one is dropped (the session's own `dismissed` still hides it). One
 * fails toward telling somebody twice; the other toward not crashing a pane
 * over a preference. Neither may ever fail toward silence about the change.
 */
function readFlag(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeFlag(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    /* preference storage is unavailable; the notice is hidden for this view. */
  }
}
