import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { generatePublicId } from "@/shared/lib/id/public-id";
import { HttpError } from "@/shared/lib/http-error";

const BUCKET = "workspace-icons";
const MAX_BYTES = 2 * 1024 * 1024;

/** Allowed upload types → file extension. Mirrors the bucket's
 * allowed_mime_types in the migration. */
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

/**
 * Upload a workspace icon to the public `workspace-icons` bucket and
 * return its public URL. Each upload gets a random filename (cache-busts
 * the CDN on change); any previously-stored icon for the workspace is
 * removed so the bucket never accumulates orphans. Throws `HttpError`
 * (400) on bad type/size, (500) on a storage failure.
 */
export async function uploadWorkspaceIcon(workspaceId: string, file: File): Promise<string> {
  const ext = MIME_EXT[file.type];
  if (!ext) {
    throw new HttpError(
      400,
      "INVALID_IMAGE_TYPE",
      "Icon must be a PNG, JPEG, WebP, GIF, or SVG image"
    );
  }
  if (file.size > MAX_BYTES) {
    throw new HttpError(400, "IMAGE_TOO_LARGE", "Icon must be 2 MB or smaller");
  }

  const db = supabaseAdmin();
  const path = `${workspaceId}/${generatePublicId()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: true });
  if (error) {
    throw new HttpError(500, "ICON_UPLOAD_FAILED", "Couldn't upload the workspace icon");
  }

  await removeIconObjects(workspaceId, path);
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Remove every stored icon object for a workspace (used when clearing). */
export async function clearWorkspaceIcon(workspaceId: string): Promise<void> {
  await removeIconObjects(workspaceId, null);
}

/**
 * Delete all icon objects under `{workspaceId}/` except `keepPath`.
 * Best-effort — a stale orphan is harmless and we never want cleanup
 * failure to fail the user-facing request.
 */
async function removeIconObjects(workspaceId: string, keepPath: string | null): Promise<void> {
  const db = supabaseAdmin();
  const { data, error } = await db.storage.from(BUCKET).list(workspaceId);
  if (error || !data) return;
  const toRemove = data
    .map((obj) => `${workspaceId}/${obj.name}`)
    .filter((p) => p !== keepPath);
  if (toRemove.length > 0) {
    await db.storage.from(BUCKET).remove(toRemove);
  }
}
