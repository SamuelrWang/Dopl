/**
 * PER-KB STORAGE — THE ONE RETUNE SPOT.
 *
 * Every number the knowledge-base storage meter depends on lives in THIS FILE
 * and nowhere else: the per-plan byte cap, and the rule that resolves one from
 * a plan. Changing what a plan is worth in storage is a one-line edit here — no
 * migration, no route change, no UI change. If you find a second copy of any of
 * these numbers, that copy is the bug.
 *
 * Pure and framework-free ON PURPOSE: the knowledge write gate, the base-list
 * route and the client-side meter all read it, so it may not import
 * `server-only`, Supabase, or React. It is unit-tested in `kb-storage.test.ts`.
 *
 * WHAT IS COUNTED: the summed `octet_length(body)` of the LIVE entries in ONE
 * knowledge base — `knowledge_bases.storage_bytes`, maintained by the trigger
 * in `20260812120000_knowledge_base_storage_bytes.sql`. Titles, excerpts,
 * folder rows and embedding chunks are NOT counted; bodies are where the bytes
 * actually are, and counting only them keeps the number one an operator can
 * verify by hand.
 *
 * THE CAP IS PER BASE, NOT PER WORKSPACE, and that is a product decision worth
 * stating: a workspace may hold any number of bases. This meter answers "is
 * this one base getting unwieldy", which is also the only question the card
 * grid and the base overview are in a position to ask.
 */

import type { PlanId } from "./plans";

/**
 * Per-knowledge-base storage allowance, in BYTES.
 *
 * DECIMAL MEGABYTES (5_000_000, not 5 × 1024²), because the number is rendered
 * back to the user as "5 MB" and a cap that reads 4.77 MB in the UI is a
 * support ticket. The formatter (`shared/lib/format-bytes.ts`) divides by the
 * same 1000s, so the bar and this map agree by construction.
 *
 * SOLO AND TEAM ARE THE SAME NUMBER TODAY, deliberately and not by accident:
 * storage is not what separates the paid tiers (seats and MCP credits are), so
 * both paid plans get the same generous ceiling. They are two entries rather
 * than one shared constant precisely so pulling them apart later is an edit to
 * a value, not a refactor of the shape. Tunable — this is the retune spot.
 */
export const KB_STORAGE_BYTES: Record<PlanId, number> = {
  free: 5_000_000,
  solo: 100_000_000,
  team: 100_000_000,
};

/**
 * The per-base storage allowance for an ENTITLEMENT-RESOLVED plan (never the
 * raw `workspace_billing.plan` — a degraded solo, i.e. a solo subscription that
 * has grown a second member, gets the free cap; see
 * `server/entitlements.ts › paidEntitlement`).
 */
export function kbStorageLimitForPlan(plan: PlanId): number {
  return KB_STORAGE_BYTES[plan] ?? KB_STORAGE_BYTES.free;
}
