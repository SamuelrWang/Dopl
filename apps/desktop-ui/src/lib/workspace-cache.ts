import type { QueryClient } from "@tanstack/react-query";
import { workspaceReadPath } from "@/shared/layout/settings-modal/sections/workspace-section-core";
import { RESOLVE_PATH } from "#/components/app-shell";
import { ENSURE_DEFAULT_PATH } from "#/pages/boot/use-boot-state";

/**
 * Re-read everything that carries a workspace's name, slug or existence, after
 * a write that changed one.
 *
 * `router.refresh()` has no equivalent in this renderer (CONVENTIONS.md), so a
 * rename or a delete has to name the affected keys itself:
 *
 *   - the workspace read the settings surfaces render from;
 *   - the shell's resolve — a rename MOVES the canonical segment, and
 *     invalidating this is what surfaces it: the resolve answers
 *     `needsRedirect` for the now-stale URL and the shell's existing effect
 *     rewrites it, exactly as it does for a legacy slug;
 *   - the rail/switcher's workspace list;
 *   - the boot route's provisioning answer, which must never replay a segment
 *     that may have just been deleted.
 *
 * ONE copy on purpose. The `/settings` page and the settings modal each had
 * their own, and they had already drifted — the page removed the boot answer on
 * every invalidation and navigated explicitly on a slug change, the modal
 * removed it only on delete (2026-08-03 fleet audit, duplication-quality). Two
 * mechanisms for one rename means the next fix reaches one of them.
 */
export function invalidateWorkspaceReads(
  queryClient: QueryClient,
  segment: string
): void {
  void queryClient.invalidateQueries({ queryKey: [workspaceReadPath(segment)] });
  void queryClient.invalidateQueries({ queryKey: [RESOLVE_PATH] });
  void queryClient.invalidateQueries({ queryKey: ["/api/workspaces"] });
  // Removal, not invalidation: BootPage re-provisions on every mount
  // (`staleTime: 0`, `refetchOnMount: "always"`), so dropping the entry costs
  // nothing and guarantees a deleted segment is never replayed.
  void queryClient.removeQueries({ queryKey: [ENSURE_DEFAULT_PATH] });
}
