/** Plan-card sub-lines, shared by /pricing (pricing-content.tsx) and the
 *  landing's pricing summary (pricing-summary.tsx), so the two cannot drift.
 *  A plain module so the landing does not import pricing-content's auth
 *  reads to get two strings. ⚠ No em or en dashes (Samuel's copy rule). */

/** Card sub-line, keyed inside its group: both groups own an `id: "free"`
 *  card, so one flat map would make them collide. */
export const PERSONAL_SUMMARY: Record<string, string> = {
  free: "Your own space, free forever.",
  pro: "More credits and your whole history, for one flat price.",
  max: "Four times Pro's credits, for people who run agents all day.",
};
export const WORKSPACE_SUMMARY: Record<string, string> = {
  free: "Everything, free forever. Caps only start when a second member joins.",
  team: "Your whole team, uncapped. Pay only per seat, synced automatically.",
};
