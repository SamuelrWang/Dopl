// STAGING COPY (partial) of apps/desktop-ui/src/pages/home/home-rows.ts (tree of 2026-10-22): only the
// three presenters the staged popups render. Verbatim. See src/features/popups-staging/PORTING.md.
import type { ChannelPendingLink } from "@/features/channels/types-list";

/** A URL reads as a link without its scheme; the COPY still carries the whole
 *  thing. ⚠ Here rather than in `link-out-panel.tsx`, because the Add-person
 *  popover renders the same string and importing a presenter from a panel is how
 *  the second copy gets written instead. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

/**
 * What an OPEN invitation grants its claimer — "Joins as guest" / "Joins as
 * member" (2026-08-26).
 */
export function linkGrantLabel(link: ChannelPendingLink): string {
  return `Joins as ${link.grantedRole ?? "guest"}`;
}

/** "Single use" / "3 of 5 used" / "Multi use". */
export function linkUsesLabel(link: ChannelPendingLink): string {
  if (link.maxUses === null) return "Multi use";
  if (link.maxUses === 1) return "Single use";
  return `${link.useCount} of ${link.maxUses} used`;
}
