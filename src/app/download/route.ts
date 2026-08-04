import { NextResponse } from "next/server";
import { resolveMacDownloadUrl } from "@/shared/version/mac-download";

export const dynamic = "force-dynamic";

/**
 * `GET /download` — the landing page's Download button, one hop from a click to
 * the newest notarized macOS build.
 *
 * WHY A ROUTE AND NOT AN href. The asset name moves every release
 * (`Dopl-1.7.24-arm64.dmg`), so no static github.com URL stays valid; the one
 * the landing page shipped with had 404'd since the day it was written.
 * `src/shared/version/mac-download.ts` carries the full argument, including the
 * electron-builder alternative and why it lost.
 *
 * IT IS ALSO THE STABLE NAME. `usedopl.com/download` is what goes in a README, a
 * DM and a tweet, and it keeps working across every future change to how the
 * build is published — including the website retirement, which keeps this page
 * and this route precisely because they are how the desktop app is obtained.
 *
 * PUBLIC. Listed in `src/proxy.ts` PUBLIC_ROUTES: a visitor who has never signed
 * in is the entire audience, and without that entry the middleware bounces the
 * download to `/login` — the exact thing this change exists to stop advertising.
 *
 * NEVER FAILS. `resolveMacDownloadUrl()` cannot throw and cannot return a
 * non-GitHub URL; its worst case is the releases page. So this handler has no
 * error branch, which is the point: a Download button must not be able to show
 * anybody a stack trace.
 */
export async function GET() {
  const target = await resolveMacDownloadUrl();
  const res = NextResponse.redirect(target, 307);
  // The resolver owns the TTL. A browser (or a CDN) caching the redirect itself
  // would pin a visitor to whatever build was current the first time they
  // clicked, which is the staleness this route exists to remove.
  res.headers.set("cache-control", "no-store");
  return res;
}
