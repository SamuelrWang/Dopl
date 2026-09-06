"use client";

/**
 * Channels v2 — THE ARTIFACT CARD: one folded run, standing where its messages
 * were (artifacts design #1220 §4, accepted wholesale at #1222; A4 closing
 * slice, 2026-09-06).
 *
 * ⚠ **IT IS THE FIRST RENDERER OF THE `entries` ENVELOPE, AND THE ENVELOPE IS
 * STILL ADDITIVE.** `server/service-reads.ts › readTranscript` returns the full
 * `messages` page BESIDE `entries`, and `entries === null` means "nothing on
 * this page is in an artifact" rather than "this server cannot fold". So this
 * card draws from `entries` where they are present and the transcript keeps
 * rendering `messages` where they are not. **The breaking flip — dropping
 * `messages` once every renderer reads entries — is a HUMAN decision and is on
 * Samuel's batch** (ruled in the Mobile Command Center room, 2026-09-06). It is
 * deliberately not assumed here by the card's own author.
 *
 * ⚠ **THE CLAMP IS A HEIGHT, NEVER A SLICE** — A1's bounded-container idiom
 * (`agent-stream-sent-box.tsx › SentBody`), reused for the same reason it exists
 * there: a folded body is MARKDOWN, and cutting the STRING renders the wreckage
 * of a fence or a link. Every character of the run is in the DOM while
 * collapsed; the container is what is bounded.
 *
 * ⚠ **THIS FILE OWNS ITS OWN CONSTANTS AND ADDS NOTHING TO A1's** (the same
 * ruling). The disclosure words are byte-identical to the log lane's and to the
 * sent box's on purpose — one stream, one verb for "there is more of this than
 * you are being shown" — but they are declared here rather than imported,
 * because A1's card and this one are free to move apart and neither should be
 * pinned to the other's export list.
 *
 * ⚠ **NO DISSOLVED FACE, AND THAT IS NOT AN OMISSION.** Dissolve un-folds every
 * member before it retires the card (`server/service-artifacts.ts ›
 * dissolveArtifact`, in that order and for that reason), so a dissolved artifact
 * has no members left to fold and no page can produce an entry for it. A face
 * for a state this surface cannot reach would be a claim nothing proves.
 */

import { cn } from "@/shared/lib/utils";
import { StreamProse } from "./agent-stream-prose";
import { useOverflowMeasure } from "./use-overflow-measure";
import type { ArtifactMember } from "./view-model-artifacts";

/** The collapse control's two faces. ⚠ THE LOG LANE'S WORDS, DELIBERATELY.
 *  Exported for the tests. */
export const ARTIFACT_EXPAND_LABEL = "Show more";
export const ARTIFACT_COLLAPSE_LABEL = "Show less";

/**
 * HOW MUCH OF THE FOLDED RUN SHOWS BEFORE THE READER ASKS FOR THE REST.
 *
 * ⚠ READ IN `em` AGAINST `text-caption`, so a token change moves the clamp with
 * it — the clip box below carries `text-caption` and `1.5` is `leading-normal`.
 *
 * ⚠ **THE `18px` IS INHERITED FROM A1's CARD AND IS AN APPROXIMATION HERE, NOT
 * THIS BOX'S ARITHMETIC** (corrected 2026-09-06 — the docblock was copied from
 * `agent-stream-sent-box.tsx`, where `18px` is exactly `StreamProse`'s `py-[9px]`
 * top AND bottom, and that sentence was simply false in this file). THIS run's
 * chrome is different in both halves: the body below renders `pb-[9px]` — bottom
 * only, no top — and EVERY MEMBER additionally carries a `pt-1.5` header line
 * (6px) above its body. So the padding inside the bound is per-member and grows
 * with the run, rather than being one fixed 9+9, and "6 lines" is six line-boxes
 * of the clip box rather than six lines of anybody's prose.
 *
 * ⚠ THE VALUE IS DELIBERATELY UNCHANGED: the clamp lands a few pixels off where
 * an exact figure would put it, which is cosmetic — it moves where the run is cut
 * off, never WHETHER the control appears, because that is a measurement
 * (`use-overflow-measure.ts`) and not this number. Retuning the pixels is a
 * visual change and nobody has ruled it.
 *
 * ⚠ THE PAIRING, POINTED AT THE PADDING THIS FILE ACTUALLY HAS: change the body's
 * `pb-[9px]` or the member header's `pt-1.5` below and reconsider this number.
 * That pairing is why it is spelled out rather than being one magic pixel count.
 */
export const COLLAPSED_RUN_LINES = 6;
const COLLAPSED_RUN_MAX_HEIGHT = `calc(${COLLAPSED_RUN_LINES} * 1.5em + 18px)`;

/**
 * WHAT THE CARD SAYS IT HOLDS — **the count and the span, both over the WHOLE
 * artifact and never over the page** (`types.ts › ChannelFoldedArtifact`).
 *
 * ⚠ THE SPAN IS LOAD-BEARING, NOT DECORATION (#1220 §7, fork 3): a reader
 * holding an old citation can tell from `#first–#last` WHICH card holds it
 * without opening anything, and the count beside it says honestly whether the
 * artifact is a solid run or a selection out of one.
 */
export function artifactSpanLabel(
  count: number,
  firstSeq: number,
  lastSeq: number
): string {
  const messages = `${count} ${count === 1 ? "message" : "messages"}`;
  return firstSeq === lastSeq
    ? `${messages} · #${firstSeq}`
    : `${messages} · #${firstSeq}–#${lastSeq}`;
}

