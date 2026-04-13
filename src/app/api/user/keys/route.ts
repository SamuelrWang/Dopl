import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/supabase-server";
import { createApiKey, listApiKeys } from "@/lib/auth/api-keys";

export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = await listApiKeys({ userId: user.id });
  return NextResponse.json({ keys });
}

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const name = body.name?.trim();

  if (!name) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 }
    );
  }

  const result = await createApiKey(name, user.id);

  return NextResponse.json({
    key: result.key,
    id: result.id,
    name: result.name,
    prefix: result.prefix,
    message: "Save this key — it will not be shown again.",
  });
}
