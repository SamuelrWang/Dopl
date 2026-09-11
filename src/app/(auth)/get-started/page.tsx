/**
 * `/get-started` — where a web sign-in ends and the desktop app begins. Funnel: landing "Get
 * Started" → `/authenticate` → here. The dmg downloads on mount; the last step sends the user
 * into the app for the browser-OAuth handoff (`/auth/desktop-start` → `dopl://auth`). Capturing
 * the account BEFORE the download is the point: install drop-off becomes countable.
 *
 * ⚠ Lives in the `(auth)` route group ON PURPOSE: the shared layout owns the split shell, so
 * arriving from `/authenticate` keeps the banner + glass mounted and only the form column
 * swaps — the seamless-transition requirement. The install animation is portaled onto that
 * layout's glass by `GetStartedScreen`.
 *
 * ⚠ AUTH-REQUIRED TWICE: deliberately absent from `proxy.ts` PUBLIC_ROUTES, and the `getUser()`
 * below is the second lock — the middleware decides from LOCALLY verified claims and this from
 * GoTrue; the stricter wins.
 *
 * Also the retirement plan's landing spot (§2.2): same audience, message and download, so Stage
 * B's redirect map points here rather than minting a `/retired` that would drift.
 *
 * 🔒 **`?workspace={segment}` SAYS WHERE THE TRIP WAS HEADED (2026-09-10, the new-user flow).** The
 * invite/join cards' fallback link carries it (`workspaces/components/desktop-handoff-panel.tsx ›
 * getStartedPath`), so somebody who accepted an invitation in a browser with no app installed
 * finishes on the workspace they were invited to rather than on a bare app. ⚠ **VALIDATED, NOT
 * TRUSTED** — `parseSegment` answers null for anything without a real 12-char publicId suffix, and
 * `workspaceDeepLink` composes the URL from the PARSED halves, so a crafted value cannot put
 * arbitrary text after `dopl://open/`. A miss degrades to the plain page; it is a convenience, never
 * a gate, and nothing about the download depends on it.
 *
 * ⚠ **AND THE SIGN-IN BOUNCE PRESERVES IT.** It sent `redirectTo=/get-started` flat, so the segment
 * was deleted by the one round trip the whole link exists to survive — the same query-preserving
 * rule `/billing` states.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolveMacDownloadAsset } from "@/shared/version/mac-download";
import { WEB_POST_AUTH_LANDING } from "@/shared/lib/url/post-auth-landing";
import { parseSegment } from "@/shared/lib/url/parse-segment";
import { workspaceDeepLink } from "@/features/workspaces/url";
import { GetStartedScreen } from "@/features/get-started";

import "@/features/get-started/get-started.css";
import "@/features/get-started/install-animation.css";

export const metadata = {
  title: "Get Dopl for Mac",
  description: "Download the Dopl desktop app and finish setting up your account.",
};

/** Asset name read per request (behind the resolver's 10-minute revalidate). */
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function GetStartedPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const raw = typeof query.workspace === "string" ? query.workspace : null;
  // ⚠ PARSE, then RE-COMPOSE from the halves — see the docblock. A null parse is
  // the normal answer for a legacy slug-only value and for anything crafted.
  const parsed = raw ? parseSegment(raw) : null;

  const user = await getUser();
  // Carry the destination so the bounce is a round trip; `post-auth-landing.ts` honours it.
  // ⚠ WITH THE QUERY: a flat `/get-started` here drops the workspace this visit named.
  if (!user) {
    const back = parsed
      ? `${WEB_POST_AUTH_LANDING}?workspace=${encodeURIComponent(raw!)}`
      : WEB_POST_AUTH_LANDING;
    redirect(`/login?redirectTo=${encodeURIComponent(back)}`);
  }

  // Never throws; `null` is normal — the copy drops the file name rather than printing a version
  // that might not be the one on disk. The button degrades to the releases page.
  const asset = await resolveMacDownloadAsset();

  return (
    <GetStartedScreen
      asset={asset}
      openLink={parsed ? workspaceDeepLink(parsed) : null}
    />
  );
}
