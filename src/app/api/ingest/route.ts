import { NextRequest, NextResponse } from "next/server";
import { IngestRequestSchema } from "@/types/api";
import { ingestEntry } from "@/lib/ingestion/pipeline";
import { withExternalAuth } from "@/lib/auth/with-auth";

const MAX_TEXT_LENGTH = 100_000;
const MAX_IMAGES = 20;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_LINKS = 50;
const MAX_URL_LENGTH = 2_048;

async function handlePost(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = IngestRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    // -- Input size validation --
    if (parsed.data.url.length > MAX_URL_LENGTH) {
      return NextResponse.json(
        { error: "URL too long", max: MAX_URL_LENGTH },
        { status: 400 }
      );
    }

    if (parsed.data.content.text && parsed.data.content.text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json(
        { error: "Text content too long", max: MAX_TEXT_LENGTH },
        { status: 400 }
      );
    }

    if (parsed.data.content.images && parsed.data.content.images.length > MAX_IMAGES) {
      return NextResponse.json(
        { error: `Too many images (max ${MAX_IMAGES})` },
        { status: 400 }
      );
    }

    if (parsed.data.content.images) {
      for (const img of parsed.data.content.images) {
        if (img.length > MAX_IMAGE_SIZE) {
          return NextResponse.json(
            { error: "Image too large (max 10MB)" },
            { status: 400 }
          );
        }
      }
    }

    if (parsed.data.content.links && parsed.data.content.links.length > MAX_LINKS) {
      return NextResponse.json(
        { error: `Too many links (max ${MAX_LINKS})` },
        { status: 400 }
      );
    }

    // ingestEntry creates the DB record and starts the pipeline in the background.
    // Returns the entry ID immediately. Client connects to SSE stream for progress.
    const entryId = await ingestEntry({
      url: parsed.data.url,
      content: {
        text: parsed.data.content.text,
        images: parsed.data.content.images,
        links: parsed.data.content.links,
      },
    });

    return NextResponse.json(
      {
        entry_id: entryId,
        status: "processing",
        stream_url: `/api/ingest/${entryId}/stream`,
      },
      { status: 202 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Ingestion failed", message },
      { status: 500 }
    );
  }
}

export const POST = withExternalAuth(handlePost);
