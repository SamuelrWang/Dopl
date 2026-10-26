"use client";

/**
 * THE PAGE HEAD (item 3c, ideas 2 + 4) — two page-level conditions on one row, in two containers
 * because they are two facts (the 2c rule): **what you are looking at**, and **whether it can run**.
 *
 * ⚠ **NOT A STATS STRIP.** Samuel: *"I don't know if it should be a strip."* A strip of numbers is
 * a dashboard, and this page is for picking a role. These are the two things that change what the
 * grid below MEANS, so they sit above it and nothing else does:
 *
 * - **The scope control is a control, not a label.** The old page was bound to the selected channel
 *   and only a section heading admitted it. Now the page shows every channel and this is how you
 *   narrow it, which is what *"show the scoping, not just a header"* asks for.
 * - **Readiness is quiet when it is fine.** One muted line with a green dot when every runtime can
 *   launch; it only grows a word and an amber mark when one needs you. A row that shouts when
 *   nothing is wrong teaches people to ignore it.
 */

import { AlertTriangle, Hash } from "lucide-react";
import { cn } from "@/shared/lib/utils";
// ITEM 7: the staging copy, whose default face is `bare` — label + chevron, no pill (Samuel:
// *"For dropdowns, it should just be the arrow. We don't need the whole pill around it"*). The
// kit's `flat` face, which this wore, is also the banned `--bg-inset` grey.
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import {
  STAGING_CHANNELS,
  type ChannelScope,
  type RuntimeReadiness,
} from "./identity-page-data";

const ALL = "all";

export function IdentityPageHead({
  scope,
  onScope,
  runtimes,
  sharedCount,
  personalCount,
}: {
  scope: ChannelScope;
  onScope: (next: ChannelScope) => void;
  runtimes: ReadonlyArray<RuntimeReadiness>;
  /** How many rows the grid is showing at this scope, so the scope control's effect is visible. */
  sharedCount: number;
  personalCount: number;
}) {
  const options: ReadonlyArray<SelectMenuOption<string>> = [
    {
      value: ALL,
      label: "All channels",
      description: "Every identity shared with you, wherever it lives",
    },
    ...STAGING_CHANNELS.map((channel) => ({
      value: channel,
      label: channel,
      description: `Only identities shared in ${channel}`,
    })),
  ];

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-1">
      <SelectMenu
        variant="bare"
        value={scope}
        options={options}
        onChange={onScope}
        ariaLabel="Which channels to show"
        icon={<Hash size={12} strokeWidth={2.5} className="text-text-muted" aria-hidden="true" />}
        // The page's own condition, so it is the one dropdown that reads at body size.
        className="text-small"
      />
      {/* What the scope is actually doing to the grid, in the operator's own units. */}
      <p className="min-w-0 truncate text-caption text-text-muted">
        {sharedCount} shared{scope === ALL ? " across your channels" : ` in ${scope}`} ·{" "}
        {personalCount} personal
      </p>
      <RuntimeReadinessRow runtimes={runtimes} />
    </div>
  );
}

/**
 * Every runtime's launch state in one line. All ready is one sentence with no names in it: naming
 * two runtimes that are both fine is noise. Anything else names the ones that need you, because
 * that is the only part that is actionable.
 */
function RuntimeReadinessRow({ runtimes }: { runtimes: ReadonlyArray<RuntimeReadiness> }) {
  const blocked = runtimes.filter(
    (r): r is RuntimeReadiness & { state: "reauth" | "signin" } => r.state !== "ready"
  );

  // ⚠ NO `ml-auto` (the Blank Space Rule, Standing Rule 1 in `Plans/UI Standing Rules`). Pinned to the far right, readiness left a hole of most of
  // the pane between the scope summary and itself. It is a condition of the same sentence, so it
  // sits at the end of that sentence and the line is as wide as what it says.
  if (blocked.length === 0) {
    return (
      <p className="flex flex-none items-center gap-1.5 text-caption text-text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
        All runtimes ready
      </p>
    );
  }

  return (
    <p className="flex min-w-0 flex-none items-center gap-1.5 text-caption">
      <AlertTriangle
        size={12}
        strokeWidth={2}
        className="flex-none text-warning"
        aria-hidden="true"
      />
      <span className="min-w-0 truncate text-text-secondary">
        {blocked.map((r) => `${r.label} ${WORD[r.state]}`).join(" · ")}
      </span>
      {/* The fix is one click away in the real app (Settings → Runtimes); here it is the shape. */}
      <button
        type="button"
        // ITEM 7, fix 2: was the banned `--bg-inset` grey. White on a hairline, the card's own
        // chip family, with the 2% ink tint on hover (`--surface-raised-1`).
        className={cn(
          "flex-none rounded-full border border-border-default bg-white px-2 py-0.5 text-micro font-medium",
          "text-text-primary transition-colors hover:bg-surface-raised-1"
        )}
      >
        {blocked.length === 1 ? WORD_ACTION[blocked[0].state] : "Fix runtimes"}
      </button>
    </p>
  );
}

/** What a blocked runtime's state is called, and what the button to fix it says. */
const WORD: Record<"reauth" | "signin", string> = {
  reauth: "needs re-auth",
  signin: "is not signed in",
};
const WORD_ACTION: Record<"reauth" | "signin", string> = {
  reauth: "Re-authorize",
  signin: "Sign in",
};
