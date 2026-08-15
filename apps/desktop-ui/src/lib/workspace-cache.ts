import type { QueryClient } from "@tanstack/react-query";
import { workspaceReadPath } from "@/shared/layout/settings-modal/sections/workspace-section-core";
import { RESOLVE_PATH } from "#/components/app-shell";
import { BOOT_PATH } from "#/pages/boot/use-boot-state";

/**
 * Re-read everything carrying a workspace's name, slug or existence after a
 * write that changed one. No `router.refresh()` equivalent here
 * (CONVENTIONS.md), so a rename/delete names the affected keys itself:
 *
 *   - the workspace read the settings surfaces render from;
 *   - the shell's resolve — a rename MOVES the canonical segment; invalidating
 *     makes the resolve answer `needsRedirect` and the shell's existing effect
 *     rewrites the URL, as for a legacy slug;
 *   - the switcher's workspace list;
 *   - the boot route's provisioning answer, which must never replay a segment
 *     that may have just been deleted.
 *
 * ⚠ ONE copy on purpose — the `/settings` page and the settings modal each had
 * their own and had already drifted. Two mechanisms for one rename means the
 * next fix reaches only one of them.
 */
export function invalidateWorkspaceReads(
  queryClient: QueryClient,
  segment: string
): void {
  void queryClient.invalidateQueries({ queryKey: [workspaceReadPath(segment)] });
  void queryClient.invalidateQueries({ queryKey: [RESOLVE_PATH] });
  void queryClient.invalidateQueries({ queryKey: ["/api/workspaces"] });
  // ⚠ Removal, not invalidation: BootPage re-resolves on every mount
  // (`staleTime: 0`, `refetchOnMount: "always"`), so dropping costs nothing and
  // guarantees a deleted segment is never replayed. The whole `/api/boot`
  // prefix goes, which also drops the SHELL's entry for the old segment.
  void queryClient.removeQueries({ queryKey: [BOOT_PATH] });
}
