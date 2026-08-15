import "server-only";
import { meetsMinRole } from "@/features/workspaces/types";
import {
  deleteGrantsForResource,
  insertReadGrantsIfMissing,
  listGrantsForResources,
  listTeamIdsForUser,
} from "@/features/teams/server/repository";
import type { Chat, ChatDetail } from "../types";
import type {
  ChatAppendInput,
  ChatExportInput,
  ChatUpdateInput,
} from "../schema";
import {
  ChatFolderNotFoundError,
  ChatFolderScopeError,
  ChatForbiddenError,
} from "./errors";
import { mapChatRow, mapOwner } from "./dto";
import type { ChatFolderRow, ChatRow } from "./dto";
import * as repo from "./repository";
import { resolveChatsWindow } from "./retention";
import { readChatDetail } from "./service-reads";
import {
  UNIQUE_VIOLATION,
  deriveFormat,
  messagePayload,
  profilesById,
  requireOwnChat,
  resolveOrCreateFolderRow,
  stripNulDeep,
  syncChatGrantsToFolder,
  type ChatContext,
} from "./service-shared";
import type { MessagePayload } from "./repository";

/**
 * Write-side chats service: agent-facing export (create / idempotent
 * re-export) plus owner-only mutations. Echoes through `readChatDetail`
 * — visibility-filtered but WITHOUT the retention window — so a
 * just-written backfilled old session never 403s on its own response.
 */

// ─── Export (create / idempotent re-export) ─────────────────────────

/**
 * Agent-facing export. `clientSessionId` matching an earlier export →
 * UPDATE in place, PRESERVING BY DEFAULT: an omitted header field keeps
 * its stored value rather than clearing, and the transcript is reconciled
 * (upsert by position, keep op="append" additions), so a re-export never
 * wipes history. Fresh export writes header + transcript in ONE
 * transaction — a failed write can't leave a 0-message orphan. All text
 * is NUL-stripped first. ⚠ `format` is derived, never taken from caller.
 */
export async function exportChat(
  ctx: ChatContext,
  rawInput: ChatExportInput
): Promise<ChatDetail> {
  // ⚠ NUL (U+0000) 500s Postgres — strip before anything else.
  const input = stripNulDeep(rawInput);

  // Folder scope is authoritative: filing into a folder supersedes any
  // caller-passed visibility.
  const folderRow = input.folder
    ? await resolveOrCreateFolderRow(ctx, input.folder)
    : null;
  const folderId = folderRow?.id ?? null;
  const inherited = folderRow
    ? { visibility: folderRow.visibility, access_mode: folderRow.access_mode }
    : null;

  const payload = messagePayload(input.messages);

  const existing = input.clientSessionId
    ? await repo.findChatByClientSession(ctx.workspaceId, ctx.userId, input.clientSessionId)
    : null;
  if (existing) {
    return reexportChat(ctx, existing, input, folderRow, payload);
  }

  // Fresh export: header + transcript in one transaction (no orphan).
  let chat: ChatRow;
  try {
    chat = await repo.createChatWithMessages(
      {
        workspace_id: ctx.workspaceId,
        owner_id: ctx.userId,
        folder_id: folderId,
        client_session_id: input.clientSessionId ?? null,
        visibility: inherited?.visibility ?? input.visibility ?? "private",
        access_mode: inherited?.access_mode ?? "workspace",
        title: input.title,
        overview: input.overview ?? "",
        source: input.source ?? "other",
        project: input.project ?? null,
        format: deriveFormat(input.messages),
        ...(input.sessionDate ? { session_date: input.sessionDate } : {}),
        deliverables: input.deliverables ?? [],
        learnings: input.learnings ?? [],
        exported_at: new Date().toISOString(),
      },
      payload
    );
  } catch (err) {
    // Lost a first-export race on client_session_id — converge on the
    // winner's row and treat this call as the re-export it now is.
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION && input.clientSessionId) {
      const raced = await repo.findChatByClientSession(
        ctx.workspaceId,
        ctx.userId,
        input.clientSessionId
      );
      if (raced) return reexportChat(ctx, raced, input, folderRow, payload);
    }
    throw err;
  }

  // Inheritance covers grants too — replace-set from the folder.
  if (folderRow) {
    await syncChatGrantsToFolder(ctx, chat.id, folderRow);
  }

  return readChatDetail(ctx, chat.id);
}

