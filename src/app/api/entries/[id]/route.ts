import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { EntryUpdateSchema } from "@/types/api";
import { withUserAuth, withMcpCredits, isAdmin } from "@/shared/auth/with-auth";
import { CONTENT_PREVIEW_LENGTH } from "@/config";
import type { SubscriptionTier } from "@/lib/billing/subscriptions";
import { resolveEntryId } from "@/lib/entries/resolver";

const supabase = supabaseAdmin();

async function handleGet(
  _request: NextRequest,
  { userId, tier, params }: { userId: string; tier: SubscriptionTier; params?: Record<string, string> }
) {
  const input = params?.id;
  if (!input) {
    return NextResponse.json({ error: "Missing entry ID" }, { status: 400 });
  }

  const id = await resolveEntryId(input);
  if (!id) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  const { data: entry, error } = await supabase
    .from("entries")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  // Moderation gate: only approved entries are visible to the public.
  // Owner (ingester) and admin see their entries regardless of moderation state.
  if (entry.moderation_status !== "approved") {
    const isOwner = entry.ingested_by && entry.ingested_by === userId;
    if (!isOwner && !isAdmin(userId)) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }
  }

  // Get sources
  const { data: sources } = await supabase
    .from("sources")
    .select("*")
    .eq("entry_id", id)
    .order("depth", { ascending: true });

  // Get tags
  const { data: tags } = await supabase
    .from("tags")
    .select("tag_type, tag_value")
    .eq("entry_id", id);

  // Content depth gate for free users
  if (tier === "free") {
    if (entry.readme) {
      entry.readme =
        entry.readme.slice(0, CONTENT_PREVIEW_LENGTH) +
        "\n\n---\n*Upgrade to Pro to see the full implementation details.*";
    }
    entry.agents_md = null;
  }

  // Strip admin/moderation fields from the response. The owner-bypass above
  // lets the ingester fetch their own pending/denied entry so their canvas
  // works, but the RESPONSE must not hint that moderation exists (silent
  // moderation). Also prevents MCP clients from learning about admin state
  // via their own entries. Admins must use /api/admin/entries for this data.
  const {
    moderation_status: _ms,
    moderated_at: _mat,
    moderated_by: _mby,
    ingested_by: _iby,
    ...publicEntry
  } = entry;
  void _ms; void _mat; void _mby; void _iby;

  // Do not leak the caller's subscription tier in the response body.
  void tier;
  return NextResponse.json({
    ...publicEntry,
    sources: sources || [],
    tags: tags || [],
  });
}

async function handlePatch(
  request: NextRequest,
  { userId, params }: { userId: string; params?: Record<string, string> }
) {
  const input = params?.id;
  if (!input) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const id = await resolveEntryId(input);
  if (!id) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = EntryUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.issues },
      { status: 400 }
    );
  }

  // Ownership / admin check: only the ingester or an admin may modify.
  // Scope the UPDATE itself so a race can't let someone else sneak through
  // between the read and the write.
  let query = supabase
    .from("entries")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (!isAdmin(userId)) {
    query = query.eq("ingested_by", userId);
  }

  const { data, error } = await query.select().single();

  if (error || !data) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

async function handleDelete(
  _request: NextRequest,
  { userId, params }: { userId: string; params?: Record<string, string> }
) {
  const input = params?.id;
  if (!input) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const id = await resolveEntryId(input);
  if (!id) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  // Scope DELETE to owner or allow admin everywhere. Ask Postgres to
  // RETURN the deleted ids so we can detect "nothing deleted" → 404.
  let query = supabase.from("entries").delete().eq("id", id);
  if (!isAdmin(userId)) {
    query = query.eq("ingested_by", userId);
  }

  const { data, error } = await query.select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) {
    // Nothing deleted — either not found or not owned. Don't distinguish.
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

export const GET = withMcpCredits("mcp_get_entry", handleGet);
export const PATCH = withUserAuth(handlePatch);
export const DELETE = withUserAuth(handleDelete);
