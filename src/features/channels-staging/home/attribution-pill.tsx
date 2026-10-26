"use client";

/**
 * **THE AGENT'S BADGE ON A MESSAGE: THE FLAG, NAME AND TIME** (ask 6c, final state 2026-10-24).
 * History: 2026-10-22 flattened the flag for a ringed avatar; 2026-10-23 restored the flag
 * (*"I actually like the flag with the whole border line around the whole thing"*) and dropped
 * the "agent" chip (*"Remove the pill that says the word "agent". That's not needed."*);
 * 2026-10-24 dropped the small runtime icon from the avatar and kept the operator's photo (*"no
 * keep the user profile image only the small agent icon move"*).
 *
 * ⚠ **THE PRODUCT PILL IS UNTOUCHED.** `channels/components/attribution-pill.tsx` is shared
 * with the real web app and the desktop. The scene still renders it;
 * {@link StagingAttributionPills} hides each AGENT pill and portals this face in after it
 * (`demo-swap.ts`), INSIDE the row's frame span. A person's pill is left exactly as it is.
 *
 * ── THE SHAPE ──
 * - **The flag, unchanged.** The product's own frame (`authored-row.tsx › ACCENT_FRAME`): a 3px
 *   border in the agent's colour round the whole pill, open on the bar side and joined to the
 *   row's 3px `ACCENT_BAR`. This face fills it, taking its radius by `inherit`.
 * - **Inside it: the operator's photo, then name over time.** The photo is 32px on a neutral
 *   hairline (no agent-colour ring: the frame is the one coloured line). No runtime icon, no
 *   "agent" chip. Every gap from the frame's inner edges to the photo is 5px (left = top =
 *   bottom, Samuel 2026-10-24), so the frame is 3 + 5 + 32 + 5 + 3 = 48px; the name and time
 *   are centred on the photo.
 */

import { useMemo, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { AuthorIndex } from "@/features/channels/components/view-model";
import type { MessageRow, TranscriptRow } from "@/features/channels/components/view-model-rows";
import { attributionName } from "@/features/channels/components/attribution-pill";
import { Profile } from "@/features/onboarding/components/web-pieces";
import { useDemoSwap } from "@/features/marketing/components/banner-demo/demo-swap";

/** The product pill, inside the row it heads. */
const PRODUCT_PILL = "[data-attribution-pill]";

/** The photo's diameter (ask 6d: 22 was too small). Change with `.uis-ap`'s padding. */
export const PHOTO_PX = 32;

export function StagingAttributionPill({
  name,
  time,
  photo,
  onOpen,
}: {
  name: string;
  time: string;
  /** The operator's photo; absent draws the shared blank profile circle. */
  photo: string | null;
  /** Opens this agent's view; absent leaves a plain badge (absent, not disabled). */
  onOpen?: () => void;
}) {
  const body = (
    <>
      <span className="uis-ap-face" style={{ width: PHOTO_PX, height: PHOTO_PX }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- staging demo face, static asset
          <img src={photo} alt="" draggable={false} className="uis-ap-photo" />
        ) : (
          <Profile d={PHOTO_PX} />
        )}
      </span>
      <span className="uis-ap-who">
        <span className="uis-ap-name">{name}</span>
        <span className="uis-ap-time">{time}</span>
      </span>
    </>
  );
  if (!onOpen) return <span className="uis-ap">{body}</span>;
  return (
    <button type="button" className="uis-ap" aria-label={`Open agent ${name}`} onClick={onOpen}>
      {body}
    </button>
  );
}

/** Finds every AGENT attribution pill in the pane and portals the staged badge after it. */
export function StagingAttributionPills({
  paneRef,
  rows,
  index,
  onOpenAgent,
}: {
  paneRef?: RefObject<HTMLDivElement | null>;
  rows: readonly TranscriptRow[];
  index: AuthorIndex;
  /** STAGING: opens an agent's view on the right, by agent id. */
  onOpenAgent?: (agentId: string) => void;
}) {
  /** Agent rows that actually head a group — a continuation draws no pill. */
  const byId = useMemo(() => {
    const out = new Map<string, MessageRow>();
    for (const row of rows) {
      if (row.kind !== "message" || !row.agent || row.continuation) continue;
      out.set(row.id, row);
    }
    return out;
  }, [rows]);

  const swaps = useDemoSwap(
    paneRef,
    (pane) =>
      [...byId.keys()].flatMap((id) => {
        const pill = pane
          .querySelector(`[data-message-id="${id}"]`)
          ?.querySelector<HTMLElement>(PRODUCT_PILL);
        return pill ? [{ key: id, source: pill }] : [];
      }),
    "uis-ap-host"
  );

  return (
    <>
      {swaps.map(({ key, host }) => {
        const row = byId.get(key);
        if (!row) return null;
        const entry = row.agentId ? index.agents.get(row.agentId) : undefined;
        const openable = row.agentId !== null && onOpenAgent !== undefined;
        return createPortal(
          <StagingAttributionPill
            name={attributionName({
              agent: true,
              agentId: row.agentId,
              authorLabel: row.authorLabel,
              agentName: entry?.displayName ?? null,
            })}
            time={row.time}
            photo={row.author.avatarUrl ?? null}
            onOpen={
              openable && row.agentId
                ? () => onOpenAgent(row.agentId as string)
                : undefined
            }
          />,
          host,
          key
        );
      })}
    </>
  );
}
