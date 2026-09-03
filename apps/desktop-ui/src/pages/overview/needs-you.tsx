import type { AccountStatus, AccountWaitingItem } from "@/features/channels/types";
import { cn } from "@/shared/lib/utils";
import { RouterLink } from "#/components/app-shell";

/**
 * "NEEDS YOU" — messages ADDRESSED TO THIS PERSON that they have not answered.
 *
 * ⚠ **IT WAS A PING INBOX UNTIL SLICE B16 (2026-09-02) AND IS A PROJECTION OF
 * THE TRANSCRIPT NOW.** The ping lane was a second mailbox beside
 * `channel_messages` carrying a copy of a delivery that the message already
 * recorded; ruling B8 folded it into a directed `send`, and the account-wide
 * `status` read answers the same question by DERIVING it — every message
 * stamped `metadata.to_user_id = me` with no later message of my own in that
 * channel (`server/repository-account.ts › listAddressedToMe`). Nothing has to
 * be kept in sync, and a row cannot outlive the message it points at.
 *
 * ⚠ **THE THREE PING KINDS (`done` / `question` / `blocked`) ARE NOT REPLACED BY
 * THREE MESSAGE KINDS**, and that is a ruling rather than an omission:
 * `docs/specs/mcp-v2-wave-b.md` §2.1 refuses them ("a value with no distinct
 * behaviour is prose wearing a schema") and F-491 settled it in the spec's
 * favour. What a row carries instead is the distinction the surface really
 * makes — an ESCALATION (a card with option buttons, waiting on a press) versus
 * an ordinary request — which is a fact about the message, not a self-report.
 *
 * ⚠ **IT LIVES ON OVERVIEW RATHER THAN BEHIND ITS OWN ROUTE, DELIBERATELY.** A
 * new top-level page is a three-place hand-copied change (`routes.tsx`, the
 * sidebar's `NAV`, and `deep-link-target.js`), and a surface whose whole job is
 * to be SEEN on the way past has not earned one.
 */

/** The account-wide status read — every channel, every workspace, one answer. */
export const ACCOUNT_STATUS_PATH = "/api/channels/account/status";

/** One waiting message, plus the channel it is in. ⚠ The payload nests waiting
 *  INSIDE its channel; the card is a flat list, so the join happens once here. */
export interface NeedsYouRow extends AccountWaitingItem {
  channelSlug: string;
}

/**
 * The card's rows, oldest first.
 *
 * ⚠ **OLDEST FIRST ACROSS THE WHOLE LIST**, not per channel: the one that has
 * been waiting longest is the one to read first, and a reader scanning this card
 * is asking "what have I left hanging", never "what happened in build".
 */
export function needsYouRows(status: AccountStatus | undefined): NeedsYouRow[] {
  if (!status) return [];
  return status.channels
    .flatMap((channel) =>
      channel.waiting.map((item) => ({ ...item, channelSlug: channel.channelSlug }))
    )
    .sort((a, b) => a.seq - b.seq);
}

/** `4m` / `3h` / `2d`. ⚠ AGE, not a clock time: the only question a reader has
 *  about an unanswered request is how long it has been sitting there. */
export function waitingAge(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const mins = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** The channel deep link this SPA already routes, with the thread pre-opened. */
function threadHref(segment: string, row: NeedsYouRow): string {
  return `/${segment}/channels/${row.channelId}?thread=${row.threadId ?? ""}`;
}

/**
 * Chip faces. ⚠ Token ramp only, never a hex — and TWO faces, because the
 * surface makes two distinctions: a decision card is waiting on a PRESS, an
 * ordinary request is waiting on a REPLY.
 */
const DECISION = {
  label: "Decision",
  chip: "border-link/25 bg-link/10 text-link",
  dot: "bg-link",
};
const REQUEST = {
  label: "Request",
  chip: "border-border-strong bg-bg-inset text-text-secondary",
  dot: "bg-text-muted",
};

export function NeedsYou({
  rows,
  segment,
}: {
  rows: NeedsYouRow[];
  segment: string;
}) {
  return (
    <section className="bento flex flex-col p-3.5">
      <h2 className="text-label font-semibold uppercase tracking-wide text-text-secondary">
        Needs you
      </h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-caption text-text-muted">Nothing yet.</p>
      ) : (
        <ul className="mt-1 divide-y divide-border-subtle">
          {rows.map((row) => {
            const kind = row.isEscalation ? DECISION : REQUEST;
            // ⚠ `authorName` is null when the profile did not resolve — "a
            // member" is the honest rendering, never a raw user id.
            const from = row.authorName ?? "a member";
            const meta = [waitingAge(row.createdAt), row.channelSlug, from]
              .filter(Boolean)
              .join(" · ");
            return (
              <li
                key={row.messageId}
                data-waiting-id={row.messageId}
                className="flex items-start gap-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="wrap-anywhere text-body font-medium text-text-primary">
                    {row.preview}
                  </p>
                  <p className="mt-0.5 truncate text-caption text-text-muted">
                    {meta}
                  </p>
                  {/* ⚠ ABSENT, NOT DISABLED, when there is no thread — the
                      design-system rule for an action that cannot apply. */}
                  {row.threadId !== null && (
                    <div className="mt-1.5 flex items-center gap-3">
                      <RouterLink
                        href={threadHref(segment, row)}
                        className="text-caption font-medium text-link"
                      >
                        Open thread
                      </RouterLink>
                    </div>
                  )}
                </div>
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-caption font-medium",
                    kind.chip
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn("h-1.5 w-1.5 rounded-full", kind.dot)}
                  />
                  {kind.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
