import { NextResponse } from "next/server";
import { resolveMacDownloadUrl } from "@/shared/version/mac-download";

export const dynamic = "force-dynamic";

/**
 * `GET /download` — one hop from the landing page's Download button to the newest notarized
 * macOS build. A route rather than an href because the asset name moves every release
 * (`Dopl-1.7.24-arm64.dmg`), so no static github.com URL stays valid.
 * `src/shared/version/mac-download.ts` carries the argument (incl. why electron-builder lost).
 *
 * ⚠ PUBLIC — must stay in `src/proxy.ts` PUBLIC_ROUTES; without that entry the middleware
 * bounces the download to `/login`, and a never-signed-in visitor is the entire audience.
 *
 * ⚠ NEVER FAILS: `resolveMacDownloadUrl()` cannot throw and cannot return a non-GitHub URL (worst
 * case is the releases page), so this handler has no error branch — a Download button must not be
 * able to show anybody a stack trace.
 */
export async function GET() {
  const target = await resolveMacDownloadUrl();
  const res = NextResponse.redirect(target, 307);
  // ⚠ The resolver owns the TTL. Caching the redirect itself pins a visitor to whatever build
  // was current on their first click — the staleness this route exists to remove.
  res.headers.set("cache-control", "no-store");
  return res;
}
