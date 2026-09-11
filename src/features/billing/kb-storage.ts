/**
 * PER-KB STORAGE — the ONE retune spot. Per-plan byte cap + resolver live here;
 * a second copy of these numbers is a bug.
 *
 * ⚠ Must stay pure/framework-free — knowledge write gate, base-list route and
 * client meter all import it: no `server-only`, Supabase or React.
 *
 * Counts summed `octet_length(body)` of LIVE entries in ONE base
 * (`knowledge_bases.storage_bytes`, trigger in
 * `20260812120000_knowledge_base_storage_bytes.sql`). Titles, excerpts, folder
 * rows and embedding chunks NOT counted. Cap is PER BASE, not per workspace.
 */

import type { PlanId } from "./plans";

/**
 * Per-knowledge-base storage allowance, in BYTES.
 *
 * ⚠ DECIMAL megabytes (5_000_000, not 5 × 1024²) — `shared/lib/format-bytes.ts`
 * divides by the same 1000s, so bar and map agree.
 *
 * solo === team === pro on purpose: every PAID plan buys the same room, and
 * separate entries rather than one shared constant so splitting them later is a
 * value edit. Tunable.
 *
 * ⚠ `pro` ADDED 2026-09-08 with the personal paid tier. It is the PAID figure,
 * not the free one: a paying home space that kept the 5 MB base cap would be
 * charged $8.99 for a knowledge base it cannot fill.
 */
export const KB_STORAGE_BYTES: Record<PlanId, number> = {
  free: 5_000_000,
  solo: 100_000_000,
  team: 100_000_000,
  pro: 100_000_000,
};

/** Cap for an ENTITLEMENT-RESOLVED plan — never raw `workspace_billing.plan`
 *  (degraded solo gets the free cap; `server/entitlements.ts ›
 *  paidEntitlement`). */
export function kbStorageLimitForPlan(plan: PlanId): number {
  return KB_STORAGE_BYTES[plan] ?? KB_STORAGE_BYTES.free;
}
