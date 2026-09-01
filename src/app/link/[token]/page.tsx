/**
 * /link/[token] — the HOME-CHANNEL claim landing. Same shape as
 * `/join/[token]`: an unauthenticated visitor sees who is inviting them and a
 * sign-in CTA that bounces through /authenticate and back; an authenticated one
 * gets a Connect button that claims the link.
 *
 * ⚠ THE SERVICE IS CALLED DIRECTLY, not over `/api/home/link/{token}/info` —
 * the join page's precedent (`getJoinLinkInfo`). This is an RSC on the server
 * that owns the service; a fetch to our own route would be a round trip to buy
 * nothing. The ROUTE still exists for callers that are not this page.
 *
 * ⚠ An unknown token 404s from `getLinkPublicInfo` deliberately, so the page is
 * not an oracle for which tokens exist. A DEAD link (expired / revoked /
 * exhausted) is a different answer and gets its own card — the visitor holds a
 * real URL and is owed the reason.
 */

import { notFound } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { HttpError } from "@/shared/lib/http-error";
import { getLinkPublicInfo } from "@/features/home/server/service-reads";
import type { HomeLinkPublicInfo } from "@/features/home/types";
import { LinkClaimCard } from "./claim-card";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function LinkClaimPage({ params }: PageProps) {
  const { token } = await params;
  if (!token) notFound();

  // ⚠ ONLY the 404 becomes a not-found page. A swallowed `catch` would render an
  // outage as "no such link", which is the one wrong answer this page can give.
  const info: HomeLinkPublicInfo | null = await getLinkPublicInfo(token).catch(
    (err: unknown) => {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  );
  if (!info) notFound();

  const user = await getUser();

  return (
    // ⚠ FIXED FULL-VIEWPORT SURFACE, on `shared/layout/auth-split` ›
    // AuthSplitLayout's pattern, and it is what makes the page white. `/link` is
    // in `LayoutShell`'s NON_WORKSPACE_ROOTS, so the shell paints `mosaic-bg`
    // (the dark frame) on <body> and wraps the route in a centred `container`
    // — a `bg-white` block in flow would leave dark gutters beside it. Taking
    // the page out of flow overrides both without touching the shell's set.
    //
    // ⚠ Face is the LANDING grotesk (`features/marketing/marketing.css` › `.lp`
    // `--grotesk`), stated inline for the same reason AuthSplitLayout states it:
    // that custom property is declared on `.lp`, which this page is not inside.
    <main
      className="fixed inset-0 z-50 overflow-y-auto bg-white"
      style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
    >
      <div className="flex min-h-full items-center justify-center px-5 py-16">
        <LinkClaimCard
          creatorName={info.creatorDisplayName}
          dead={info.expired || info.revoked || info.exhausted}
          token={token}
          needsAuth={!user}
        />
      </div>
    </main>
  );
}
