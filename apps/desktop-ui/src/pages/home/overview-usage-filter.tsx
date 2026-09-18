import { TEMPLATE_NAME_TEXT } from "@/features/agent-templates/components/template-section";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import { NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import { cn } from "@/shared/lib/utils";
import {
  USAGE_SCOPE_ALL,
  USAGE_SCOPE_DESKTOP,
} from "@/features/home/overview-types";
import { useAccountChannels } from "@/features/channels/hooks/use-channels";
import { homeChannels } from "./home-rows";

/**
 * THE /home USAGE HISTOGRAM'S TWO CONTROLS — the scope dropdown that replaced
 * the **Credits used** heading, and the month arrows beside it.
 *
 * 🔒 **SAMUEL, 2026-09-13, VERBATIM:** *"For the usage credits, remove the
 * credits and the 'Credits used' text. Where you see 'Credits used', I want you
 * to put a dropdown where the user can select: all channels / specific channels /
 * just desktop agent usage. … I also want a left and right arrow that will let me
 * change the month I'm looking at, specifically for the bar graph, like the
 * histogram, not the top bar."*
 *
 * ⚠ **NEITHER CONTROL TOUCHES THE CAPACITY BAR.** The bar is the WALLET's
 * current period off `GET /api/billing/status` (INVARIANTS' /home credits
 * bullet); a month arrow that moved it would print a past month's spend against
 * today's allowance, and a channel filter would print a fraction of the wallet
 * under a full denominator. The two cards ask different questions on purpose.
 *
 * ⚠ **ITS OWN FILE**: `overview-panels.tsx` sits against the 500-line cap (§1),
 * and these two controls change when the SCOPE vocabulary changes while that
 * file changes when the face's layout does.
 *
 * ⚠ **STATE IS THE SESSION'S, NOT THE ACCOUNT'S.** Nothing is persisted — the
 * pane opens on **All channels** and the current month every time. A remembered
 * filter is a page that lies about what it is showing to whoever opens it next,
 * and there is no ruling asking for one.
 */

/* ------------------------------ the scope ------------------------------ */

export { USAGE_SCOPE_ALL, USAGE_SCOPE_DESKTOP };

/**
 * The scope menu. **All channels**, then one entry per channel in the reader's
 * home space, then **Desktop agent**.
 *
 * ⚠ **THE CHANNEL LIST IS THE LEFT PANE'S OWN READ, NOT A SECOND ONE.**
 * `GET /api/channels?scope=account` is already mounted by `pages/home/index.tsx`
 * on the same key, so this is a cache hit and the dropdown costs no request.
 * ⚠ **AND IT IS THE SAME ROWS, THROUGH THE SAME FILTER** — `home-rows.ts ›
 * homeChannels`, which is `homeRows`' G3 narrowing read without the link rows.
 * The account scope answers every container kind; this menu is the list Samuel
 * means by "specific channels", i.e. the rows he can see in the pane beside the
 * chart, in the order that pane shows them.
 *
 * 🔒 **THE CHANNEL'S OWN ID IS THE VALUE SINCE 2026-09-13 (rule B).** ⚠ **IT
 * WAS `workspaceId` — the CONTAINER — UNTIL THIS WAVE**, because the ledger had no
 * channel column and its channel dimension was the addressed container. It has one
 * now, and it is the channel's OWN id: under rule B a home channel's agent can
 * burn credits while addressing ANOTHER container, and those burns belong to this
 * option (`overview-series-params.ts › resolveUsageChannel`).
 *
 * ⚠ **DESKTOP AGENT IS LAST AND IS NOT A CHANNEL.** It is MCP traffic with no
 * calling channel at all — `channel_id IS NULL`, which also holds every burn
 * recorded before the column existed — so it sits after the channels rather than
 * among them.
 */
export function UsageScopeMenu({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const channels = useAccountChannels();
  // ⚠ `? … : []` INLINE (§8): the payload is IndexedDB-persisted, and `homeRows`
  // walks `channels` — an entry lacking that key must yield no options, never a
  // throw inside the Overview face.
  const rows = channels.data ? homeChannels(channels.data) : [];
  const options: SelectMenuOption<string>[] = [
    { value: USAGE_SCOPE_ALL, label: "All channels" },
    ...rows.map((channel) => ({
      value: channel.id,
      label: channel.name,
    })),
    {
      value: USAGE_SCOPE_DESKTOP,
      label: "Desktop agent",
      // The one option whose name does not say what it holds. Minimal copy
      // (INVARIANTS §5): a RULE, not an explainer.
      description: "Credits burned outside any channel.",
    },
  ];
  return (
    <SelectMenu
      value={value}
      options={options}
      onChange={onChange}
      variant="text"
      ariaLabel="Usage scope"
      // ⚠ **THE TEMPLATE CARD'S NAME TYPE — 14px, AND IT DID NOT GO UP WITH THE
      // PANEL HEADING** (Samuel, 2026-09-13, rejecting a pass that raised it:
      // *"You changed the font size of the credit spend, all channels, and the
      // date to the super large size, like usage. I did not ask for that."*).
      // `TEMPLATE_NAME_TEXT_LG` is the **Usage** heading's alone; the controls
      // inside the block stay one step below it.
      className={TEMPLATE_NAME_TEXT}
    />
  );
}

/* ------------------------------ the month ------------------------------ */

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * `YYYY-MM` for the month `at` falls in, **UTC** — the same calendar the server
 * bins by (`service-overview.ts › rangeWindows`), so the label and the bars can
 * never name two different months.
 */
export function monthKey(at: Date = new Date()): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** `YYYY-MM` ± n months, carrying the year. */
export function shiftMonthKey(key: string, delta: number): string {
  const [year = "", month = ""] = key.split("-");
  return monthKey(new Date(Date.UTC(Number(year), Number(month) - 1 + delta, 1)));
}

/** `"2026-09"` → `"September 2026"`. */
export function monthLabel(key: string): string {
  const [year = "", month = ""] = key.split("-");
  return `${MONTH_NAMES[Number(month) - 1] ?? month} ${year}`;
}

/**
 * `‹ September 2026 ›` — one calendar month per press.
 *
 * ⚠ **`›` IS DISABLED AT THE CURRENT MONTH, NOT HIDDEN.** A control that
 * disappears at the edge moves the label under the reader's cursor; a disabled
 * one says "this is the newest month" in place. There is no forward month to
 * show: the current month's own future days are already drawn as zeroes
 * (`rangeWindows`' month arm), which is as far into the future as this face goes.
 *
 * ⚠ **NO LOWER BOUND, deliberately.** The ledger starts at its migration and an
 * older month reads as a flat axis — which is the honest picture of "nothing was
 * recorded then", and the same trade the zero-filled current month already makes.
 */
/**
 * THE ARROW GLYPH, AND THE ONE PLACE IT IS ALLOWED TO LEAVE `NAKED_ICON`.
 *
 * 🔒 **SAMUEL, 2026-09-13: *"Increase the size of the arrows to match."*** They
 * match the LABEL BESIDE THEM, and that label is `TEMPLATE_NAME_TEXT`'s 14px —
 * raised from `text-caption` (11.5px) in the same wave, which is what moved these
 * off the shared 14: a chevron the same size as its word reads as a glyph
 * standing in the text rather than a control beside it.
 *
 * ⚠ **16, NOT 18. THE 18 WAS A PASS THAT PUT THE LABEL ITSELF ON `text-display`,
 * AND SAMUEL REJECTED THAT** (*"the date to the super large size, like usage. I
 * did not ask for that"*). The glyph follows the label, so when the label came
 * back down this came with it — one notch above the default, which is the
 * "increase" that was actually asked for.
 *
 * ⚠ **`shared/ui/naked-icon-button.ts › NAKED_ICON` IS UNTOUCHED, DELIBERATELY.**
 * It is the app's default glyph for that face and the ontology object panel's
 * trash/✕ still wear it; raising it there would resize a surface nobody ruled
 * on. What this constant does NOT fork is the FACE — `NAKED_ICON_BUTTON` is still
 * imported, so the ink, the hover and the hit area stay one recipe.
 *
 * ⚠ **THE HIT AREA STAYS THE 30px MINIMUM AND GETS BIGGER, NOT SMALLER**: the
 * face's box is `p-2` around the glyph, so 8 + 16 + 8 = 32px. A larger glyph can
 * only grow it, which is why this needs no padding change to stay tappable.
 */
const MONTH_ARROW_ICON = 16;

export function MonthStepper({
  month,
  onChange,
  className,
}: {
  month: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  const atCurrent = month >= monthKey();
  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      <button
        type="button"
        aria-label="Previous month"
        className={NAKED_ICON_BUTTON}
        onClick={() => onChange(shiftMonthKey(month, -1))}
      >
        <ChevronLeft size={MONTH_ARROW_ICON} aria-hidden="true" />
      </button>
      {/* ⚠ **THE SCOPE MENU'S TYPE, BY IMPORT — 14px, NOT THE PANEL HEADING'S
          18** (Samuel, 2026-09-13: *"the month switcher as well"*, then *"I only
          want to change the date selector to match the credit spend and all
          channels' sizes"*). It was `text-caption`: the ask was to bring it up to
          the controls beside it, never up to **Usage**. */}
      <span className={cn("min-w-0 truncate", TEMPLATE_NAME_TEXT)}>
        {monthLabel(month)}
      </span>
      <button
        type="button"
        aria-label="Next month"
        disabled={atCurrent}
        className={cn(NAKED_ICON_BUTTON, "disabled:opacity-40")}
        onClick={() => onChange(shiftMonthKey(month, 1))}
      >
        <ChevronRight size={MONTH_ARROW_ICON} aria-hidden="true" />
      </button>
    </div>
  );
}

/* ------------------------------- the path ------------------------------- */

/**
 * The histogram's read, with the two controls' narrowings appended.
 *
 * 🔒 **A DEFAULT SELECTION SENDS NEITHER PARAM**, so the pane's first read is
 * byte-for-byte the path it has always been — one cache entry shared with every
 * other mount of this face, and no new server work for the common case. A
 * narrowed view is its own entry, which is what makes going back to **All
 * channels** instant.
 */
export function usageSeriesPath({
  range,
  metric,
  scope,
  month,
}: {
  range: string;
  metric: string;
  scope: string;
  month: string;
}): string {
  const params = [`range=${range}`, `metric=${metric}`];
  if (scope !== USAGE_SCOPE_ALL) params.push(`channel=${scope}`);
  if (month !== monthKey()) params.push(`month=${month}`);
  return `/api/home/overview-series?${params.join("&")}`;
}
