import { TwoPaneListSkeleton } from "@/shared/ui/skeleton";

/**
 * Loading boundary for a deep-linked knowledge base. Renders the shared
 * two-pane skeleton inside the elevated `.page-float` shell so the
 * persistent shell never flashes a flat or mismatched shape while the base
 * + entry SSR.
 */
export default function Loading() {
  return <TwoPaneListSkeleton />;
}
