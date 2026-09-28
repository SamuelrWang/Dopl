import "server-only";
import { resolveActiveWorkspace } from "@/features/workspaces/server/service";
import { buildChannelContext } from "@/features/channels/server/service";
import type { ChannelContext } from "@/features/channels/server/service-shared";

/**
 * The channels-service context for acting as the device OWNER in one of their
 * containers, resolved the way `withWorkspaceAuth` does for a signed-in route,
 * so every membership, guest and soft-delete rule applies unchanged.
 */
export async function operatorChannelContext(userId: string, containerId: string): Promise<ChannelContext> {
  const { workspace, membership } = await resolveActiveWorkspace(userId, containerId);
  return buildChannelContext({
    userId,
    workspaceId: workspace.id,
    role: membership.role,
    workspaceKind: workspace.kind,
    agentTokenId: null,
    apiKeyWorkspaceId: null,
    credentialSubjectUserId: userId,
  });
}
