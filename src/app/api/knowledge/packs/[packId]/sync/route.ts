import { NextRequest, NextResponse } from "next/server";
import { syncPack, verifyHmac } from "@/lib/knowledge/sync";

/**
 * POST /api/knowledge/packs/[packId]/sync — pull the latest from the pack's
 * GitHub repo into Supabase.
 *
 * Auth: shared HMAC secret (KNOWLEDGE_PACK_SYNC_SECRET). The pack's GitHub
 * Action signs the (empty) request body with this secret and sends the
 * digest in the X-Dopl-Signature header. The nightly cron task does the
 * same. No user session is required — sync is infrastructure, not a
 * user-scoped operation.
 *
 * 401 on bad/missing signature. 404 on unknown pack.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ packId: string }> }
) {
  const { packId } = await context.params;
  const secret = process.env.KNOWLEDGE_PACK_SYNC_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Sync is not configured on this server" },
      { status: 503 }
    );
  }

  // Read raw body so HMAC matches what the sender hashed. Body may be
  // empty — that's fine; HMAC over the empty string is still a valid
  // proof of secret possession.
  const rawBody = await request.text();
  const signature = request.headers.get("x-dopl-signature");
  if (!verifyHmac(signature, rawBody, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    const result = await syncPack(packId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.toLowerCase().includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
