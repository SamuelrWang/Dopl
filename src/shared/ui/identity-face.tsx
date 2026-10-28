"use client";

import { UserRound } from "lucide-react";
import type { AgentColorKey } from "@dopl/contracts";
import { agentColorVar } from "@/shared/lib/agent-colors";
import { useBridgedImageSrc } from "@/shared/hooks/use-bridged-image-src";
import { cn } from "@/shared/lib/utils";
import { initialFor } from "./avatar";
import { AVATAR_PX, type AvatarScale } from "./avatar-size";

/**
 * 🔒 THE IDENTITY AVATAR RATIO (Samuel, 2026-10-22; DESIGN-LANGUAGE §3): colour ring → white frame
 * of the same width → photo, at every size. The runtime badge is half the diameter, hangs 0.3 of
 * itself past the bottom-right, and wears the same ring on the raised light face.
 */
export const IDENTITY_RING_PX = 2;

/** An agent's colour key rings the face in that colour; `"neutral"` rings it in the raised hairline
 *  (a saved identity, which has no colour). No ring is a person: a plain photo on a hairline. */
type IdentityRing = AgentColorKey | "neutral";

export interface IdentityFaceProps {
  /** The scale step (`avatar-size.ts`); the badge is half of it. */
  size: AvatarScale;
  /**
   * ⚠ RAW DIAMETER, FOR DEMO AND ONBOARDING ART ONLY (scaled showcases, the size sweep). Product
   * surfaces use `size`; a px here is how the 13-size drift came back.
   */
  px?: number;
  photo?: string | null;
  /** Initials when there is no photo; a ringed face with neither shows the profile glyph. */
  name?: string | null;
  ring?: IdentityRing;
  /** Only a ringed face draws it, and only when present: no runtime, no badge. */
  runtimeLogo?: string | null;
  /** Green presence dot, top-right so it never covers the badge. */
  online?: boolean;
  /** Names the face for assistive tech; without it the face is decorative. */
  label?: string;
  className?: string;
}

/** Who a face shows, without how big it is drawn: what a host hands a component that sizes it. */
export type IdentityFacts = Pick<IdentityFaceProps, "photo" | "name" | "ring" | "runtimeLogo">;
export type { AvatarScale };

function initialsTextClass(size: number): string {
  if (size >= 32) return "text-body";
  if (size > 22) return "text-caption";
  return "text-micro";
}

/** Spans only, so a face is valid inside a `<p>` (a recipients line, a meta line). */
export function IdentityFace({
  size: scale,
  px,
  photo,
  name,
  ring,
  runtimeLogo,
  online = false,
  label,
  className,
}: IdentityFaceProps) {
  const size = px ?? AVATAR_PX[scale];
  const src = useBridgedImageSrc(photo);
  const ringColor =
    ring === undefined ? null : ring === "neutral" ? "var(--raised-light-line)" : agentColorVar(ring);
  const badge = size * 0.5;
  const a11y = label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true };
  const initial = name ? initialFor(name, null) : null;

  return (
    <span
      {...a11y}
      data-identity-face=""
      className={cn("relative inline-block flex-none align-middle", className)}
      style={{ width: size, height: size }}
    >
      {ringColor ? (
        <span
          className="block size-full rounded-full"
          style={{
            boxSizing: "border-box",
            border: `${IDENTITY_RING_PX}px solid ${ringColor}`,
            padding: IDENTITY_RING_PX,
            background: "var(--raised-light-face)",
          }}
        >
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element -- shared file, also compiled by Vite
            <img src={src} alt="" draggable={false} className="block size-full rounded-full object-cover" />
          ) : (
            <span
              className={cn(
                "grid size-full place-items-center rounded-full bg-bg-elevated font-semibold text-text-muted",
                initialsTextClass(size)
              )}
            >
              {initial ?? <UserRound size={Math.round(size * 0.42)} strokeWidth={2} />}
            </span>
          )}
        </span>
      ) : (
        <span
          className={cn(
            "grid size-full place-items-center overflow-hidden rounded-full bg-bg-inset font-semibold text-text-secondary",
            initialsTextClass(size)
          )}
          style={{ border: "1px solid var(--raised-light-line)" }}
        >
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element -- shared file, also compiled by Vite
            <img src={src} alt="" draggable={false} className="size-full object-cover" />
          ) : (
            (initial ?? "?")
          )}
        </span>
      )}
      {ringColor && runtimeLogo && (
        <span
          className="absolute grid place-items-center rounded-full"
          style={{
            width: badge,
            height: badge,
            right: -badge * 0.3,
            bottom: -badge * 0.3,
            boxSizing: "border-box",
            border: `${IDENTITY_RING_PX}px solid ${ringColor}`,
            background: "var(--raised-light-face)",
            boxShadow: "var(--raised-light-drop)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- shared file, also compiled by Vite */}
          <img
            src={runtimeLogo}
            alt=""
            draggable={false}
            className="block object-contain"
            style={{ width: badge * 0.58, height: badge * 0.58 }}
          />
        </span>
      )}
      {online && (
        <span
          data-presence="online"
          className="absolute -top-px -right-px size-1.75 rounded-full bg-success"
          style={{ border: "1.5px solid var(--bg-overlay)" }}
        />
      )}
    </span>
  );
}
