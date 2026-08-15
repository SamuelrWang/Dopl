import { useParams } from "react-router";
import { ChatsView } from "@/features/chats/components/chats-view";
import type { Chat, ChatFolder } from "@/features/chats/types";
import type { Role, Workspace } from "@/features/workspaces/types";
import { PageError, PageLoading } from "#/components/page-states";
import { useApiQuery } from "#/hooks/use-api-query";

/**
 * /:workspaceSegment/chats — agent-exported chat archive. Seam only; `ChatsView`
 * and its tree are REUSED by import.
 *
 * ⚠ Mount `ChatsView` only once all four reads land: it seeds its own `useState`
 * (including initial selection) from these props, so a mount with empty arrays
 * picks the wrong selection and never re-seeds.
 *
 * Two round trips, not one: `resolve` turns the URL segment into a workspace
 * plus its canonical form (used as a path segment by `useTeams` in the share
 * popovers); `me` is id-scoped by header and supplies caller role + user id.
 */

interface ResolvedSegment {
  workspace: Workspace;
  canonical: string;
  needsRedirect: boolean;
}

interface Identity {
  role: Role;
  userId: string;
}

interface ChatsResponse {
  chats: Chat[];
  hiddenCount: number;
}

const selectFolders = (body: { folders: ChatFolder[] }) => body.folders ?? [];

export default function ChatsPage() {
  const { workspaceSegment = "" } = useParams();

  const resolved = useApiQuery<ResolvedSegment>("/api/workspaces/resolve", {
    query: { segment: workspaceSegment },
    enabled: workspaceSegment !== "",
  });
  const workspaceId = resolved.data?.workspace.id;
  const scoped = { workspaceId, enabled: workspaceId !== undefined };

  const identity = useApiQuery<Identity>("/api/workspaces/me", scoped);
  const chats = useApiQuery<ChatsResponse>("/api/chats", scoped);
  const folders = useApiQuery<{ folders: ChatFolder[] }, ChatFolder[]>(
    "/api/chats/folders",
    { ...scoped, select: selectFolders }
  );

  const error =
    resolved.error ?? identity.error ?? chats.error ?? folders.error;
  if (error) {
    return (
      <PageError
        error={error}
        onRetry={() => {
          void resolved.refetch();
          void identity.refetch();
          void chats.refetch();
          void folders.refetch();
        }}
      />
    );
  }

  const workspace = resolved.data;
  const me = identity.data;
  const list = chats.data;
  const folderList = folders.data;
  if (!workspace || !me || !list || !folderList) return <PageLoading label="Loading chats" variant="two-pane" />;

  return (
    <ChatsView
      workspaceId={workspace.workspace.id}
      workspaceSlug={workspace.canonical}
      currentUserId={me.userId}
      role={me.role}
      initialChats={list.chats}
      initialFolders={folderList}
      hiddenCount={list.hiddenCount}
    />
  );
}
