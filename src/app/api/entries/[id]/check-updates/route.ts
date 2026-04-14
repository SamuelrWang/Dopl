/**
 * GET /api/entries/[id]/check-updates — check if a GitHub source has been
 * updated since the entry was ingested.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withExternalAuth } from "@/lib/auth/with-auth";
import { Octokit } from "@octokit/rest";

export const dynamic = "force-dynamic";

const GITHUB_RE = /github\.com\/([^/]+)\/([^/]+)/;

function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(GITHUB_RE);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

async function handleGet(
  _request: NextRequest,
  { params }: { userId: string; params?: Record<string, string> }
) {
  const id = params?.id;
  if (!id) {
    return NextResponse.json({ error: "Missing entry ID" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: entry, error } = await db
    .from("entries")
    .select("id, source_url, ingested_at, created_at, title")
    .eq("id", id)
    .single();

  if (error || !entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  const parsed = parseGitHubUrl(entry.source_url || "");
  if (!parsed) {
    return NextResponse.json({
      entry_id: entry.id,
      title: entry.title,
      has_updates: null,
      reason: "Not a GitHub source",
    });
  }

  const ingestedAt = entry.ingested_at || entry.created_at;

  try {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const { data: repo } = await octokit.repos.get({
      owner: parsed.owner,
      repo: parsed.repo,
    });

    const pushedAt = new Date(repo.pushed_at);
    const ingestedDate = new Date(ingestedAt);
    const hasUpdates = pushedAt > ingestedDate;
    const daysSinceIngestion = Math.floor(
      (Date.now() - ingestedDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    const daysSincePush = Math.floor(
      (Date.now() - pushedAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    return NextResponse.json({
      entry_id: entry.id,
      title: entry.title,
      has_updates: hasUpdates,
      ingested_at: ingestedAt,
      last_pushed_at: repo.pushed_at,
      days_since_ingestion: daysSinceIngestion,
      days_since_push: daysSincePush,
      repo: `${parsed.owner}/${parsed.repo}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "GitHub API error";
    return NextResponse.json({
      entry_id: entry.id,
      title: entry.title,
      has_updates: null,
      reason: `GitHub API error: ${message}`,
    });
  }
}

export const GET = withExternalAuth(handleGet);
