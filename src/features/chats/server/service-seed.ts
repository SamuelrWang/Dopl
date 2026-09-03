import "server-only";
import type { Role } from "@/features/workspaces/types";
import { buildChatSeed } from "./seed";
import { exportChat } from "./service-writes";
import type { ChatContext } from "./service-shared";

export interface SeedChatResult {
  chatId: string | null;
}

/** Seeds the sample chat through the ordinary `exportChat` path.
 *  `clientSessionId` makes it idempotent — a second run updates the row. */
export async function seedWorkspace(
  workspaceId: string,
  userId: string
): Promise<SeedChatResult> {
  const ctx: ChatContext = {
    workspaceId,
    userId,
    source: "user",
    role: "owner" as Role,
    apiKeyWorkspaceId: null,
    credentialSubjectUserId: userId,
  };
  const chat = await exportChat(ctx, buildChatSeed());
  return { chatId: chat.id };
}
