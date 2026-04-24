import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";

const supabase = supabaseAdmin();

/**
 * POST /api/chat/attachment-url — generate signed URLs for chat attachments.
 *
 * Body: { paths: string[] }
 * Returns: { urls: Record<string, string> }  (path → signed URL)
 *
 * Only returns URLs for paths owned by the authenticated user
 * (path must start with userId/).
 */
export const POST = withUserAuth(async (request: NextRequest, { userId }) => {
  const body = await request.json();
  const paths: string[] = body.paths;

  if (!Array.isArray(paths) || paths.length === 0) {
    return NextResponse.json(
      { error: "paths array is required" },
      { status: 400 }
    );
  }

  // Only allow paths belonging to this user
  const validPaths = paths.filter((p) => p.startsWith(`${userId}/`));

  if (validPaths.length === 0) {
    return NextResponse.json({ urls: {} });
  }

  const urls: Record<string, string> = {};

  // Batch sign URLs (Supabase supports batch signing)
  const { data, error } = await supabase.storage
    .from("chat-attachments")
    .createSignedUrls(validPaths, 3600);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (data) {
    for (const item of data) {
      if (item.signedUrl && item.path) {
        urls[item.path] = item.signedUrl;
      }
    }
  }

  return NextResponse.json({ urls });
});
