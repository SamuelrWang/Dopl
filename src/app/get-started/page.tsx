/**
 * `/get-started` — where a web sign-in ends and the desktop app begins. Funnel: landing "Get
 * Started" → `/login` → here. The dmg downloads on mount; the last step sends the user into the
 * app for the browser-OAuth handoff (`/auth/desktop-start` → `dopl://auth`). Capturing the
 * account BEFORE the download is the point: install drop-off becomes countable.
 *
 * ⚠ AUTH-REQUIRED TWICE: deliberately absent from `proxy.ts` PUBLIC_ROUTES, and the `getUser()`
 * below is the second lock — the middleware decides from LOCALLY verified claims and this from
 * GoTrue; the stricter wins.
 *
 * Also the retirement plan's landing spot (§2.2): same audience, message and download, so Stage
 * B's redirect map points here rather than minting a `/retired` that would drift.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolveMacDownloadAsset } from "@/shared/version/mac-download";
import { WEB_POST_AUTH_LANDING } from "@/shared/lib/url/post-auth-landing";
import { GetStartedScreen } from "@/features/get-started";

import "@/features/marketing/marketing.css";
import "@/features/get-started/get-started.css";
import "@/features/get-started/install-animation.css";
import "@/features/get-started/install-animation-motion.css";

export const metadata = {
  title: "Get Dopl for Mac",
  description: "Download the Dopl desktop app and finish setting up your account.",
};

/** Asset name read per request (behind the resolver's 10-minute revalidate). */
export const dynamic = "force-dynamic";

export default async function GetStartedPage() {
  const user = await getUser();
  // Carry the destination so the bounce is a round trip; `post-auth-landing.ts` honours it.
  if (!user) redirect(`/login?redirectTo=${encodeURIComponent(WEB_POST_AUTH_LANDING)}`);

  // Never throws; `null` is normal — the copy drops the file name rather than printing a version
  // that might not be the one on disk. The button degrades to the releases page.
  const asset = await resolveMacDownloadAsset();

  return <GetStartedScreen asset={asset} />;
}
