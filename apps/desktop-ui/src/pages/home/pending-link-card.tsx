import { cn } from "@/shared/lib/utils";
import { CopyButton } from "@/shared/ui/copy-button";
import { FIELD_WELL } from "@/shared/ui/wells";
import { formatChannelTimestamp, formatDate } from "@/shared/lib/format-time";
import { errorMessage } from "#/components/page-states";
import type { HomePendingLink } from "@/features/home/types";
import { displayUrl, linkUsesLabel } from "./home-rows";
import { useRevokeHomeLink } from "./home-writes";

/**
 * The record pane for a link nobody has claimed yet: the URL to send, what it
 * is good for, and the one action that exists.
 *
 * ⚠ THE MOCK'S "RENEW" IS DELETED — there is no renew endpoint, and the same
 * outcome is one click away (mint another). Revoke is `DELETE /api/home/links/
 * {id}`, which is soft and idempotent: the row survives as the record of what
 * was minted, so revoking never erases a relationship that already claimed it.
 */
export function PendingLinkCard({ link }: { link: HomePendingLink }) {
  const revoke = useRevokeHomeLink();

  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="bento w-[380px] rounded-[14px] px-5 py-4">
        <div className="text-label font-semibold uppercase tracking-wide text-text-muted">
          {link.label ?? "Channel link"}
        </div>
        <div
          className={cn(
            FIELD_WELL,
            "mt-2.5 flex items-center gap-2 px-3 py-2 font-mono text-small text-text-primary"
          )}
        >
          <span className="min-w-0 flex-1 truncate">{displayUrl(link.url)}</span>
          <CopyButton text={link.url} label="Copy link" />
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-caption text-text-muted">
          <span>
            {link.expiresAt ? `Expires ${formatDate(link.expiresAt)}` : "No expiry"}
          </span>
          <span aria-hidden>·</span>
          <span>{linkUsesLabel(link)}</span>
          <span aria-hidden>·</span>
          <span>Sent {formatChannelTimestamp(link.createdAt)}</span>
        </div>
        {revoke.error ? (
          <p className="mt-2.5 text-caption text-danger" role="alert">
            {errorMessage(revoke.error)}
          </p>
        ) : null}
        <div className="mt-3.5 flex items-center gap-2">
          <button
            type="button"
            disabled={revoke.pending}
            onClick={() => revoke.mutate(link.id)}
            className="btn-light rounded-[8px] px-3.5 py-1.5 text-small text-danger disabled:opacity-60"
          >
            Revoke
          </button>
        </div>
      </div>
    </div>
  );
}
