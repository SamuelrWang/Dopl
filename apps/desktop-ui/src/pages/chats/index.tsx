import { useParams } from "react-router";
import { ChatsView } from "@/features/chats/components/chats-view";
import type { Chat, ChatFolder } from "@/features/chats/types";
import type { Role, Workspace } from "@/features/workspaces/types";
import { PageError, PageLoading } from "#/components/page-states";
import { useApiQuery } from "#/hooks/use-api-query";

/**
 * /:workspaceSegment/chats — the agent-exported chat archive.
 *
 * Port of `src/app/[workspaceSlug]/(app)/chats/page.tsx`. `ChatsView` and its
 * whole component tree are REUSED by import (they are Next-free); this file is
 * only the seam that turns the RSC's server fetches into client queries.
 *
 * The RSC resolved workspace + membership + `listChats`/`listFolders` and
 * passed all of it down. Here the same four reads are `useApiQuery` calls
 * against the endpoints that already back them, and the page mounts `ChatsView`
 * once they land — not before: the view seeds its own `useState` (including the
 * initial selection) from these props, so a mount with empty arrays would pick
 * the wrong selection and never re-seed.
 *
 * Two round trips, not one: `resolve` turns the URL segment into a workspace
 * (and its canonical form, which `useTeams` inside the share popovers uses as a
 * path segment), then `me` — which is id-scoped by header — supplies the
 * caller's role and user id that only the RSC had.
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
  if (!workspace || !me || !list || !folderList) return <PageLoading />;

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
