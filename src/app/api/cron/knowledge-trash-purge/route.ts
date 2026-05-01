import { NextRequest, NextResponse } from "next/server";
import { hardDeleteOlderThanGlobal } from "@/features/knowledge/server/repository";
import { logSystemEvent } from "@/features/analytics/server/system-events";

/**
 * Daily cron (vercel.json) — hard-deletes knowledge-base rows that
 * have been soft-deleted for ≥ 30 days. Item 5.C.
 *
 * Protected by CRON_SECRET header check, same as the existing trial
 * and ingest-cleanup crons.
 */

const TRASH_RETENTION_DAYS = 30;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  // Fail closed when the secret isn't configured — without this, the
  // bare `if (expected && auth !== ...)` pattern lets every caller in
  // and a public hit hard-deletes 30-day-old trash globally.
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 }
    );
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const beforeIso = new Date(
    Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  try {
    const counts = await hardDeleteOlderThanGlobal(beforeIso);
    const total = counts.entries + counts.folders + counts.bases;

    void logSystemEvent({
      // Always "info" — even a no-op run is a healthy heartbeat to log.
      severity: "info",
      category: "other",
      source: "cron.knowledge-trash-purge",
      message: `Purged ${total} knowledge rows older than ${TRASH_RETENTION_DAYS}d`,
      fingerprintKeys: ["cron", "knowledge-trash-purge", String(total)],
      metadata: {
        before: beforeIso,
        entries: counts.entries,
        folders: counts.folders,
        bases: counts.bases,
      },
      userId: null,
    });

    return NextResponse.json({
      ok: true,
      before: beforeIso,
      counts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "purge failed";
    void logSystemEvent({
      severity: "error",
      category: "other",
      source: "cron.knowledge-trash-purge",
      message: `Purge failed: ${message}`,
      fingerprintKeys: ["cron", "knowledge-trash-purge", "fail"],
      metadata: { before: beforeIso },
      userId: null,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
