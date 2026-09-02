import { useQueryClient } from "@tanstack/react-query";
import { useApiMutationWith } from "@/shared/hooks/use-api-mutation";
import { apiPathKey } from "@/shared/api/query-keys";
import type { ChannelPing, PingKind } from "@/features/channels/types";
import { cn } from "@/shared/lib/utils";
import { RouterLink } from "#/components/app-shell";
import { apiRequest } from "#/lib/api";

/**
 * "NEEDS YOU" — the ping inbox (2026-09-01, `docs/specs/needs-you-ping.md`).
 *
 * ⚠ **AN INBOX, NOT A TRANSCRIPT.** Every row here was addressed to THIS person
 * specifically and appears nowhere else: a ping is not a `channel_messages` row,
 * so it is in no channel view and no `await`. This panel is the only place a
 * `member`-form ping is ever seen.
 *
 * ⚠ **IT LIVES ON OVERVIEW RATHER THAN BEHIND ITS OWN ROUTE, DELIBERATELY.** A
 * new top-level page is a three-place hand-copied change (`routes.tsx`, the
 * sidebar's `NAV`, and `deep-link-target.js`), and a surface whose whole job is
 * to be SEEN on the way past has not earned one. A badge is the next step if it
 * does.
 */

export const PINGS_PATH = "/api/pings";

/**
 * Chip faces by kind. ⚠ Token ramp only, never a hex — and the three faces are
 * ordered by how much they interrupt: `done` is finished news (neutral),
 * `question` is waiting on the reader (link), `blocked` is stopped (danger).
 */
const KIND: Record<PingKind, { label: string; chip: string; dot: string }> = {
  done: {
    label: "Done",
    chip: "border-success/25 bg-success/10 text-success",
    dot: "bg-success",
  },
  question: {
    label: "Question",
    chip: "border-link/25 bg-link/10 text-link",
    dot: "bg-link",
  },
  blocked: {
    label: "Blocked",
    chip: "border-border-strong bg-bg-inset text-text-secondary",
    dot: "bg-text-muted",
  },
};

/** `4m` / `3h` / `2d`. ⚠ AGE, not a clock time: the only question a reader has
 *  about a ping is how long it has been sitting there unread. */
export function pingAge(iso: string, now: Date = new Date()): string {
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
function threadHref(segment: string, ping: ChannelPing): string {
  return `/${segment}/channels/${ping.channelId}?thread=${ping.threadId ?? ""}`;
}

export interface HandOffDraft {
  channel: string;
  kind: PingKind;
  body: string;
  threadId: string | null;
}

/**
 * "SEND TO DESKTOP AGENT" — re-emit the signal with `toDesktop: true`.
 *
 * ⚠ **A NEW PING, NOT A FORWARD OF THIS ONE.** The row that arrived is a record
 * of what one agent said to one recipient and is never rewritten; this files a
 * fresh one addressed at the operator's own external session — the only party
 * that holds `/api/pings/await` open. It is how a human hands a signal to the
 * assistant they are actually talking to without typing it out.
 *
 * ⚠ The body QUOTES the original rather than restating it, so the external agent
 * reads what the sending agent actually wrote.
 */
export function handOffConfig(workspaceId: string, refresh: () => void) {
  return {
    request: (draft: HandOffDraft) => ({
      path: PINGS_PATH,
      method: "POST" as const,
      workspaceId,
      body: {
        channel: draft.channel,
        kind: draft.kind,
        body: draft.body,
        toDesktop: true,
        ...(draft.threadId === null ? {} : { threadId: draft.threadId }),
      },
    }),
    // ⚠ NO OPTIMISTIC PATCH. The new row is addressed to the operator, so it
    // lands in this very list — writing a fake one in would show a row with no
    // seq that the refetch then replaces, which reads as a duplicate.
    invalidate: () => [apiPathKey(PINGS_PATH)],
    onSuccess: refresh,
  };
}

export function NeedsYou({
  rows,
  segment,
  workspaceId,
  onRefresh,
}: {
  rows: ChannelPing[];
  segment: string;
  workspaceId: string;
  onRefresh: () => void;
}) {
  const client = useQueryClient();
  const handOff = useApiMutationWith<HandOffDraft, { ping: ChannelPing }>(
    apiRequest,
    handOffConfig(workspaceId, () => {
      void client.invalidateQueries({ queryKey: apiPathKey(PINGS_PATH) });
      onRefresh();
    })
  );

  return (
    <section className="bento flex flex-col p-3.5">
      <h2 className="text-label font-semibold uppercase tracking-wide text-text-secondary">
        Needs you
      </h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-caption text-text-muted">Nothing yet.</p>
      ) : (
        <ul className="mt-1 divide-y divide-border-subtle">
          {rows.map((ping) => {
            const kind = KIND[ping.kind];
            const from =
              ping.senderAgentId === null
                ? "a member"
                : `@agent-${ping.senderAgentId}`;
            const meta = [pingAge(ping.createdAt), ping.channelSlug, from]
              .filter(Boolean)
              .join(" · ");
            return (
              <li
                key={ping.id}
                data-ping-id={ping.id}
                className="flex items-start gap-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="wrap-anywhere text-body font-medium text-text-primary">
                    {ping.body}
                  </p>
                  <p className="mt-0.5 truncate text-caption text-text-muted">
                    {meta}
                  </p>
                  <div className="mt-1.5 flex items-center gap-3">
                    {/* ⚠ ABSENT, NOT DISABLED, when there is no thread — the
                        design-system rule for an action that cannot apply. */}
                    {ping.threadId !== null && (
                      <RouterLink
                        href={threadHref(segment, ping)}
                        className="text-caption font-medium text-link"
                      >
                        Open thread
                      </RouterLink>
                    )}
                    <button
                      type="button"
                      disabled={handOff.pending}
                      data-hand-off={ping.id}
                      onClick={() =>
                        handOff.mutate({
                          channel: ping.channelId,
                          kind: ping.kind,
                          body: `${from}: ${ping.body}`,
                          threadId: ping.threadId,
                        })
                      }
                      className="text-caption font-medium text-text-secondary disabled:opacity-60"
                    >
                      Send to Desktop Agent
                    </button>
                  </div>
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
