/**
 * Per-KB storage — per-plan byte cap and resolver; a second copy of these
 * numbers is a bug. Must stay pure/framework-free (no `server-only`, Supabase
 * or React): the knowledge write gate, base-list route and client meter all
 * import it.
 *
 * Counts summed `octet_length(body)` of live entries in one base
 * (`knowledge_bases.storage_bytes`, trigger in
 * `20260812120000_knowledge_base_storage_bytes.sql`). Titles, excerpts, folder
 * rows and embedding chunks are not counted. The cap is per base, not per
 * workspace.
 */

import type { PlanId } from "./plans";

/**
 * Per-knowledge-base storage allowance, in bytes. Decimal megabytes
 * (5_000_000, not 5 × 1024²) — `shared/lib/format-bytes.ts` divides by the same
 * 1000s, so bar and map agree.
 *
 * solo === team === pro on purpose: every paid plan buys the same room, kept as
 * separate entries so splitting them later is a value edit. `pro` was added
 * 2026-09-08 with the personal paid tier and takes the paid figure — a paying
 * home space on the free cap would pay for a base it cannot fill.
 */
export const KB_STORAGE_BYTES: Record<PlanId, number> = {
  free: 5_000_000,
  solo: 100_000_000,
  team: 100_000_000,
  pro: 100_000_000,
};

/** Cap for an entitlement-resolved plan — never raw `workspace_billing.plan`
 *  (degraded solo gets the free cap; `server/entitlements.ts ›
 *  paidEntitlement`). */
export function kbStorageLimitForPlan(plan: PlanId): number {
  return KB_STORAGE_BYTES[plan] ?? KB_STORAGE_BYTES.free;
}
