"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  SkillsBrowserCore,
  type SkillsBrowserCoreProps,
} from "./skills-browser-core";

type Props = Omit<SkillsBrowserCoreProps, "onListChanged">;

/**
 * The web app's skills index — `./skills-browser-core` plus the one thing
 * that cannot cross into the desktop SPA: `router.refresh()`.
 *
 * The list arrives as RSC props from
 * `src/app/[workspaceSlug]/(app)/skills/page.tsx`, so "the list is stale"
 * means "re-run the server component". The SPA renders the core directly and
 * invalidates its TanStack query instead
 * (apps/desktop-ui/src/pages/skills/index.tsx).
 */
export function SkillsBrowser(props: Props) {
  const router = useRouter();
  const onListChanged = useCallback(() => router.refresh(), [router]);
  return <SkillsBrowserCore {...props} onListChanged={onListChanged} />;
}
