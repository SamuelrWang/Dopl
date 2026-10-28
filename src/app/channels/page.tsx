import type { Metadata } from "next";
import { StagingChannelsPage } from "@/features/channels-staging/staging-channels-page";

export const metadata: Metadata = {
  title: "Channels · UI staging",
  robots: { index: false, follow: false },
};

/** UI staging for the landing demo's channel face (`src/features/channels-staging/`). */
export default function ChannelsStagingRoute() {
  return <StagingChannelsPage />;
}