/** Idempotent re-export: overwrite only passed header fields, reconcile the
 *  transcript non-destructively, revive a legacy tombstone. `format` is
 *  recomputed so a partial re-export can't leave it stale. */
async function reexportChat(
  ctx: ChatContext,
  existing: ChatRow,
  input: ChatExportInput,
  folderRow: ChatFolderRow | null,
  payload: MessagePayload
): Promise<ChatDetail> {
  const folderId = folderRow?.id ?? null;
  const inherited = folderRow
    ? { visibility: folderRow.visibility, access_mode: folderRow.access_mode }
    : null;

  const chat = await repo.updateChat(existing.id, {
    title: input.title,
    exported_at: new Date().toISOString(),
    // ⚠ Legacy tombstones only — nothing soft-deletes now, but the
    // (workspace, owner, session) unique index still spans rows tombstoned
    // before the switch; re-export revives one rather than colliding.
    deleted_at: null,
    ...(input.overview !== undefined ? { overview: input.overview } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(input.project !== undefined ? { project: input.project ?? null } : {}),
    ...(input.sessionDate ? { session_date: input.sessionDate } : {}),
    ...(input.deliverables !== undefined ? { deliverables: input.deliverables } : {}),
    ...(input.learnings !== undefined ? { learnings: input.learnings } : {}),
    ...(folderId ? { folder_id: folderId, ...inherited } : {}),
  });

  await repo.mergeMessages(chat.id, ctx.workspaceId, payload);

  // Re-derive format over the reconciled transcript (re-sent ∪ kept).
  const all = await repo.listMessages(chat.id);
  const format = deriveFormat(all.map((m) => ({ verbatim: m.verbatim ?? undefined })));
  if (format !== chat.format) {
    await repo.updateChat(chat.id, { format });
  }

  if (folderRow) {
    await syncChatGrantsToFolder(ctx, chat.id, folderRow);
  }
  return readChatDetail(ctx, chat.id);
}

// ─── Mutations (owner-only) ─────────────────────────────────────────

export async function appendMessages(
  ctx: ChatContext,
  chatId: string,
  rawInput: ChatAppendInput
): Promise<ChatDetail> {
  const input = stripNulDeep(rawInput);
  const chat = await requireOwnChat(ctx, chatId, "append to it");
  await repo.appendMessagesTx(chat.id, ctx.workspaceId, messagePayload(input.messages));
  // Verbatim mix may have changed — re-derive format.
  const allMessages = await repo.listMessages(chat.id);
  const format = deriveFormat(
    allMessages.map((m) => ({ verbatim: m.verbatim ?? undefined }))
  );
  if (format !== chat.format) {
    await repo.updateChat(chat.id, { format });
  }

  const [{ since }, detail] = await Promise.all([
    resolveChatsWindow(ctx.workspaceId),
    readChatDetail(ctx, chat.id),
  ]);
  // ⚠ Append is always allowed, but the echo must not become a
  // retention-window bypass: appending to a >90-day chat on a free
  // workspace can't read the hidden transcript back. `messageCount` stays
  // honest; only the body is withheld, and MCP `op=append` reads the count.
  if (since !== null && detail.sessionDate < since) {
    return { ...detail, messages: [] };
  }
  return detail;
}

export async function updateChatHeader(
  ctx: ChatContext,
  chatId: string,
  rawPatch: ChatUpdateInput
): Promise<Chat> {
  const patch = stripNulDeep(rawPatch);
  const chat = await requireOwnChat(ctx, chatId, "update it");

  // Resolve the folder move FIRST — inheritance and the filed-chat sharing
  // guard both depend on where the chat ends up.
  let folderPatch: { folder_id: string | null } | undefined;
  let targetFolder: ChatFolderRow | null = null;
  if (patch.folderId !== undefined) {
    if (patch.folderId !== null) {
      targetFolder = await repo.findFolderById(ctx.workspaceId, ctx.userId, patch.folderId);
      if (!targetFolder) throw new ChatFolderNotFoundError(patch.folderId);
    }
    folderPatch = { folder_id: patch.folderId };
  } else if (patch.folder !== undefined) {
    if (patch.folder !== null) {
      targetFolder = await resolveOrCreateFolderRow(ctx, patch.folder);
    }
    folderPatch = { folder_id: targetFolder?.id ?? null };
  }

  // Filed chats inherit folder sharing: a direct visibility change is
  // rejected unless this same patch unfiles. (Schema already blocks
  // visibility combined with filing INTO a folder.)
  if (
    patch.visibility !== undefined &&
    chat.folder_id !== null &&
    !(folderPatch && folderPatch.folder_id === null)
  ) {
    const currentFolder = await repo.findFolderById(
      ctx.workspaceId,
      ctx.userId,
      chat.folder_id
    );
    throw new ChatFolderScopeError(currentFolder?.name ?? "its folder");
  }

  // Team-scoped replaces the grant set wholesale; any other scope drops all
  // grants. Non-admin owners may grant only teams they belong to, plus
  // already-granted teams (share UI renders those locked). Mirrors the KB
  // rule. Moving into a folder inherits the folder's scope + grants instead.
  let sharingPatch: { visibility?: string; access_mode?: string } = {};
  let grantTeamIds: string[] | null = null;
  if (targetFolder) {
    sharingPatch = {
      visibility: targetFolder.visibility,
      access_mode: targetFolder.access_mode,
    };
  } else if (patch.visibility !== undefined) {
    const wantsTeams = patch.visibility === "public" && patch.accessMode === "teams";
    sharingPatch = {
      visibility: patch.visibility,
      access_mode: wantsTeams ? "teams" : "workspace",
    };
    if (wantsTeams) {
      grantTeamIds = [...new Set(patch.teamIds ?? [])];
      const isAdmin = ctx.role !== null && meetsMinRole(ctx.role, "admin");
      if (!isAdmin && grantTeamIds.length > 0) {
        const [myTeams, existing] = await Promise.all([
          listTeamIdsForUser(ctx.workspaceId, ctx.userId),
          listGrantsForResources(ctx.workspaceId, "chat", [chat.id]),
        ]);
        const allowed = new Set([...myTeams, ...existing.map((g) => g.teamId)]);
        if (grantTeamIds.some((id) => !allowed.has(id))) {
          throw new ChatForbiddenError("grant teams you don't belong to");
        }
      }
    }
  }

  const row = await repo.updateChat(chat.id, {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.overview !== undefined ? { overview: patch.overview } : {}),
    ...(patch.project !== undefined ? { project: patch.project } : {}),
    ...(patch.sessionDate !== undefined ? { session_date: patch.sessionDate } : {}),
    ...sharingPatch,
    ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
    ...(patch.deliverables !== undefined ? { deliverables: patch.deliverables } : {}),
    ...(patch.learnings !== undefined ? { learnings: patch.learnings } : {}),
    ...(folderPatch ?? {}),
  });

  if (targetFolder) {
    await syncChatGrantsToFolder(ctx, chat.id, targetFolder);
  } else if (patch.visibility !== undefined) {
    // Replace-set: clear, then re-insert.
    await deleteGrantsForResource(ctx.workspaceId, "chat", chat.id);
    if (grantTeamIds && grantTeamIds.length > 0) {
      await insertReadGrantsIfMissing(ctx.workspaceId, "chat", chat.id, grantTeamIds);
    }
  }

  const [count, profiles] = await Promise.all([
    repo.countMessages(row.id),
    profilesById([row.owner_id]),
  ]);
  // Grant set must be returned even when sharing wasn't touched.
  const teamIds =
    grantTeamIds ??
    (row.access_mode === "teams"
      ? (await listGrantsForResources(ctx.workspaceId, "chat", [row.id])).map(
          (g) => g.teamId
        )
      : []);
  return mapChatRow(
    row,
    mapOwner(row.owner_id, profiles.get(row.owner_id)),
    count,
    teamIds
  );
}

/**
 * ⚠ PERMANENT delete, owner-only, no trash/restore. `requireOwnChat` is
 * the gate: unknown, cross-workspace, someone-else's, or workspace-scoped
 * API-key callers are all refused. Physical delete cascades
 * `chat_messages` via FK and drops team grants via trigger.
 */
export async function deleteChat(ctx: ChatContext, chatId: string): Promise<void> {
  const chat = await requireOwnChat(ctx, chatId, "delete it");
  await repo.hardDeleteChat(ctx.workspaceId, chat.id);
}
