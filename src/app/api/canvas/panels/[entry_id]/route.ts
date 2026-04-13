import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";

const supabase = supabaseAdmin();

/**
 * DELETE /api/canvas/panels/[entry_id] — remove an entry from the user's canvas.
 */
export const DELETE = withUserAuth(async (_request, { userId, params }) => {
  const entryId = params?.entry_id;

  if (!entryId) {
    return NextResponse.json(
      { error: "entry_id is required" },
      { status: 400 }
    );
  }

  const { error, count } = await supabase
    .from("canvas_panels")
    .delete()
    .eq("user_id", userId)
    .eq("entry_id", entryId)
    .select("id")
    .then((res) => ({ error: res.error, count: res.data?.length ?? 0 }));

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (count === 0) {
    return NextResponse.json(
      { error: "Entry not found on canvas" },
      { status: 404 }
    );
  }

  return new NextResponse(null, { status: 204 });
});
