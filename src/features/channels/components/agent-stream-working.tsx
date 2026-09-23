"use client";

/**
 * Live tail of the work stream: `agents-model.ts › agentLiveness`'s label plus animated dots, only while the
 * tone is `working` (gated here, not in the hosts). It stays inside the scroller under the most recent item,
 * in addition to the header pill.
 */

import type { AgentLivenessState } from "./agents-model";

/** The label minus its trailing ellipsis (the dots replace it) — a trim, never a rewrite. */
export function workingRowWord(label: string): string {
  return label.replace(/(…|\.\.\.)\s*$/, "").trimEnd();
}

/** Not an `<li>`: it renders after the `<ol>`, so it shows on an empty lane too. */
export function StreamWorkingRow({
  liveness,
}: {
  /** `null` when the host has no session to read. */
  liveness?: AgentLivenessState | null;
}) {
  if (!liveness || liveness.tone !== "working") return null;
  return (
    <p
      role="status"
      className="flex min-w-0 items-center gap-1 pt-0.5 text-caption text-text-secondary"
    >
      {workingRowWord(liveness.label)}
      <span aria-hidden className="flex shrink-0 items-center gap-[3px]">
        {/* Static class strings (Tailwind can't see runtime-built delays); stock `animate-pulse`, since a
            custom keyframe would have to land in both globals.css and the desktop's kit.css. */}
        <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:0ms] [animation-duration:1.4s] motion-reduce:animate-none" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:200ms] [animation-duration:1.4s] motion-reduce:animate-none" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:400ms] [animation-duration:1.4s] motion-reduce:animate-none" />
      </span>
    </p>
  );
}
