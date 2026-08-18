"use client";

/**
 * Channels v2 — THE INBOX, in the center column: every request that is waiting
 * on THIS viewer, each one as a launch panel (`components/launch-panel.tsx`).
 *
 * It lives behind the sidebar's Inbox nav row (MAPPING.md § Q&A, second round:
 * "consent inbox lives in the sidebar Inbox nav row"), whose badge has counted
 * these same rows since Phase 2. Phase 8 gives the count somewhere to go.
 *
 * ⚠ THIS IS THE ADDRESSEE'S SIDE, and it is the only side that exists. A
 * consent read is scoped to `(operator, workspace)` with the operator always
 * `ctx.userId` (INVARIANTS §6), so a REQUESTER cannot see their addressee's
 * state at all — the mock's "1 of 3 agents approved" is a projection that does
 * not exist (F-206). What is listed here is what you owe an answer on; a
 * request you SENT never appears.
 *
 * ⚠ NO NEW READ AND NO NEW WRITE. The rows are the page's existing
 * `use-consent-inbox` result, handed down; the decision is
 * `use-channel-preference-writes.ts › consent`, the same optimistic
 * `PATCH /consent/[id]` the shipping page has always used — same TTL, same CAS
 * on `status = 'pending'`, same cache drop on success. Only `.consent` is
 * touched; the hook's `trust` mutation is never called from this surface
 * (auto-launch is ON HOLD).
 *
 * ⚠ Deliberately WORKSPACE-WIDE, not scoped to the open channel — it is the
 * landing spot Phase 9's notification click navigates to, and a notification
 * may name any channel.
 */

import { useState } from "react";
import { Inbox } from "lucide-react";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import { LaunchPanel } from "../launch-panel";
import { useChannelPreferenceWrites } from "../../hooks/use-channel-preference-writes";
import type { ChannelConsentRequest } from "../../types";

export function ChannelsV2InboxPane({
  workspaceId,
  currentUserId,
  requests,
  gate,
}: {
  workspaceId: string;
  currentUserId: string;
  /** The viewer's pending requests, workspace-wide — the same array the
   *  sidebar's Inbox badge counts. */
  requests: ChannelConsentRequest[];
  /** The page's refetch coordinator, so a decision cannot be clobbered by a
   *  realtime event mid-write (INVARIANTS §7/§8). */
  gate: MutationGate;
}) {
  const { consent } = useChannelPreferenceWrites({
    workspaceId,
    currentUserId,
    gate,
  });
  // Double-fire guard ONLY — the optimistic half is the mutation's cache patch,
  // so nothing here mirrors a server value.
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );

  async function decide(id: string, decision: "allow" | "deny") {
    if (busyIds.has(id)) return;
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await consent.mutateAsync({ id, decision });
    } catch {
      // Rollback + toast belong to the mutation; this only clears the guard.
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <section aria-label="Inbox" className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-[56px] shrink-0 items-center gap-2 border-b border-border-default px-4">
        <Inbox size={14} className="shrink-0 text-text-muted" />
        <span className="truncate text-body font-semibold text-text-primary">
          Inbox
        </span>
        <span className="flex-1" />
        <span className="shrink-0 text-caption text-text-muted">
          {requests.length === 0
            ? "Nothing waiting"
            : `${requests.length} waiting on you`}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-[620px] flex-col gap-2.5">
          {requests.length === 0 ? (
            <p className="py-10 text-center text-caption text-text-muted">
              Nothing is waiting on you. Requests addressed to you land here.
            </p>
          ) : (
            requests.map((request) => (
              <LaunchPanel
                key={request.id}
                request={request}
                busy={busyIds.has(request.id)}
                onLaunch={() => void decide(request.id, "allow")}
                onDecline={() => void decide(request.id, "deny")}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}
