import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUser } from "@/lib/supabase-server";

export async function DELETE() {
  try {
    const user = await getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = supabaseAdmin();

    // Clean up chat attachment storage objects before cascade deletes the DB rows.
    // List all files in the user's folder and delete them.
    const { data: userFiles } = await admin.storage
      .from("chat-attachments")
      .list(user.id, { limit: 1000 });

    if (userFiles && userFiles.length > 0) {
      // List files in each subfolder (panel_id level)
      const allPaths: string[] = [];
      for (const item of userFiles) {
        if (item.id === null) {
          // It's a folder — list its contents
          const { data: subFiles } = await admin.storage
            .from("chat-attachments")
            .list(`${user.id}/${item.name}`, { limit: 1000 });
          if (subFiles) {
            for (const f of subFiles) {
              allPaths.push(`${user.id}/${item.name}/${f.name}`);
            }
          }
        } else {
          allPaths.push(`${user.id}/${item.name}`);
        }
      }
      if (allPaths.length > 0) {
        await admin.storage.from("chat-attachments").remove(allPaths);
      }
    }

    // Also clean up community thumbnail storage
    const { data: thumbFiles } = await admin.storage
      .from("community-thumbnails")
      .list(user.id, { limit: 100 });
    if (thumbFiles && thumbFiles.length > 0) {
      const thumbPaths = thumbFiles.map((f) => `${user.id}/${f.name}`);
      await admin.storage.from("community-thumbnails").remove(thumbPaths);
    }

    // Delete the auth user — all per-user data cascades automatically:
    // profiles, api_keys, canvas_panels, user-scoped clusters, chat_attachments
    // entries.ingested_by is SET NULL (preserves global entries)
    const { error } = await admin.auth.admin.deleteUser(user.id);

    if (error) {
      console.error("Failed to delete user:", error);
      return NextResponse.json(
        { error: "Failed to delete account" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Account deletion error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
