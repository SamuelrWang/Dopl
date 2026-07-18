import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/shared/auth/require-cron-secret";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { logSystemEvent } from "@/features/analytics/server/system-events";

/**
 * GET /api/cron/purge-trash
 *
 * Daily trash-retention sweep (vercel.json). Permanently hard-deletes every
 * soft-deleted row (`deleted_at IS NOT NULL`) whose `deleted_at` is older than
 * RETENTION_DAYS, across every resource type that supports soft-delete. Recovery
 * stays possible from Trash inside the retention window; past it the row is gone.
 *
 * Ordering is children-before-parents: independently soft-deletable child rows
 * (`knowledge_entries`, `knowledge_folders`, `ontology_objects`) are purged on
 * their own aged `deleted_at`, then each purged parent (`knowledge_bases`,
 * `ontology_clusters`, `workflows`, `chats`) lets its remaining descendants go
 * via ON DELETE CASCADE (verified against the live FKs — every child FK to these
 * tables is ON DELETE CASCADE except `knowledge_entries.folder_id` -> folders,
 * which is ON DELETE SET NULL; either way no FK violation is possible).
 *
 * Self-contained: direct service-role deletes (no feature repository imports) so
 * this route is the single authoritative retention sweep.
 *
 * Auth: CRON_SECRET bearer via requireCronSecret (fail-closed 503 when unset,
 * 401 without the secret), same as the other /api/cron/* routes.
 */

const RETENTION_DAYS = 30;

// Children-before-parents. Each parent cascades its remaining descendants, so a
// purged base/cluster/workflow/chat also clears rows a child pass didn't touch.
const PURGE_TABLES = [
  "knowledge_entries",
  "knowledge_folders",
  "knowledge_bases",
  "ontology_objects",
  "ontology_clusters",
  "skills",
  "workflows",
  "chats",
] as const;

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const beforeIso = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const db = supabaseAdmin();
  const counts: Record<string, number> = {};

  try {
    for (const table of PURGE_TABLES) {
      const res = await db
        .from(table)
        .delete({ count: "exact" })
        .not("deleted_at", "is", null)
        .lt("deleted_at", beforeIso);
      if (res.error) throw res.error;
      counts[table] = res.count ?? 0;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "purge failed";
    void logSystemEvent({
      severity: "error",
      category: "other",
      source: "GET /api/cron/purge-trash",
      message: `Trash purge failed: ${message}`,
      fingerprintKeys: ["cron", "purge-trash", "fail"],
      metadata: { before: beforeIso, counts },
      userId: null,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  void logSystemEvent({
    // Always "info" — even a no-op run is a healthy retention heartbeat.
    severity: "info",
    category: "other",
    source: "GET /api/cron/purge-trash",
    message: `Purged ${total} soft-deleted rows older than ${RETENTION_DAYS}d`,
    fingerprintKeys: ["cron", "purge-trash", String(total)],
    metadata: { before: beforeIso, ...counts },
    userId: null,
  });

  return NextResponse.json({
    ok: true,
    retentionDays: RETENTION_DAYS,
    before: beforeIso,
    counts,
    total,
  });
}
