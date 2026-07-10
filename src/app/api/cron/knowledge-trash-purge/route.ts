import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/shared/auth/require-cron-secret";
import { hardDeleteOlderThanGlobal as purgeKnowledge } from "@/features/knowledge/server/repository";
import { hardDeleteOlderThanGlobal as purgeSkills } from "@/features/skills/server/repository";
import { logSystemEvent } from "@/features/analytics/server/system-events";

/**
 * Daily cron (vercel.json) — hard-deletes knowledge-base AND skill
 * rows that have been soft-deleted for ≥ 30 days. The endpoint is
 * still named `knowledge-trash-purge` for backwards compatibility
 * with the vercel.json schedule entry; the body now sweeps both
 * features in a single run so trash retention stays uniform across
 * the workspace.
 *
 * Protected by CRON_SECRET header check, same as the existing trial
 * and ingest-cleanup crons.
 */

const TRASH_RETENTION_DAYS = 30;

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const beforeIso = new Date(
    Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  try {
    const [kb, sk] = await Promise.all([
      purgeKnowledge(beforeIso),
      purgeSkills(beforeIso),
    ]);
    const counts = {
      entries: kb.entries,
      folders: kb.folders,
      bases: kb.bases,
      skills: sk.skills,
      skill_files: sk.files,
    };
    const total =
      counts.entries +
      counts.folders +
      counts.bases +
      counts.skills +
      counts.skill_files;

    void logSystemEvent({
      // Always "info" — even a no-op run is a healthy heartbeat to log.
      severity: "info",
      category: "other",
      source: "cron.knowledge-trash-purge",
      message: `Purged ${total} rows older than ${TRASH_RETENTION_DAYS}d (knowledge + skills)`,
      fingerprintKeys: ["cron", "knowledge-trash-purge", String(total)],
      metadata: {
        before: beforeIso,
        ...counts,
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
