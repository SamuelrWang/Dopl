import { notFound } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/shared/supabase/server";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { isAdmin } from "@/shared/auth/with-auth";
import { ReviewCard } from "./review-card";

export const dynamic = "force-dynamic";

interface AdminEntryRow {
  id: string;
  title: string | null;
  summary: string | null;
  source_url: string | null;
  source_platform: string | null;
  source_author: string | null;
  thumbnail_url: string | null;
  use_case: string | null;
  complexity: string | null;
  content_type: string | null;
  status: string | null;
  moderation_status: string | null;
  ingested_by: string | null;
  created_at: string | null;
  readme: string | null;
}

export default async function AdminReviewPage() {
  const user = await getUser();
  if (!isAdmin(user?.id)) {
    // Non-admins (and logged-out users) see a 404 — no hint this page exists.
    notFound();
  }

  const db = supabaseAdmin();
  const { data: entries } = await db
    .from("entries")
    .select(
      "id, title, summary, source_url, source_platform, source_author, thumbnail_url, use_case, complexity, content_type, status, moderation_status, ingested_by, created_at, readme"
    )
    .eq("moderation_status", "pending")
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (entries || []) as AdminEntryRow[];

  // Hydrate ingester emails
  const ingesterIds = Array.from(
    new Set(rows.map((e) => e.ingested_by).filter((id): id is string => !!id))
  );
  const ingesterMap = new Map<string, string>();
  if (ingesterIds.length > 0) {
    const { data: usersPage } = await db.auth.admin.listUsers({ perPage: 1000 });
    for (const u of usersPage?.users || []) {
      if (ingesterIds.includes(u.id)) ingesterMap.set(u.id, u.email || "(no email)");
    }
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium text-text-primary">Moderation Queue</h1>
          <p className="text-sm text-text-secondary mt-1">
            {rows.length} {rows.length === 1 ? "entry" : "entries"} awaiting review
          </p>
        </div>
        <Link
          href="/admin/health"
          className="text-sm text-text-secondary hover:text-text-primary underline underline-offset-2"
        >
          System health →
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-8 text-center text-sm text-text-secondary">
          No pending entries. New ingestions will appear here.
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((entry) => (
            <ReviewCard
              key={entry.id}
              entry={entry}
              ingesterEmail={entry.ingested_by ? ingesterMap.get(entry.ingested_by) ?? null : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
