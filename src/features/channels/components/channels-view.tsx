"use client";

import Link from "next/link";
import {
  ChannelsViewCore,
  type ChannelsViewCoreProps,
} from "./channels-view-core";

type Props = Omit<ChannelsViewCoreProps, "Link">;

/**
 * The web app's channels page root — `./channels-view-core` bound to
 * `next/link`.
 *
 * The whole page (list pane, thread, consent inbox, trust, presence, the four
 * realtime subscriptions) lives in the core so the desktop SPA can mount it on
 * its own router (apps/desktop-ui/src/pages/channels/index.tsx). This file is
 * only the router binding; behaviour is unchanged for
 * `src/app/[workspaceSlug]/(app)/channels/page.tsx`.
 */
export function ChannelsView(props: Props) {
  return <ChannelsViewCore {...props} Link={Link} />;
}
