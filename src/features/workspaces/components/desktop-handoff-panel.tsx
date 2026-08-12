"use client";

import { useEffect } from "react";
import { workspaceDeepLink } from "../url";

/**
 * WHERE A WEB JOIN ENDS.
 *
 * `/join/{token}` and `/invite/{token}` survive the website retirement because
 * a link in an email or a Slack message opens in a BROWSER — there is no way to
 * make the first hop land in the app. Everything after it, though, belongs in
 * the app: the web tree cannot render a workspace any more (Stage D deleted
 * `src/app/[workspaceSlug]/**`; `/{slug}-{publicId}` 302s to `/get-started`),
 * so the two cards used to finish a successful join by pushing a URL that
 * bounced the new member onto a download page with no explanation.
 *
 * THE BUTTON IS THE CONTRACT, THE AUTO-OPEN IS THE ENHANCEMENT. A browser may
 * refuse a protocol launch that no user gesture asked for — silently, and
 * differently per browser and per engagement state — so the anchor is what this
 * component promises and the effect is a best-effort head start. Same shape as
 * `src/app/auth/desktop-handoff/page.tsx`, which is the other producer of
 * `dopl://` links and has run this pattern since the desktop OAuth handoff
 * shipped.
 *
 * AND A DOWNLOAD LINK, ALWAYS. Half the audience for a join link is someone who
 * has never installed Dopl, for whom the deep link cannot resolve to anything;
 * `/download` is on the retirement KEEP list precisely because it is how the app
 * is obtained.
 */

interface Props {
  /** The workspace the caller is now a member of. */
  workspace: { slug: string; publicId: string };
  /** What just happened — the one thing that differs between the two cards. */
  heading: string;
}

export function DesktopHandoffPanel({ workspace, heading }: Props) {
  const deepLink = workspaceDeepLink(workspace);

  useEffect(() => {
    // Assigning a custom scheme does NOT unload the document, so the card (and
    // its button) stays on screen whether or not the OS had a handler.
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
 * THE PENDING STATE, WHICH GETS NO LINK.
 *
 * A join request is approval-gated (`join-links.ts › resolveJoinRequest`), so
 * at this moment there is no membership and `dopl://open/{segment}` would
 * resolve to a workspace the caller cannot boot — `POST /api/boot` is
 * membership-scoped and fail-closed, so the app would land on a 404 card. The
 * honest answer is copy, and copy only.
 *
 * There is deliberately NO "we'll let you know" here. Nothing on the web side
 * watches for the approval, and the approved requester's notice is the DESKTOP
 * app's (`JoinRequestNoticesCore`, mounted in the SPA shell) — so what this says
 * is exactly what is true: open the app, and it will tell you.
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
