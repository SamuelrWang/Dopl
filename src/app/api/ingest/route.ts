/**
 * Legacy ingestion endpoint — retired.
 *
 * The server-side pipeline (callClaude × 6 per ingest: classifier →
 * manifest → README → agents.md → tags → secondary) has been removed.
 * All regular-tier ingestion now happens via the agent-driven flow:
 *
 *   POST /api/ingest/prepare  — server fetches + returns prompts
 *   POST /api/ingest/submit   — agent posts generated artifacts
 *
 * Skeleton-tier admin ingest is unaffected (see /api/admin/skeleton-ingest).
 *
 * POST here returns 410 Gone with a migration message so any external
 * caller on the old endpoint gets a legible failure rather than a silent
 * shape mismatch.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      error: "gone",
      message:
        "Legacy server-side ingestion has been removed. Use POST /api/ingest/prepare to fetch + receive synthesis prompts, run the prompts in your own client (Claude Code via the `prepare_ingest` + `submit_ingested_entry` MCP tools), then POST /api/ingest/submit to persist the generated artifacts.",
      migrate_to: {
        prepare: "POST /api/ingest/prepare",
        submit: "POST /api/ingest/submit",
        mcp_tools: ["prepare_ingest", "submit_ingested_entry"],
      },
    },
    { status: 410 }
  );
}
