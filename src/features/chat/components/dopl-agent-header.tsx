"use client";

import Image from "next/image";

/**
 * Header rendered above each AI-side message in the private chat.
 * Mirrors the user-side header (avatar + name) so both sides feel
 * symmetric — the same visual weight is applied regardless of who's
 * speaking.
 */
export function DoplAgentHeader({ streaming = false }: { streaming?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={
          "shrink-0 flex items-center justify-center w-6 h-6 rounded-md overflow-hidden bg-surface-raised-3 border border-border-default " +
          (streaming ? "animate-pulse" : "")
        }
        aria-hidden
      >
        <Image
          src="/favicons/favicon-32x32.png"
          alt=""
          width={20}
          height={20}
          className="rounded-sm"
        />
      </span>
      <span className="text-[12px] font-medium uppercase tracking-wider text-text-primary">
        Dopl agent
      </span>
    </div>
  );
}
