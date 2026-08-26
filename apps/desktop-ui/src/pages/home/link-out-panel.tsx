import { cn } from "@/shared/lib/utils";
import { CopyButton } from "@/shared/ui/copy-button";
import { FIELD_WELL } from "@/shared/ui/wells";
import { formatChannelTimestamp, formatDate } from "@/shared/lib/format-time";
import { errorMessage } from "#/components/page-states";
import type { HomePendingLink } from "@/features/home/types";
import { displayUrl, linkGrantLabel, linkUsesLabel } from "./home-rows";
import { useRevokeHomeLink } from "./home-writes";

/**
 * AN INVITATION THAT IS STILL OUT: the URL to send, what it is good for, and
 * the one action that exists.
 *
 * ⚠ THE MOCK'S "RENEW" IS DELETED — there is no renew endpoint, and the same
 * outcome is one click away (mint another). Revoke is `DELETE /api/home/links/
 * {id}`, which is soft and idempotent: the row survives as the record of what
 * was minted, so revoking never erases a relationship that already claimed it.
 *
 * ⚠ REVOKING INVALIDATES THE CHANNELS READ (`home-writes.ts › LINK_READS`), so
 * the chip on the row clears itself from the same refetch that empties this
 * panel. Nothing here edits a cache by hand.
 *
 * ⚠ TWO PLACEMENTS, ONE COMPONENT (2026-08-25). A BOUND link is a state of a
 * channel and renders as a section inside that channel's Info tab; a LEGACY
 * unbound one has no channel to hang off and is still its own row, whose record
 * pane is {@link PendingLinkCard} — the same panel in a floating card. Two
 * copies of a revoke button is how the two come to disagree about what revoking
 * means.
 */
export function LinkOutPanel({ link }: { link: HomePendingLink }) {
  const revoke = useRevokeHomeLink();

  return (
    <div>
      <div
        className={cn(
          FIELD_WELL,
          "flex items-center gap-2 px-3 py-2 font-mono text-small text-text-primary"
        )}
      >
        <span className="min-w-0 flex-1 truncate">{displayUrl(link.url)}</span>
        <CopyButton text={link.url} label="Copy link" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-caption text-text-muted">
        <span>
          {link.expiresAt ? `Expires ${formatDate(link.expiresAt)}` : "No expiry"}
        </span>
        <span aria-hidden>·</span>
        <span>{linkUsesLabel(link)}</span>
        <span aria-hidden>·</span>
        {/* ⚠ A LABEL, NOT AN EXPLAINER (the minimal-copy ruling): three words in
            the row that already states expiry and uses, not a sentence about
            what a guest may do. It is the only place an operator can see which
            grant the open invitation carries. */}
        <span>{linkGrantLabel(link)}</span>
        <span aria-hidden>·</span>
        <span>Sent {formatChannelTimestamp(link.createdAt)}</span>
      </div>
      {revoke.error ? (
        <p className="mt-2.5 text-caption text-danger" role="alert">
          {errorMessage(revoke.error)}
        </p>
      ) : null}
      <button
        type="button"
        disabled={revoke.pending}
        onClick={() => revoke.mutate(link.id)}
        className="btn-light mt-3 rounded-[8px] px-3.5 py-1.5 text-small text-danger disabled:opacity-60"
      >
        Revoke
      </button>
    </div>
  );
}

/**
 * The record pane for a LEGACY unbound link — one nobody has claimed and which
 * names no container, so it is a row of its own rather than a channel's state.
 *
 * ⚠ NOTHING CAN MINT ANOTHER (2026-08-24, the inversion): every new link is
 * bound to the channel it adds a person to. This renders the tail that predates
 * that, and it goes away on its own as those tokens are claimed or expire.
 */
export function PendingLinkCard({ link }: { link: HomePendingLink }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="bento w-[380px] rounded-[14px] px-5 py-4">
        <div className="mb-2.5 text-label font-semibold uppercase tracking-wide text-text-muted">
          {link.label ?? "Channel link"}
        </div>
        <LinkOutPanel link={link} />
      </div>
    </div>
  );
}
