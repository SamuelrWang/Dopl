import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/community/[slug]/thumbnail — Upload a thumbnail for a published cluster.
 * Accepts base64-encoded image data. Stores in Supabase Storage.
 * Requires auth + ownership.
 *
 * Body: { image: "data:image/png;base64,..." }
 */
const handlePost = withUserAuth(async (
  request: NextRequest,
  context: { userId: string; params?: Record<string, string> }
) => {
  try {
    const slug = context.params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    const db = supabaseAdmin();

    // Verify ownership
    const { data: pc, error: lookupError } = await db
      .from("published_clusters")
      .select("id, user_id")
      .eq("slug", slug)
      .single();

    if (lookupError || !pc) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (pc.user_id !== context.userId) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const body = await request.json();
    const { image } = body;

    if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "image must be a base64 data URL" },
        { status: 400 }
      );
    }

    // Parse the base64 data URL
    const matches = image.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
    if (!matches) {
      return NextResponse.json(
        { error: "Invalid image format. Must be png, jpeg, or webp." },
        { status: 400 }
      );
    }

    const mimeType = `image/${matches[1]}`;
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, "base64");

    // Limit to 5MB
    if (buffer.length > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Image too large. Max 5MB." },
        { status: 400 }
      );
    }

    // Upload to Supabase Storage
    const filePath = `${context.userId}/${slug}.${matches[1]}`;

    const { error: uploadError } = await db.storage
      .from("community-thumbnails")
      .upload(filePath, buffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (uploadError) {
      console.error("Thumbnail upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload thumbnail" },
        { status: 500 }
      );
    }

    // Get the public URL
    const { data: urlData } = db.storage
      .from("community-thumbnails")
      .getPublicUrl(filePath);

    const thumbnailUrl = urlData.publicUrl;

    // Update the published cluster record
    await db
      .from("published_clusters")
      .update({
        thumbnail_url: thumbnailUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pc.id);

    return NextResponse.json({ thumbnail_url: thumbnailUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

export const POST = handlePost;
