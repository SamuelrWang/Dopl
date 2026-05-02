import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";

const supabase = supabaseAdmin();

/**
 * GET /api/canvas/panels — list all panels on the active canvas.
 */
export const GET = withWorkspaceAuth(async (_request, { workspaceId }) => {
  const { data, error } = await supabase
    .from("canvas_panels")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("added_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const panels = data || [];

  // Hydrate entry slugs for entry-typed panels so MCP consumers can hyperlink
  // without ever learning the internal UUID.
  const entryIds = panels
    .map((p) => (p as { entry_id: string | null }).entry_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const slugByEntryId = new Map<string, string | null>();
  if (entryIds.length > 0) {
    const { data: entries } = await supabase
      .from("entries")
      .select("id, slug")
      .in("id", entryIds);
    for (const e of entries || []) {
      slugByEntryId.set(
        (e as { id: string }).id,
        (e as { slug: string | null }).slug ?? null
      );
    }
  }

  const hydrated = panels.map((p) => {
    const entryId = (p as { entry_id: string | null }).entry_id;
    return {
      ...p,
      slug: entryId ? slugByEntryId.get(entryId) ?? null : null,
    };
  });

  return NextResponse.json({ panels: hydrated });
});

/**
 * POST /api/canvas/panels — add a panel to the active canvas.
 * Supported panel types: entry, chat, connection, browse, cluster-brain,
 * knowledge, skills, knowledge-base, skill.
 * Body: { panel_id, panel_type, entry_id?, x, y, width?, height?, title?, summary?, source_url?, panel_data? }
 */
export const POST = withWorkspaceAuth(
  async (request, { userId, workspaceId }) => {
    const body = await request.json();
    const { panel_type, entry_id, x, y, width, height, title, summary, source_url, panel_data } = body;
    let { panel_id } = body;

    // MCP's canvas_add_entry posts { entry_id } only — no panel_id. The UI
    // posts both. Synthesize a stable panel_id from entry_id when missing.
    if ((!panel_id || typeof panel_id !== "string") && typeof entry_id === "string" && entry_id.length > 0) {
      panel_id = `entry-${entry_id}`;
    }

    if (!panel_id || typeof panel_id !== "string") {
      return NextResponse.json({ error: "panel_id or entry_id is required" }, { status: 400 });
    }

    // Allow-list MUST mirror the discriminated union in
    // src/features/canvas/types.ts and the cases in panel-dto.ts.
    // When adding a new panel type, update all three sites.
    const VALID_PANEL_TYPES = [
      "entry",
      "chat",
      "connection",
      "browse",
      "cluster-brain",
      "knowledge",
      "skills",
      "knowledge-base",
      "skill",
    ];
    if (panel_type && !VALID_PANEL_TYPES.includes(panel_type)) {
      return NextResponse.json(
        { error: `Invalid panel_type. Must be one of: ${VALID_PANEL_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    if (panel_type === "entry" && entry_id) {
      const { data: entry, error: entryError } = await supabase
        .from("entries")
        .select("id, status")
        .eq("id", entry_id)
        .single();

      if (entryError || !entry) {
        return NextResponse.json({ error: "Entry not found" }, { status: 404 });
      }
    }

    const { data: panel, error: insertError } = await supabase
      .from("canvas_panels")
      .upsert(
        {
          user_id: userId,
          workspace_id: workspaceId,
          panel_id,
          panel_type: panel_type || "entry",
          entry_id: entry_id || null,
          x: x ?? 0,
          y: y ?? 0,
          width: width ?? null,
          height: height ?? null,
          title: title || null,
          summary: summary || null,
          source_url: source_url || null,
          panel_data: panel_data || {},
        },
        { onConflict: "workspace_id,panel_id", ignoreDuplicates: true }
      )
      .select()
      .maybeSingle();

    if (insertError) {
      const { data: existing } = await supabase
        .from("canvas_panels")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("panel_id", panel_id)
        .single();

      if (existing) {
        return NextResponse.json({ panel: existing, created: false });
      }

      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ panel, created: true }, { status: 201 });
  },
  { minRole: "editor" }
);
