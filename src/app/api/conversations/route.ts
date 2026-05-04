import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";

const supabase = supabaseAdmin();

type Visibility = "workspace" | "private";

const SELECT_COLS =
  "id, panel_id, title, messages, pinned, visibility, scope_filters, expires_at, created_at, updated_at";

/**
 * GET /api/conversations — list conversations on the active workspace.
 *
 *   ?visibility=workspace  → workspace-shared rows (canvas chats). Default.
 *   ?visibility=private    → only the calling user's private rows
 *                            (dedicated /chat page).
 *
 * Cleans up expired unpinned conversations on each fetch. The cleanup
 * pass only touches rows in the requested visibility scope so a
 * workspace fetch doesn't trash someone else's private chats.
 */
export const GET = withWorkspaceAuth(async (request, { workspaceId, userId }) => {
  const url = new URL(request.url);
  const visibilityParam = url.searchParams.get("visibility");
  const visibility: Visibility =
    visibilityParam === "private" ? "private" : "workspace";

  const expiringQuery = supabase
    .from("conversations")
    .select("id, panel_id")
    .eq("workspace_id", workspaceId)
    .eq("visibility", visibility)
    .eq("pinned", false)
    .lt("expires_at", new Date().toISOString());
  if (visibility === "private") expiringQuery.eq("user_id", userId);
  const { data: expiring } = await expiringQuery;

  if (expiring && expiring.length > 0) {
    const panelIds = expiring.map((c: { panel_id: string }) => c.panel_id);

    const attachQuery = supabase
      .from("chat_attachments")
      .select("storage_path")
      .eq("workspace_id", workspaceId)
      .eq("visibility", visibility)
      .in("panel_id", panelIds);
    if (visibility === "private") attachQuery.eq("user_id", userId);
    const { data: attachments } = await attachQuery;

    if (attachments && attachments.length > 0) {
      const paths = attachments.map(
        (a: { storage_path: string }) => a.storage_path
      );
      await supabase.storage.from("chat-attachments").remove(paths);
      const delAttach = supabase
        .from("chat_attachments")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("visibility", visibility)
        .in("panel_id", panelIds);
      if (visibility === "private") delAttach.eq("user_id", userId);
      await delAttach;
    }

    const delConv = supabase
      .from("conversations")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("visibility", visibility)
      .eq("pinned", false)
      .lt("expires_at", new Date().toISOString());
    if (visibility === "private") delConv.eq("user_id", userId);
    await delConv;
  }

  const listQuery = supabase
    .from("conversations")
    .select(SELECT_COLS)
    .eq("workspace_id", workspaceId)
    .eq("visibility", visibility)
    .order("updated_at", { ascending: false });
  if (visibility === "private") listQuery.eq("user_id", userId);
  const { data, error } = await listQuery;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversations: data || [] });
});

/**
 * POST /api/conversations — upsert a conversation.
 *
 * Body fields:
 *   panel_id (required)        unique within (workspace_id, panel_id)
 *   title                       defaults to "New Chat"
 *   messages (required)         JSON-serializable array
 *   pinned                      boolean, defaults to false
 *   visibility                  "workspace" | "private", defaults to workspace
 *   scope_filters               JSON object, only meaningful for private rows
 *
 * Role gating: workspace inserts/updates require 'member' role; private
 * rows can be written by any workspace member (viewer included) since
 * they're only visible to the writer themselves.
 */
export const POST = withWorkspaceAuth(
  async (request, { userId, workspaceId, role }) => {
    const body = await request.json();
    const { panel_id, title, messages, pinned } = body;
    const visibility: Visibility =
      body.visibility === "private" ? "private" : "workspace";
    const scopeFilters =
      body.scope_filters && typeof body.scope_filters === "object"
        ? body.scope_filters
        : null;

    if (!panel_id || typeof panel_id !== "string") {
      return NextResponse.json({ error: "panel_id is required" }, { status: 400 });
    }
    if (!Array.isArray(messages)) {
      return NextResponse.json(
        { error: "messages must be an array" },
        { status: 400 }
      );
    }

    // Workspace conversations require write role; private chats only
    // require workspace membership (RLS will enforce too).
    if (visibility === "workspace") {
      const isWriter = role === "owner" || role === "admin" || role === "member";
      if (!isWriter) {
        return NextResponse.json(
          { error: "Workspace conversations require member role." },
          { status: 403 }
        );
      }
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from("conversations")
      .upsert(
        {
          user_id: userId,
          workspace_id: workspaceId,
          panel_id,
          title: title || "New Chat",
          messages,
          pinned: pinned ?? false,
          visibility,
          scope_filters: scopeFilters,
          updated_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        },
        { onConflict: "workspace_id,panel_id" }
      )
      .select(SELECT_COLS)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ conversation: data });
  }
);
