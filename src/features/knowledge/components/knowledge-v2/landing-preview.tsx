"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { knowledgeBaseSegment } from "../../url";
import {
  KnowledgeV2PreviewCore,
  type KnowledgeV2PreviewCoreProps,
} from "./landing-preview-core";
import type { KnowledgeRouting } from "./routing";

type Props = Omit<KnowledgeV2PreviewCoreProps, "routing" | "urlSync">;

/**
 * The web app's knowledge entry point — `./landing-preview-core` plus the one
 * thing that cannot cross into the desktop SPA: `next/navigation`.
 *
 * `ownerNames` and `kbTeams` are RSC props here
 * (`src/app/[workspaceSlug]/(app)/knowledge/**`), so "that data is stale"
 * means "re-run the server component" — hence `router.refresh()`. The SPA
 * fetches both itself and invalidates those queries instead
 * (apps/desktop-ui/src/pages/knowledge/index.tsx).
 */
export function KnowledgeV2Preview(props: Props) {
  const router = useRouter();
  const { workspaceSegment } = props;

  const routing = useMemo<KnowledgeRouting>(
    () => ({
      refreshServerData: () => router.refresh(),
      goToBase: (base, mode) => {
        const to = base
          ? `/${workspaceSegment}/knowledge/${knowledgeBaseSegment(base)}`
          : `/${workspaceSegment}/knowledge`;
        if (mode === "push") router.push(to);
        else router.replace(to);
      },
    }),
    [router, workspaceSegment]
  );

  return <KnowledgeV2PreviewCore {...props} routing={routing} />;
}
