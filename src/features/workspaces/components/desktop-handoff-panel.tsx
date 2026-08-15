"use client";

import { useEffect } from "react";
import { workspaceDeepLink } from "../url";

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
        </a>
        .
      </p>
    </div>
  );
}

/**
 * ⚠ Pending state gets NO deep link. A join request is approval-gated
 * (`join-links.ts › resolveJoinRequest`), so there is no membership yet and
 * `POST /api/boot` is membership-scoped and fail-closed — the app would land on
 * a 404 card.
 *
 * Deliberately no "we'll let you know": nothing web-side watches for approval;
 * the approved requester's notice is the DESKTOP app's
 * (`JoinRequestNoticesCore`, mounted in the SPA shell).
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
