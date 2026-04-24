import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/shared/supabase/server";
import { revokeApiKey } from "@/shared/auth/api-keys";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await revokeApiKey(id, user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to revoke key";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
