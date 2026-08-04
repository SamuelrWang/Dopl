/**
 * `/get-started` — where a web sign-in ends and the desktop app begins.
 *
 * THE FUNNEL. Landing page "Get Started" → `/login` (which is also the signup
 * surface) → here. The dmg starts downloading on mount, the install steps name
 * the real file, and the last step sends the user into the app to sign in again
 * — the browser-OAuth handoff (`/auth/desktop-start` → `dopl://auth`) that has
 * always been there. Capturing the account BEFORE the download is the whole
 * point: install drop-off becomes recoverable and countable instead of invisible.
 * `src/features/marketing/constants.ts` carries the argument.
 *
 * AUTH-REQUIRED, VIA THE MIDDLEWARE AND AGAIN HERE. `/get-started` is
 * deliberately absent from `proxy.ts` PUBLIC_ROUTES, so a signed-out visitor is
 * bounced to `/login?redirectTo=/get-started` and returns here the moment they
 * have an account. The `getUser()` check below is the second lock, the same one
 * every other page keeps: the middleware decides from LOCALLY verified claims and
 * this decides from GoTrue, and where they disagree the stricter one wins.
 *
 * IT IS ALSO THE RETIREMENT PLAN'S LANDING SPOT.
 * `docs/migration-research/website-retirement-plan.md` §2.2 specifies a page for
 * signed-in users whose app route has been retired ("Dopl now lives in the
 * desktop app… your data is intact") behind the Stage B `WEBSITE_RETIRED` flag.
 * That is this page — same audience state (signed in), same message, same
 * download — so Stage B's redirect map should point at `/get-started` rather
 * than mint a second `/retired` that would drift from it.
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

/** The asset name is read per request (behind the resolver's own 10-minute
 *  revalidate), so a release published five minutes ago is named correctly. */
export const dynamic = "force-dynamic";

export default async function GetStartedPage() {
  const user = await getUser();
  // Carry the destination so the bounce is a round trip, not a dead end — the
  // middleware's own bounce does the same, and `post-auth-landing.ts` honours it.
  if (!user) redirect(`/login?redirectTo=${encodeURIComponent(WEB_POST_AUTH_LANDING)}`);

  // Never throws, and `null` is a normal answer: the copy drops the file name
  // rather than printing a version that might not be the one on disk. The
  // download button beside it degrades to the releases page on the same failure.
  const asset = await resolveMacDownloadAsset();

  return <GetStartedScreen asset={asset} />;
}
