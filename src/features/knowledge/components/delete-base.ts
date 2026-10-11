import type { QueryClient } from "@tanstack/react-query";
import { userFacingMessage } from "@/shared/api/user-facing-message";
import { toast } from "@/shared/ui/toast";
import { deleteBase } from "../client/api";
import { evictDeletedBase } from "../client/hooks";
import type { KnowledgeBase } from "../types";
import type { KnowledgeRouting } from "./knowledge-v2/routing";

/**
 * DELETE A BASE AND LEAVE IT — the ONE flow both delete buttons run (the settings form's
 * danger zone and the base header's trash). Delete, toast, evict every cached read of the
 * base, drop to the base-less knowledge root, re-pull the list; a failure toasts and stays.
 * The caller owns its own `deleting` state.
 */
export async function deleteBaseAndLeave(
  base: Pick<KnowledgeBase, "id" | "name">,
  workspaceId: string,
  queryClient: QueryClient,
  routing: Pick<KnowledgeRouting, "goToBase" | "refreshServerData">
): Promise<void> {
  try {
    await deleteBase(base.id, workspaceId);
    toast({ title: `"${base.name}" deleted` });
    evictDeletedBase(queryClient, workspaceId, base.id);
    routing.goToBase(null, "replace");
    routing.refreshServerData();
  } catch (err) {
    toast({ title: "Couldn't delete", description: userFacingMessage(err) });
  }
}