/**
 * ⚠ **THE PAGE MAY HOLD FEWER MEMBERS THAN THE ARTIFACT HAS, AND SAYING SO IS
 * THE CONTRACT** (INVARIANTS §9 — at the ceiling is indistinguishable from over
 * it). An artifact spans the channel; this page is a window on it. A card that
 * printed "12 messages" over four bodies and said nothing would read as a card
 * that had lost eight.
 */
export function artifactPartialLabel(shown: number, count: number): string {
  return `Showing ${shown} of ${count} here — open the artifact for the rest`;
}

/**
 * THE FOLDED RUN, BOUNDED — and the control appears ONLY on a run that is
 * actually taller than the bound.
 *
 * ⚠ THE MEASUREMENT IS `use-overflow-measure.ts`, SHARED WITH A1's SENT BOX
 * (extracted 2026-09-06; the two were byte-identical copies). Why it measures at
 * all rather than reading the CSS, why the observer watches the inner content,
 * and why it runs only while collapsed are all recorded there. What stays here is
 * what this card owns: its constants, its labels and its clip-box markup — the
 * ruling above is untouched, nothing is imported from A1's file, and nothing was
 * added to A1's exports.
 *
 * ⚠ `members.length` IS THIS CARD'S RE-MEASURE TRIGGER, and it is deliberately
 * NOT the sent box's `text`: a run gains whole MEMBERS where a streamed body
 * grows character by character. It re-measures after a realtime message joins the
 * run even where `ResizeObserver` is absent (jsdom, old hosts).
 */
function FoldedRun({ members }: { members: ArtifactMember[] }) {
  const {
    open,
    setOpen,
    overflows,
    clipRef,
    contentRef,
    boxId: runId,
  } = useOverflowMeasure({ remeasureOn: members.length });

  return (
    <>
      <div
        ref={clipRef}
        id={runId}
        className="min-w-0 overflow-hidden text-caption"
        style={open ? undefined : { maxHeight: COLLAPSED_RUN_MAX_HEIGHT }}
      >
        <div ref={contentRef} className="flex flex-col">
          {members.map((member) => (
            <div key={member.id} data-artifact-member={member.seq} className="min-w-0">
              <p className="flex items-center gap-1.5 px-3 pt-1.5 text-micro text-text-muted">
                <span className="min-w-0 truncate">{member.authorLabel}</span>
                <span className="shrink-0 opacity-75">#{member.seq}</span>
                <span className="ml-auto shrink-0">{member.time}</span>
              </p>
              {/* ⚠ MARKDOWN, LIKE EVERY OTHER MESSAGE FACE (Samuel, 2026-08-31).
                  It is the SAME STRING the transcript renders one row up, so a
                  message that read as formatted before it was folded must not
                  read as raw asterisks after. */}
              <StreamProse
                text={member.body}
                className="px-3 pb-[9px]"
                textClassName="text-caption leading-normal text-text-primary"
              />
            </div>
          ))}
        </div>
      </div>
      {overflows && (
        <div className="flex px-3 pb-2.5">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={runId}
            className="text-micro font-medium text-link"
          >
            {open ? ARTIFACT_COLLAPSE_LABEL : ARTIFACT_EXPAND_LABEL}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * ONE CARD PER ARTIFACT PER PAGE, drawn where its lowest member on this page
 * sat.
 *
 * ⚠ **IT IS NOT A MESSAGE BUBBLE AND IT TAKES NO SIDE** (INVARIANTS §5 governs
 * sides, and an artifact is not somebody's words — it is a view decision over
 * several people's). It spans the transcript's full width like the thread card
 * and the sent box do, for the same reason: a record, not a turn.
 *
 * ⚠ **A CARD WITH NO MEMBERS ON THE PAGE STILL RENDERS, HEADER ONLY.** Missing
 * bodies degrade to a card without a run, never to a dropped row — the same rule
 * `foldEntries` keeps on the server, where a member whose artifact facts could
 * not be loaded renders as a message rather than vanishing.
 */
export function ArtifactCard({
  id,
  name,
  summary,
  count,
  firstSeq,
  lastSeq,
  members,
  flash = false,
}: {
  id: string;
  name: string;
  summary: string;
  /** Total members, channel-wide — never the count on this page. */
  count: number;
  firstSeq: number;
  lastSeq: number;
  /** The members that are ON THIS PAGE, in seq order. May be empty. */
  members: ArtifactMember[];
  /** Briefly set right after a Tags-inbox click lands on this row. */
  flash?: boolean;
}) {
  return (
    <section
      data-artifact-id={id}
      className={cn(
        "min-w-0 overflow-hidden rounded-[12px] border border-border-active bg-card-surface-subtle",
        flash && "ring-2 ring-link"
      )}
    >
      <div className="flex items-center gap-1.5 bg-surface-cta px-2.5 py-[5px]">
        <span className="min-w-0 truncate text-micro font-medium text-text-on-cta">
          {name}
        </span>
        <span className="ml-auto shrink-0 text-micro text-text-on-cta opacity-75">
          {artifactSpanLabel(count, firstSeq, lastSeq)}
        </span>
      </div>
      {summary !== "" && (
        <p className="wrap-anywhere px-3 pt-2 text-caption text-text-muted">{summary}</p>
      )}
      {members.length > 0 && <FoldedRun members={members} />}
      {members.length > 0 && members.length < count && (
        <p className="px-3 pb-2.5 text-micro text-text-muted">
          {artifactPartialLabel(members.length, count)}
        </p>
      )}
    </section>
  );
}
