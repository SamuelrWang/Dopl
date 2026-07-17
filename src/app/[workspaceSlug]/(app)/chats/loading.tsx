import { TwoPaneListSkeleton } from "@/shared/ui/skeleton";

/**
 * Route-level loading boundary for the chats archive. Renders the shared
 * two-pane skeleton inside the elevated `.page-float` shell (list ghosts +
 * detail-document ghost), matching the loaded ChatsView geometry so the
 * swap to live data doesn't reflow or flash empty.
 */
export default function Loading() {
  return <TwoPaneListSkeleton />;
}
