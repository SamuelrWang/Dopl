import { userFacingMessage } from "@/shared/api/user-facing-message";
import { cn } from "@/shared/lib/utils";
import { CopyButton } from "@/shared/ui/copy-button";
import { RAISED_WELL } from "@/shared/ui/wells";
import { formatChannelTimestamp, formatDate } from "@/shared/lib/format-time";
import type { ChannelPendingLink } from "@/features/channels/types";
import { displayUrl, linkGrantLabel, linkUsesLabel } from "./home-rows";
import { useRevokeHomeLink } from "./home-writes";

/**
 * An invitation that is still out: the URL, what it is good for, and Revoke (`DELETE
 * /api/home/links/{id}`, soft and idempotent). Revoking invalidates the channels read
 * (`home-writes.ts › LINK_READS`), so the row's chip clears from the same refetch. One component
 * for both placements: a bound link's section in the channel Info tab, and a legacy unbound
 * link's own card. The URL sits on `RAISED_WELL`: nothing on /home is pressed in.
 */
export function LinkOutPanel({ link }: { link: ChannelPendingLink }) {
  const revoke = useRevokeHomeLink();

  return (
    <div>
      <div
        className={cn(
          RAISED_WELL,
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
        {/* A label, not an explainer: the only place the invitation's grant is shown. */}
        <span>{linkGrantLabel(link)}</span>
        <span aria-hidden>·</span>
        <span>Sent {formatChannelTimestamp(link.createdAt)}</span>
      </div>
      {revoke.error ? (
        <p className="mt-2.5 text-caption text-danger" role="alert">
          {userFacingMessage(revoke.error)}
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

/** The record pane for a legacy unbound link (it names no container). Nothing mints these any
 *  more; they go away as they are claimed or expire. */
export function PendingLinkCard({ link }: { link: ChannelPendingLink }) {
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
