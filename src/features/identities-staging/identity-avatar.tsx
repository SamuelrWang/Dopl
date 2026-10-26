"use client";

/**
 * THE IDENTITY FACE ON A CARD — a STAGING FORK of
 * `src/features/onboarding/components/paired-avatar.tsx › PairedAvatar`, kept here because the
 * card redesign needs two things that one cannot do (PORTING.md: copy a kit primitive in before a
 * redesign changes it):
 *
 * 1. **The badge is OPTIONAL.** `PairedAvatar` always draws the runtime circle, and `Img` fills an
 *    absent logo with a grey block. An identity with no runtime selected must show NO badge
 *    (Samuel, 2026-10-22: the runtime icon appears *"if they have a runtime selected"*).
 * 2. **The ring is GREYSCALE.** `PairedAvatar`'s ring is the agent's colour, and an identity has
 *    no colour: it is a saved role, not a running agent. The ring is the kit's raised hairline.
 *
 * Everything else is the locked ratio, imported rather than retyped so it cannot drift:
 * `RING_PX` ring → `WHITE_FRAME_PX` white → photo, badge at half the diameter hanging 0.3 of
 * itself past the bottom-right (`docs/DESIGN-LANGUAGE.md` §3).
 */

import { UserRound } from "lucide-react";
import {
  Face,
  Img,
  RING_PX,
  WHITE_FRAME_PX,
} from "@/features/onboarding/components/paired-avatar";

/** The ring and the badge's hairline: the kit's raised line, never an agent colour. */
const RING = "var(--raised-light-line)";

export function IdentityAvatar({
  d,
  photo,
  runtimeLogo,
}: {
  /** The person circle's diameter; the badge is half of it (§3). */
  d: number;
  /** The owner's photo. Absent (no roster entry, or they have none) = the profile glyph. */
  photo?: string | null;
  /** The runtime's logo. Absent = NO badge at all, not an empty one. */
  runtimeLogo?: string | null;
}) {
  const badge = d * 0.5;
  return (
    <span
      className="relative block flex-none"
      style={{ width: d, height: d }}
      aria-hidden
    >
      <span
        className="absolute inset-0 block rounded-full"
        style={{ border: `${RING_PX}px solid ${RING}`, boxSizing: "border-box" }}
      >
        <span
          className="block h-full w-full rounded-full"
          style={{
            boxSizing: "border-box",
            padding: WHITE_FRAME_PX,
            background: "var(--raised-light-face)",
          }}
        >
          {photo ? (
            // next/image forbidden: the file it forks also compiles in the Vite SPA.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt=""
              draggable={false}
              className="block h-full w-full rounded-full object-cover"
            />
          ) : (
            // ITEM 7, fix 2: was `bg-bg-inset` (`#f1f1f1`), the grey banned from this page
            // (Samuel: *"I actually want to not use that gray color at all"*). The near-white
            // elevated surface instead; the glyph is what reads, not its backing.
            <span className="grid h-full w-full place-items-center rounded-full bg-bg-elevated text-text-muted">
              <UserRound size={Math.round(d * 0.42)} strokeWidth={2} />
            </span>
          )}
        </span>
      </span>
      {runtimeLogo && (
        <Face
          d={badge}
          round
          ring={RING}
          style={{
            position: "absolute",
            width: badge,
            height: badge,
            right: -badge * 0.3,
            bottom: -badge * 0.3,
          }}
        >
          <Img src={runtimeLogo} px={badge * 0.58} />
        </Face>
      )}
    </span>
  );
}
