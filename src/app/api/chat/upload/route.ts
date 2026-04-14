import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";
import {
  MAX_CHAT_ATTACHMENT_SIZE,
  MAX_CHAT_ATTACHMENTS_PER_MESSAGE,
  MAX_CHAT_MESSAGE_SIZE,
  ALLOWED_CHAT_ATTACHMENT_TYPES,
} from "@/lib/config";

const supabase = supabaseAdmin();

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "text/markdown": "md",
    "text/csv": "csv",
    "application/json": "json",
  };
  return map[mime] || "bin";
}

/**
 * POST /api/chat/upload — upload files for chat attachments.
 *
 * Accepts multipart/form-data with:
 *   - files: File[] (multiple)
 *   - panel_id: string
 *
 * Returns uploaded attachment metadata including signed URLs and
 * ephemeral base64/textContent for Anthropic API consumption.
 */
export const POST = withUserAuth(async (request: NextRequest, { userId }) => {
  const formData = await request.formData();
  const panelId = formData.get("panel_id") as string;

  if (!panelId) {
    return NextResponse.json(
      { error: "panel_id is required" },
      { status: 400 }
    );
  }

  const files = formData.getAll("files") as File[];

  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  if (files.length > MAX_CHAT_ATTACHMENTS_PER_MESSAGE) {
    return NextResponse.json(
      {
        error: `Maximum ${MAX_CHAT_ATTACHMENTS_PER_MESSAGE} files per message`,
      },
      { status: 400 }
    );
  }

  // Validate individual files and total size
  let totalSize = 0;
  for (const file of files) {
    if (file.size > MAX_CHAT_ATTACHMENT_SIZE) {
      return NextResponse.json(
        {
          error: `File "${file.name}" exceeds ${MAX_CHAT_ATTACHMENT_SIZE / (1024 * 1024)}MB limit`,
        },
        { status: 400 }
      );
    }

    if (
      !(ALLOWED_CHAT_ATTACHMENT_TYPES as readonly string[]).includes(file.type)
    ) {
      return NextResponse.json(
        { error: `File type "${file.type}" is not supported` },
        { status: 400 }
      );
    }

    totalSize += file.size;
  }

  if (totalSize > MAX_CHAT_MESSAGE_SIZE) {
    return NextResponse.json(
      {
        error: `Total upload size exceeds ${MAX_CHAT_MESSAGE_SIZE / (1024 * 1024)}MB limit`,
      },
      { status: 400 }
    );
  }

  const attachments = [];

  for (const file of files) {
    const id = crypto.randomUUID();
    const ext = extFromMime(file.type);
    const storagePath = `${userId}/${panelId}/${id}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("chat-attachments")
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: `Upload failed for "${file.name}": ${uploadError.message}` },
        { status: 500 }
      );
    }

    // Insert metadata row
    const { error: dbError } = await supabase
      .from("chat_attachments")
      .insert({
        id,
        user_id: userId,
        panel_id: panelId,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
        storage_path: storagePath,
      });

    if (dbError) {
      // Clean up uploaded file on DB error
      await supabase.storage.from("chat-attachments").remove([storagePath]);
      return NextResponse.json(
        { error: `Failed to save metadata: ${dbError.message}` },
        { status: 500 }
      );
    }

    // Generate signed URL (1 hour)
    const { data: urlData } = await supabase.storage
      .from("chat-attachments")
      .createSignedUrl(storagePath, 3600);

    const attachment: Record<string, unknown> = {
      id,
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      storagePath,
      url: urlData?.signedUrl || "",
    };

    // For images, include base64 for Anthropic vision API
    if (file.type.startsWith("image/")) {
      attachment.base64 = buffer.toString("base64");
    }

    // For text-based files, include content for Anthropic text input
    if (
      file.type.startsWith("text/") ||
      file.type === "application/json"
    ) {
      attachment.textContent = buffer.toString("utf-8");
    }

    attachments.push(attachment);
  }

  return NextResponse.json({ attachments });
});
