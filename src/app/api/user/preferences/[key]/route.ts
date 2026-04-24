import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";

const supabase = supabaseAdmin();

/**
 * GET /api/user/preferences/[key] — get a user preference.
 */
export const GET = withUserAuth(async (_request, { userId, params }) => {
  const key = params?.key;
  if (!key) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("user_preferences")
    .select("value")
    .eq("user_id", userId)
    .eq("key", key)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ value: null }, { status: 200 });
  }

  return NextResponse.json({ value: data.value });
});

/**
 * PUT /api/user/preferences/[key] — set a user preference.
 * Body: { value: any }
 */
export const PUT = withUserAuth(async (request, { userId, params }) => {
  const key = params?.key;
  if (!key) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }

  const body = await request.json();

  const { error } = await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: userId,
        key,
        value: body.value ?? {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,key" }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
});
