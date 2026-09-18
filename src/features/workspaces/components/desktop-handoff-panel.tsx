"use client";

import { useEffect } from "react";
import { workspaceDeepLink, workspaceSegment } from "../url";
import { WEB_POST_AUTH_LANDING as GET_STARTED_PATH } from "@/shared/lib/url/post-auth-landing";

/**
 * Where a web join ends. `/join/{token}` and `/invite/{token}` survive
 * retirement because an emailed link opens in a BROWSER; everything after
 * belongs in the app. ⚠ The web tree cannot render a workspace — Stage D
 * deleted `src/app/[workspaceSlug]/**` and `/{slug}-{publicId}` 302s to
 * `/get-started`.
 *
 * ⚠ THE BUTTON IS THE CONTRACT, auto-open is the enhancement: browsers refuse
 * protocol launches with no user gesture, silently and per-engagement-state.
 * Same shape as `src/app/auth/desktop-handoff/page.tsx`.
 *
 * A download link ALWAYS: half the audience never installed Dopl, and
 * `/download` is on the retirement KEEP list.
 *
 * 🔒 **AND A `/get-started` FALLBACK CARRYING THE SEGMENT SINCE 2026-09-10 (the
 * new-user flow).** `/download` is a bare 307 to the dmg — it hands the one
 * audience that needs help a file and no instructions, and after the install
 * nothing has told them the app needs a sign-in. `/get-started` is the page that
 * does (install steps + the desktop handoff), and the segment rides so the trip
 * ends where the invite pointed rather than on a bare app: it is read back by
 * `src/app/(auth)/get-started/page.tsx`, which renders the same `dopl://open/…`
 * pill this panel does.
 *
 * ⚠ **BOTH LINKS, NOT ONE.** Somebody who already has the app but whose OS
 * swallowed the protocol launch wants the dmg, not a second page; the two answer
 * different failures. Label + link, no explainer.
 *
 * ⚠ **`JoinPendingPanel` BELOW GETS NEITHER THE DEEP LINK NOR THE SEGMENT**, and
 * its own docblock says why: a join request is approval-gated, so there is no
 * membership and no workspace to name yet.
 */

interface Props {
  /** The workspace the caller is now a member of. */
  workspace: { slug: string; publicId: string };
  /** What just happened — the one difference between the two cards. */
  heading: string;
}

export function DesktopHandoffPanel({ workspace, heading }: Props) {
  const deepLink = workspaceDeepLink(workspace);

  useEffect(() => {
    // Assigning a custom scheme does NOT unload the document, so the card
    // stays on screen whether or not the OS had a handler.
    window.location.href = deepLink;
  }, [deepLink]);

  return (
    <div className="mt-6 flex flex-col gap-3">
      <p className="text-small font-medium text-text-primary">{heading}</p>
      <p className="text-caption text-text-tertiary">
        Dopl is a desktop app — opening it now. If nothing happens, use the
        button below.
      </p>
      <a
        href={deepLink}
        className="h-9 px-4 rounded-md bg-surface-cta text-text-on-cta text-small font-medium hover:bg-surface-cta/90 transition-colors inline-flex items-center justify-center"
      >
        Open Dopl
      </a>
      <p className="text-caption text-text-muted">
        Don&apos;t have the app yet?{" "}
        <a href="/download" className="underline underline-offset-2 hover:text-text-secondary">
          Download Dopl
        </a>{" "}
        or{" "}
        <a
          href={getStartedPath(workspace)}
          className="underline underline-offset-2 hover:text-text-secondary"
        >
          set it up
        </a>
        .
      </p>
    </div>
  );
}

/**
 * `/get-started?workspace={segment}` — the install-and-sign-in page, told where
 * this trip was headed.
 *
 * ⚠ The param is a SEGMENT, not an id: `/get-started` is public-facing and a
 * segment is the only workspace identifier the web tree hands out
 * (`workspaces/url.ts › workspaceSegment`). A workspace missing either half falls
 * back to the bare page rather than composing a segment that cannot resolve —
 * the same posture `workspaceDeepLink` takes.
 */
function getStartedPath(ws: { slug: string; publicId: string }): string {
  if (!ws.slug || !ws.publicId) return GET_STARTED_PATH;
  return `${GET_STARTED_PATH}?workspace=${encodeURIComponent(workspaceSegment(ws))}`;
}

/**
 * ⚠ Pending state gets NO deep link. A join request is approval-gated
 * (`join-links.ts › resolveJoinRequest`), so there is no membership yet and
 * `POST /api/boot` is membership-scoped and fail-closed — the app would land on
 * a 404 card.
 *
 * Deliberately no "we'll let you know": nothing web-side watches for approval;
 * the approved requester's notice is the DESKTOP app's
 * (deleted with the guidance layer — Samuel's ruling R-49, 2026-09-17).
 */
export function JoinPendingPanel({ heading }: { heading: string }) {
  return (
    <div className="mt-6 flex flex-col gap-3">
      <p className="text-small font-medium text-text-primary">{heading}</p>
      <p className="text-caption text-text-tertiary">
        An admin has to approve you before you can open this workspace. Once
        they do, open the Dopl desktop app — it will show you the workspace and
        let you know you&apos;re in.
      </p>
      <p className="text-caption text-text-muted">
        Don&apos;t have the app yet?{" "}
        <a href="/download" className="underline underline-offset-2 hover:text-text-secondary">
          Download Dopl
        </a>
        .
      </p>
    </div>
  );
}
