import { NextRequest } from "next/server";
import { ingestionProgress } from "@/lib/ingestion/progress";
import { withExternalAuth } from "@/lib/auth/with-auth";

export const dynamic = "force-dynamic";

async function handleGet(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const stream = ingestionProgress.subscribe(id);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export const GET = withExternalAuth(handleGet);
