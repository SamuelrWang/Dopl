import { ChannelsSkeleton } from "@/features/channels/components/channels-skeleton";

/**
 * Route-level loading boundary — mirrors the channels two-pane chrome so
 * the swap to the live page doesn't reflow.
 */
export default function Loading() {
  return <ChannelsSkeleton />;
}
