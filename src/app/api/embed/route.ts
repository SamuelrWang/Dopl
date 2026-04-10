import { NextRequest, NextResponse } from "next/server";
import { generateEmbedding } from "@/lib/ai";
import { z } from "zod";

const EmbedSchema = z.object({
  text: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = EmbedSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const embedding = await generateEmbedding(parsed.data.text);

    return NextResponse.json({
      embedding,
      dimensions: embedding.length,
      model: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Embedding failed", message },
      { status: 500 }
    );
  }
}
