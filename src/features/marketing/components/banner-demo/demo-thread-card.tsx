"use client";

/**
 * **THE AGENT THREAD CARD, REDESIGNED FOR THE BANNER DEMO ONLY** (Samuel, 2026-10-22:
 * "given the design theme of the other demo portions, and the onboarding pages, can u
 * redesign that box?").
 *
 * ⚠ **THE PRODUCT CARD IS UNTOUCHED.** `channels/components/thread-card-row.tsx ›
 * ThreadCardMessage` (the dark "Agent thread" shell) is shared with the real app on web
 * and desktop, and the message pane offers no seam to replace it. So the scene still
 * renders the product card, and {@link DemoThreadCards} hides its shell and portals this
 * face into a host right after it, inside the same row (`demo-swap.ts`). The row's attribution
 * pill, reveal motion and stick-to-bottom scroll all stay the product's own.
 *
 * Same facts as the product card: the "Agent thread" label, the thread title, the opening
 * line, who it belongs to (here the posting agent as a PairedAvatar, where the product
 * draws a bare addressee pill), plus the thread's status and the two actions.
 */

import { useMemo, type RefObject } from "react";
import { createPortal } from "react-dom";
import { MessagesSquare } from "lucide-react";
import type { ChannelMessage } from "@/features/channels/types";
import type { AuthorIndex } from "@/features/channels/components/view-model";
import type {
  ThreadCardRow,
  TranscriptRow,
} from "@/features/channels/components/view-model-rows";
import { parseAgentPostStamp } from "@/features/channels/lib/agent-post-stamp";
import { PairedAvatar } from "@/features/onboarding/components/paired-avatar";
import { colorSlot, useDemoSwap } from "./demo-swap";
import { identityFace } from "./demo-identities";

/** The product shell this face replaces; `thread-card-row.tsx` is the only wearer. */
const PRODUCT_SHELL = ".bg-surface-cta.ring-surface-cta";

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  closed: "Closed",
};

function ownerLabel(authorLabel: string): string {
  if (authorLabel === "You") return "Your agent";
  const first = authorLabel.trim().split(/\s+/)[0] || "Member";
  return `${first}'s agent`;
}

export function DemoThreadCard({
  row,
  agentName,
  agentColor,
  agentLogo,
  onOpen,
}: {
  row: ThreadCardRow;
  agentName: string | null;
  agentColor: string | null;
  /** The agent's runtime badge (`demo-identities.ts`). */
  agentLogo: string;
  onOpen: () => void;
}) {
  const thread = row.threads[0];
  const status = STATUS_LABEL[thread.status] ?? thread.status;
  return (
    <div className="lp-demo-tc">
      <div className="lp-demo-tc-head">
        <span className="lp-demo-tc-kind">
          <span className="lp-demo-tc-kind-tile">
            <MessagesSquare size={11} strokeWidth={2.2} aria-hidden />
          </span>
          Agent thread
        </span>
        <span className="lp-demo-tc-status" data-status={thread.status}>
          <i />
          {status}
        </span>
      </div>

      <div>
        <p className="lp-demo-tc-title">{thread.title}</p>
        <p className="lp-demo-tc-preview">{row.preview}</p>
      </div>

      <div className="lp-demo-tc-well">
        <PairedAvatar
          d={28}
          photo={row.author.avatarUrl ?? undefined}
          agentLogo={agentLogo}
          color={colorSlot(agentColor)}
          thinFrame
        />
        <span className="lp-demo-tc-who">
          <span className="lp-demo-tc-agent">{agentName ?? row.authorLabel}</span>
          <span className="lp-demo-tc-owner">{ownerLabel(row.authorLabel)}</span>
        </span>
        <span className="lp-demo-tc-actions">
          {/* The demo has no bridge, so this one goes nowhere, as the product's refuses. */}
          <button type="button" className="lp-demo-tc-btn lp-demo-tc-btn--ink">
            Launch agent
          </button>
          <button type="button" className="lp-demo-tc-btn" onClick={onOpen}>
            Open thread
          </button>
        </span>
      </div>
    </div>
  );
}

/**
 * Finds each thread card's row in the pane and portals {@link DemoThreadCard} after the
 * product shell (`demo-swap.ts`).
 */
export function DemoThreadCards({
  paneRef,
  rows,
  messages,
  index,
  onOpenThread,
}: {
  paneRef?: RefObject<HTMLDivElement | null>;
  rows: readonly TranscriptRow[];
  messages: readonly ChannelMessage[];
  index: AuthorIndex;
  onOpenThread: () => void;
}) {
  const cards = useMemo(
    () => rows.filter((r): r is ThreadCardRow => r.kind === "thread-card"),
    [rows]
  );
  const swaps = useDemoSwap(
    paneRef,
    (pane) =>
      cards.flatMap((card) => {
        const shell = pane
          .querySelector(`[data-message-id="${card.id}"]`)
          ?.querySelector<HTMLElement>(PRODUCT_SHELL);
        return shell ? [{ key: card.id, source: shell }] : [];
      }),
    "lp-demo-tc-host"
  );

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const agentOf = useMemo(() => {
    const out = new Map<
      string,
      { name: string | null; color: string | null; logo: string }
    >();
    for (const m of messages) {
      const agentId = parseAgentPostStamp(m.clientMsgId);
      const entry = agentId ? index.agents.get(agentId) : undefined;
      out.set(m.id, {
        name: entry?.displayName ?? null,
        color: entry?.color ?? null,
        logo: identityFace(agentId).logo,
      });
    }
    return out;
  }, [messages, index]);

  return (
    <>
      {swaps.map(({ key: id, host: el }) => {
        const row = byId.get(id);
        if (!row) return null;
        const agent = agentOf.get(id);
        return createPortal(
          <DemoThreadCard
            row={row}
            agentName={agent?.name ?? null}
            agentColor={agent?.color ?? null}
            agentLogo={agent?.logo ?? identityFace(null).logo}
            onOpen={onOpenThread}
          />,
          el,
          id
        );
      })}
    </>
  );
}
