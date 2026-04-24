import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * GET /api/user/profile — Get the current user's profile.
 */
async function handleGet(
  _request: NextRequest,
  context: { userId: string }
) {
  try {
    const db = supabaseAdmin();
    const { data: profile, error } = await db
      .from("profiles")
      .select("id, display_name, avatar_url, bio, website_url, twitter_handle, github_username, email")
      .eq("id", context.userId)
      .single();

    if (error || !profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    return NextResponse.json(profile);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/user/profile — Update the current user's profile.
 *
 * Body: { display_name?, bio?, website_url?, twitter_handle?, github_username? }
 */
async function handlePatch(
  request: NextRequest,
  context: { userId: string }
) {
  try {
    const body = await request.json();
    const db = supabaseAdmin();

    const allowedFields = [
      "display_name",
      "bio",
      "website_url",
      "twitter_handle",
      "github_username",
    ];

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    for (const field of allowedFields) {
      if (field in body) {
        // Basic sanitization
        const value = body[field];
        if (value !== null && typeof value !== "string") continue;
        updates[field] = value;
      }
    }

    const { data: profile, error } = await db
      .from("profiles")
      .update(updates)
      .eq("id", context.userId)
      .select("id, display_name, avatar_url, bio, website_url, twitter_handle, github_username, email")
      .single();

    if (error || !profile) {
      return NextResponse.json(
        { error: "Failed to update profile" },
        { status: 500 }
      );
    }

    return NextResponse.json(profile);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withUserAuth(handleGet);
export const PATCH = withUserAuth(handlePatch);
