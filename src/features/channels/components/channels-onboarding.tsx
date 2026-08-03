"use client";

import Link from "next/link";
import { ChannelsOnboardingCore } from "./channels-onboarding-core";

interface Props {
  workspaceSlug: string;
  canCreate: boolean;
  onCreate: () => void;
}

/**
 * The web app's channels first-run explainer — `./channels-onboarding-core`
 * bound to `next/link`.
 *
 * The markup and the members query live in the core so the desktop SPA can
 * mount the same explainer on its own router
 * (apps/desktop-ui/src/pages/channels/index.tsx); this file is only the
 * `next/link` binding, the one Next import the channels tree had.
 */
export function ChannelsOnboarding(props: Props) {
  return <ChannelsOnboardingCore {...props} Link={Link} />;
}
