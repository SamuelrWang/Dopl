import { NextResponse } from "next/server";
import { withDeveloperKey } from "@/features/device-sdk/server/with-developer-key";

export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/ping` — the Device SDK route root (A1). Any valid SECRET key, any scope, answers
 * which project and environment it belongs to. Publishable keys are refused (they may only create
 * Connect sessions, C1).
 */
export const GET = withDeveloperKey(
  async (_request, { projectId, env }) => NextResponse.json({ ok: true, project_id: projectId, env }),
  { scopes: [] }
);
