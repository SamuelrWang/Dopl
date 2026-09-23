"use client";

import { cn } from "@/shared/lib/utils";
import { AttributionPill } from "./attribution-pill";
import { RecipientTags } from "./recipient-tags";
import type { MessageRow } from "./view-model-rows";
import type { RecipientTag } from "../lib/recipient-tags";
import type { AgentColorKey } from "../types";

/** Frozen default so every row does not get a fresh array identity per render. */
const NO_RECIPIENTS: readonly RecipientTag[] = [];

/** An agent's colour, resolved by `agent-box-rule.ts › agentPostAccent`. No accent (a person, a
 *  channel-less post) draws no frame or bar; `key: null` is an ended agent's neutral face. */
export type AuthoredRowAccent = {
  /** The bank key, or `null` for the neutral face — a DOM hook only, never read back. */
  key: AgentColorKey | null;
  /** A CSS reference (`var(--agent-color-NN)` or `var(--border-strong)`), never a literal. */
  paint: string;
};

/** `self-stretch` makes the bar the row's height; the top end is square to meet the frame. */
const ACCENT_BAR = "w-[3px] shrink-0 self-stretch rounded-b-full";

/**
 * One shape with the bar: a three-sided border ({@link ACCENT_FRAME_EDGE}) whose 3px equals
 * {@link ACCENT_BAR}'s, with no top pull so both start at the same y. The hover lift is here so
 * pill and border move as one; 2px (not the kit's 1px) because the face has no hover fill.
 */
const ACCENT_FRAME =
  "inline-flex max-w-full border-[3px] border-solid -mb-[3px] shadow-[var(--shadow-bento)] transition-transform duration-150 has-[button:hover]:-translate-y-0.5 has-[button:active]:translate-y-0.5 motion-reduce:transition-none";

/** Square on the bar side, a stadium elsewhere; the frame and the pill take the same constant. */
const ACCENT_RADIUS = {
  me: "rounded-l-full rounded-r-none",
  peer: "rounded-r-full rounded-l-none",
} as const;

/** No border on the bar side (the bar is that edge); the outer pull cancels the outer border. */
const ACCENT_FRAME_EDGE = {
  me: "border-r-0 -ml-[3px]",
  peer: "border-l-0 -mr-[3px]",
} as const;

/** Content is inset 8px from the bar; the frame pulls back 8px to meet it. Move as a pair. */
const GUTTER = { me: "pr-2", peer: "pl-2" } as const;
const GUTTER_PULL = { me: "-mr-2", peer: "-ml-2" } as const;

/** Jump-to-message flash: the elevation grey, not `--link` blue (blue means "addressed"). */
export const FLASH_TINT = "bg-surface-raised-3";

/** The shell every authored row shares: pill (+ recipients) header over the body, aligned by `side`
 *  (INVARIANTS §5). A continuation drops the header; an accented one keeps its bar. */
export function AuthoredRow({
  id,
  side,
  author,
  authorLabel,
  time,
  agent,
  external = false,
  agentId = null,
  agentName = null,
  recipients = NO_RECIPIENTS,
  continuation,
  flash,
  accent = null,
  onOpenAgent,
  children,
}: {
  id: string;
  side: "me" | "peer";
  author: MessageRow["author"];
  authorLabel: string;
  time: string;
  agent: boolean;
  /** An outside session wrote it; forwarded from `lib/desktop-handle.ts › authorViewOf`. */
  external?: boolean;
  /** WHICH agent, when the writer stamped it. */
  agentId?: string | null;
  /** Its current name, resolved by the caller from `AuthorIndex.agents`; never a row field. */
  agentName?: string | null;
  /** Who it reached, resolved by `lib/recipient-tags.ts › recipientTags`; empty draws nothing. */
  recipients?: readonly RecipientTag[];
  continuation: boolean;
  flash: boolean;
  /** Caller decides via `agent-box-rule.ts › agentBoxOf` (shared with the transcript filter). */
  accent?: AuthoredRowAccent | null;
  /** Already gated by the caller. */
  onOpenAgent?: () => void;
  children: React.ReactNode;
}) {
  const mine = side === "me";
  const edge = mine ? "me" : "peer";
  const pill = continuation ? null : (
    <AttributionPill
      author={author}
      authorLabel={authorLabel}
      agent={agent}
      external={external}
      agentId={agentId}
      agentName={agentName}
      // The same paint as the bar and frame, so one agent cannot show two hues.
      agentPaint={accent?.paint ?? null}
      radius={accent ? ACCENT_RADIUS[edge] : undefined}
      framed={accent !== null}
      time={time}
      onOpenAgent={onOpenAgent}
    />
  );
  // No recipients ⇒ the bare pill (DOM unchanged); reversed on own side so the pill stays first.
  const header = (node: React.ReactNode) =>
    recipients.length === 0 ? (
      node
    ) : (
      <div
        className={cn(
          "flex min-w-0 max-w-full flex-wrap items-center gap-1.5",
          mine && "flex-row-reverse"
        )}
      >
        {node}
        <RecipientTags tags={recipients} />
      </div>
    );
  /* `w-full` so the column is the row's full width whatever the article's
     align-items says — the pill hugs its content, the bodies must not. */
  const body = (
    <div className={cn("flex w-full min-w-0 flex-col gap-1.5", mine && "items-end")}>
      {children}
    </div>
  );

  if (!accent) {
    return (
      <article
        data-message-id={id}
        className={cn(
          // Negative margin + padding: the row owns the strip the flash tints, so no layout shift.
          "-mx-2 flex flex-col gap-1.5 rounded-[10px] px-2 py-1 transition-colors duration-700",
          mine ? "items-end" : "items-start",
          flash && `${FLASH_TINT} duration-150`
        )}
      >
        {pill && header(pill)}
        {body}
      </article>
    );
  }

  return (
    <article
      data-message-id={id}
      /* DOM hook for tests and host restyles; absent on the neutral face. */
      data-agent-color={accent.key ?? undefined}
      className={cn(
        // Same strip as a bare row, so the transcript does not step as authors alternate.
        "-mx-2 flex items-stretch rounded-[10px] px-2 py-1 transition-colors duration-700",
        // Bar on the outer edge; a reversal keeps the bar first in the DOM either way.
        mine ? "flex-row-reverse" : "flex-row",
        flash && `${FLASH_TINT} duration-150`
      )}
    >
      <span aria-hidden className={ACCENT_BAR} style={{ backgroundColor: accent.paint }} />
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-1.5",
          mine ? "items-end" : "items-start",
          GUTTER[edge]
        )}
      >
        {pill &&
          header(
            <span
              className={cn(
                ACCENT_FRAME,
                ACCENT_RADIUS[edge],
                ACCENT_FRAME_EDGE[edge],
                GUTTER_PULL[edge]
              )}
              /* Inline: the palette key is data, so the JIT cannot see `var(--agent-color-NN)`.
                 `lib/agent-colors.ts › agentColorVar` is the only place the token is spelled. */
              style={{ borderColor: accent.paint }}
            >
              {pill}
            </span>
          )}
        {body}
      </div>
    </article>
  );
}
