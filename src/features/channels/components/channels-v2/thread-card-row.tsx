"use client";

/**
 * Channels v2 — THE POSTED REQUEST CARD, split out of `transcript.tsx` on 2026-08-28 when
 * that file crossed the 500-line cap (INVARIANTS §1).
 *
 * ⚠ THE SEAM IS §1's "one file, one reason to change", not the count that forced the
 * question. This card moves when the THREAD product moves — it has already lost a pending
 * chip and an inline consent pair and gained a direct launch — where `transcript.tsx` moves
 * when a message ROW's shape moves. It moved VERBATIM; the shell it renders into is
 * `authored-row.tsx`, which both files now import rather than one importing through the
 * other.
 */

import { Bot } from "lucide-react";
import { AddresseePill, CARD_BUTTON } from "./bits";
import { AuthoredRow } from "./authored-row";
import { shortName, type AuthorIndex } from "./view-model";
import type { ThreadCardRow } from "./view-model-rows";

/**
 * THE POSTED REQUEST — what a "New agent thread" send leaves in the channel.
 *
 * Dark-shell card (2026-08-19) — no longer the `MESSAGE_CARD` face: a
 * body the message points at rather than says. **ONE CARD, N THREADS** — the
 * fan-out writes one `channel_tasks` row per addressee (INVARIANTS §5: a thread
 * is one requester + one target) and they share a server-stamped `fanoutGroup`,
 * so each pill is one real ADDRESSEE, read off that thread's own
 * `targetUserId`.
 *
 * ⚠ THE PILLS CARRY NO APPROVAL STATE, and their absence is a measurement, not
 * a style choice. The mock's "1 of 3 agents approved" needs a per-target consent
 * projection, and a consent read is scoped to `(operator, workspace)` with the
 * operator always `ctx.userId` (INVARIANTS §6) — so the REQUESTER cannot see
 * their addressees' decisions at all, and "no pending row" would report
 * never-asked as approved. Filed as REFACTOR-FINDINGS F-206; the pill states the
 * party and nothing else until a projection exists.
 *
 * ⚠ AND IT CARRIES NO PENDING STATE OF THE VIEWER'S OWN EITHER, SINCE 2026-08-22
 * (Samuel): *"remove all the stuff about declining and approving of threads — you
 * have the thread, you open it, and either you launch agent or you don't."* The
 * `PendingChip`, the `requested` set behind it and the inline **Decline /
 * Launch agent** consent pair are all DELETED. What is left is TWO ACTIONS and
 * neither is an answer to anybody: **Open thread** (the existing selection nav)
 * and **Launch agent** (the direct launch — `use-agents-panel.ts › launchAgent`,
 * which spawns a responder-style agent on this card's own thread). No decline
 * anywhere.
 */
export function ThreadCardMessage({
  row,
  index,
  flash,
  canLaunchAgent,
  launchBusy,
  onLaunch,
  onOpen,
}: {
  row: ThreadCardRow;
  index: AuthorIndex;
  flash: boolean;
  canLaunchAgent: boolean;
  launchBusy: boolean;
  onLaunch: () => void;
  onOpen: () => void;
}) {
  const first = row.threads[0];
  return (
    <AuthoredRow
      id={row.id}
      side={row.side}
      author={row.author}
      authorLabel={row.authorLabel}
      time={row.time}
      agent={false}
      continuation={false}
      flash={flash}
    >
      {/* Dark shell (Samuel, 2026-08-19, from the "AI Tools" reference): the
          card is a CTA-ink container whose top bar carries the label in white,
          with the white panel INSET inside it, own rounded corners — the
          `--surface-cta` / `--text-on-cta` pair, the same ink `.auth-btn-3d`
          wears, never a literal hex. */}
      <div className="mt-1 w-full max-w-[460px] overflow-hidden rounded-[14px] bg-surface-cta text-left ring-1 ring-surface-cta">
        <div className="flex items-center gap-1.5 px-3 py-2">
          <Bot size={13} aria-hidden className="shrink-0 text-text-on-cta" />
          <span className="text-small font-medium text-text-on-cta">
            Agent thread
          </span>
          <span className="flex-1" />
        </div>
        {/* `m-0.5 mt-0`: the sliver of ink left visible around the white panel
            is the reference's border-line (thinned from m-1, Samuel
            2026-08-19); the bar above supplies the top. `bg-white` is a ruled
            exception to the token surfaces — Samuel wants this panel PURE
            white, not `--bg-elevated`'s near-white. */}
        <div className="m-0.5 mt-0 flex flex-col gap-2 rounded-[12px] bg-white p-3">
        {/* ⚠ Same `wrap-anywhere` rule as the body, for the same reason: a
            title or a preview with no spaces in it would otherwise size this
            card's column off its min-content width and run past the card
            edge (the `line-clamp` only hides the overflow, it does not stop
            it). */}
        <span className="wrap-anywhere text-body font-semibold text-text-primary">
          {first.title}
        </span>
        <p className="line-clamp-3 wrap-anywhere text-caption text-text-muted">
          {row.preview}
        </p>

        <div className="flex flex-wrap gap-1.5">
          {row.threads.map((thread) => {
            const person = thread.targetUserId
              ? index.byId.get(thread.targetUserId)
              : undefined;
            // ⚠ An addressee the roster cannot resolve still gets a pill — the
            // request WAS raised against them, and dropping the pill would
            // under-report who was addressed. It is the one claim this card
            // must never get wrong.
            return (
              <AddresseePill
                key={thread.id}
                label={
                  person
                    ? shortName(
                        {
                          userId: person.userId,
                          email: person.email,
                          displayName: person.displayName,
                          avatarUrl: person.avatarUrl,
                        },
                        index.currentUserId
                      )
                    : "Unknown member"
                }
              />
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-caption text-text-muted" />
          {/* ⚠ TWO ACTIONS, AND NEITHER IS A CONSENT DECISION (Samuel,
              2026-08-22). The inline Decline / Launch agent pair that stood
              here answered a `pending` inbound row through the CAS'd
              `PATCH /consent/[id]`; that lane is gone, along with the strip
              under the thread header and the Inbox's inbound rows. **THERE IS
              NO DECLINE ANYWHERE.**

              "Launch agent" is the DIRECT launch — the same bridge op the
              composer's Bot icon and the Agents tab's New Agent button fire
              (`use-agents-panel.ts › launchAgent`), spawning one of the
              operator's own agents on THIS card's thread. It raises no consent
              row and answers no request.

              ⚠ IT IS `openThreadId`, THE SAME THREAD "Open thread" OPENS, and
              that identity is load-bearing: a fan-out card names N threads, and
              `view-model-rows.ts › ownThreadOf` already picked the one this
              viewer is party to. Launching on any other one would start an
              agent in an exchange the operator cannot write in.

              ⚠ ABSENT, NOT DISABLED, WITHOUT THE BRIDGE. A plain browser has no
              agent to start, and a permanently greyed button is
              indistinguishable from a broken one (`bits.tsx › IconButton`
              carries the same rule). `launchBusy` is the in-flight guard over a
              real click and is a different fact. */}
          {canLaunchAgent && (
            <button
              type="button"
              disabled={launchBusy}
              onClick={onLaunch}
              className="auth-btn-3d h-8 shrink-0 rounded-[8px] px-3 text-caption font-medium text-white disabled:opacity-60"
            >
              Launch agent
            </button>
          )}
          <button type="button" onClick={onOpen} className={CARD_BUTTON}>
            Open thread
          </button>
        </div>
        </div>
      </div>
    </AuthoredRow>
  );
}
