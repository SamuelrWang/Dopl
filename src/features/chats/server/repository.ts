import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Database } from "@/shared/supabase/types";
import type { ChatFolderRow, ChatMessageRow, ChatRow, ProfileRef } from "./dto";

type ChatUpdate = Database["public"]["Tables"]["chats"]["Update"];

/** Chat row + PostgREST-embedded message count. */
export type ChatRowWithCount = ChatRow & { chat_messages: Array<{ count: number }> };

const CHAT_SELECT = "*, chat_messages(count)";

export function countOf(row: ChatRowWithCount): number {
  return row.chat_messages[0]?.count ?? 0;
}

// ─── Retention window ───────────────────────────────────────────────

/**
 * Free-plan retention cutoff as a `YYYY-MM-DD` DATE string, computed on
 * the DB clock (`now() - interval`). Callers feed it to `.gte`/`.lt`
 * `session_date` filters so the window boundary lives in Postgres, not in
 * JS date math. See migration `chats_retention_cutoff`.
 */
export async function retentionCutoff(windowDays: number): Promise<string> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("chats_retention_cutoff", {
    p_window_days: windowDays,
  });
  if (error) throw error;
  return data as string;
}

// ─── Chats ──────────────────────────────────────────────────────────

/**
 * Everything the caller may read: their own chats + workspace-public
 * ones. When `since` is set (free-plan retention window), rows whose
 * `session_date` is older than the cutoff are excluded in the query —
 * hidden, never deleted. `null` = full history.
 */
export async function listVisibleChats(
  workspaceId: string,
  userId: string,
  since: string | null = null
): Promise<ChatRowWithCount[]> {
  const db = supabaseAdmin();
  let query = db
    .from("chats")
    .select(CHAT_SELECT)
    .eq("workspace_id", workspaceId)
    // Soft-deleted chats are hidden from every active read (F-11). Passed as
    // a raw `.or()` string because `deleted_at` is not yet in the generated
    // column types (added by migration 20260718000002); a separate top-level
    // `.or(...)` AND-combines with the owner/public predicate above.
    .or("deleted_at.is.null")
    .or(`owner_id.eq.${userId},visibility.eq.public`);
  if (since) query = query.gte("session_date", since);
  const { data, error } = await query.order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ChatRowWithCount[];
}

/**
 * Count of chats the caller could otherwise read (same owner-or-public
 * predicate as `listVisibleChats`) that fall OUTSIDE the retention window
 * (`session_date < since`). Head-count only — no rows fetched. Drives the
 * "N older chats hidden" upgrade affordance.
 */
export async function countHiddenChats(
  workspaceId: string,
  userId: string,
  since: string
): Promise<number> {
  const db = supabaseAdmin();
  const { count, error } = await db
    .from("chats")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    // Trashed chats are neither shown nor counted as "hidden by retention".
    .or("deleted_at.is.null")
    .or(`owner_id.eq.${userId},visibility.eq.public`)
    .lt("session_date", since);
  if (error) throw error;
  return count ?? 0;
}

export async function findChatById(
  workspaceId: string,
  chatId: string
): Promise<ChatRowWithCount | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("chats")
    .select(CHAT_SELECT)
    .eq("workspace_id", workspaceId)
    .eq("id", chatId)
    // Active reads (get / append / update / delete ownership + the
    // post-write echo) never resolve a trashed chat — it reads as missing.
    .or("deleted_at.is.null")
    .maybeSingle();
  if (error) throw error;
  return data as ChatRowWithCount | null;
}

/**
 * Trash lookup for restore: the one place that resolves a SOFT-DELETED
 * chat by id (deleted_at IS NOT NULL). Active reads use `findChatById`.
 */
export async function findDeletedChatById(
  workspaceId: string,
  chatId: string
): Promise<ChatRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("chats")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", chatId)
    .or("deleted_at.not.is.null")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** The caller's own soft-deleted chats, newest-trashed first. */
export async function listTrashedChats(
  workspaceId: string,
  ownerId: string
): Promise<ChatRowWithCount[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("chats")
    .select(CHAT_SELECT)
    .eq("workspace_id", workspaceId)
    .eq("owner_id", ownerId)
    .or("deleted_at.not.is.null")
    .order("deleted_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ChatRowWithCount[];
}

// The idempotency lookup deliberately does NOT filter `deleted_at`: the
// (workspace_id, owner_id, client_session_id) unique index spans trashed
// rows, so a re-export must find a soft-deleted match and revive it
// (exportChat clears `deleted_at`) rather than collide on the index.
export async function findChatByClientSession(
  workspaceId: string,
  ownerId: string,
  clientSessionId: string
): Promise<ChatRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("chats")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("owner_id", ownerId)
    .eq("client_session_id", clientSessionId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// `deleted_at` is added by migration 20260718000002 and not yet in the
// generated `ChatUpdate` type (regenerated after the migration applies), so
// the soft-delete/revive writes widen the patch here and cast on the way to
// Supabase.
type ChatUpdatePatch = ChatUpdate & { deleted_at?: string | null };

export async function updateChat(
  chatId: string,
  patch: ChatUpdatePatch
): Promise<ChatRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("chats")
    .update({ ...patch, updated_at: new Date().toISOString() } as unknown as ChatUpdate)
    .eq("id", chatId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Soft-delete: hide the chat from active reads, keep it restorable (F-11).
 * Scoped by `workspace_id` as defense-in-depth on the destructive path — the
 * caller already resolves the chat in-workspace, but the extra predicate makes
 * a cross-workspace mutation structurally impossible (mirrors the workflow
 * soft-delete updates).
 */
export async function softDeleteChat(workspaceId: string, chatId: string): Promise<ChatRow> {
  return updateChatScoped(workspaceId, chatId, { deleted_at: new Date().toISOString() });
}

/** Restore a soft-deleted chat by clearing its `deleted_at` (workspace-scoped). */
export async function restoreChatRow(workspaceId: string, chatId: string): Promise<ChatRow> {
  return updateChatScoped(workspaceId, chatId, { deleted_at: null });
}

/** `updateChat` variant that also pins `workspace_id` in the WHERE. */
async function updateChatScoped(
  workspaceId: string,
  chatId: string,
  patch: ChatUpdatePatch
): Promise<ChatRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("chats")
    .update({ ...patch, updated_at: new Date().toISOString() } as unknown as ChatUpdate)
    .eq("id", chatId)
    .eq("workspace_id", workspaceId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// ─── Messages ───────────────────────────────────────────────────────

export async function listMessages(chatId: string): Promise<ChatMessageRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("chat_messages")
    .select("*")
    .eq("chat_id", chatId)
    .order("position", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function countMessages(chatId: string): Promise<number> {
  const db = supabaseAdmin();
  const { count, error } = await db
    .from("chat_messages")
    .select("*", { count: "exact", head: true })
    .eq("chat_id", chatId);
  if (error) throw error;
  return count ?? 0;
}

export type MessagePayload = Array<{
  role: string;
  summary: string;
  verbatim: string | null;
}>;

type ChatCreateHeader = {
  workspace_id: string;
  owner_id: string;
  folder_id: string | null;
  client_session_id: string | null;
  visibility?: string;
  access_mode?: string;
  title: string;
  overview?: string;
  source?: string;
  project?: string | null;
  format: string;
  session_date?: string;
  deliverables?: unknown;
  learnings?: unknown;
  exported_at?: string;
};

/**
 * Atomic export create (F-12): header INSERT + messages INSERT in ONE
 * Postgres transaction (chat_create_with_messages). A failed transcript
 * write rolls the header back, so a broken export never leaves a
 * 0-message orphan. Re-export (the row already exists) uses
 * `mergeMessages` instead.
 */
export async function createChatWithMessages(
  header: ChatCreateHeader,
  messages: MessagePayload
): Promise<ChatRow> {
  const db = supabaseAdmin();
  // RPC added by migration 20260718000002; not yet in the generated
  // Database types (regenerated after the migration applies).
  const { data, error } = await db.rpc(
    "chat_create_with_messages" as never,
    { p_chat: header, p_messages: messages } as never
  );
  if (error) throw error;
  return data as unknown as ChatRow;
}

/**
 * Non-destructive re-export merge (F-8): upsert the re-sent messages by
 * position and KEEP any existing rows beyond them, so a transcript
 * extended via op="append" survives a re-export instead of being wiped.
 * A single upsert statement is atomic; the returned length reflects the
 * reconciled transcript (re-sent ∪ preserved).
 */
export async function mergeMessages(
  chatId: string,
  workspaceId: string,
  messages: MessagePayload
): Promise<number> {
  const db = supabaseAdmin();
  const rows = messages.map((m, i) => ({
    chat_id: chatId,
    workspace_id: workspaceId,
    position: i + 1,
    role: m.role,
    summary: m.summary,
    verbatim: m.verbatim,
  }));
  const { error } = await db
    .from("chat_messages")
    .upsert(rows, { onConflict: "chat_id,position" });
  if (error) throw error;
  return countMessages(chatId);
}

/**
 * Positions are computed inside the transaction (chat_append_messages,
 * FOR UPDATE on the chat row), so concurrent appends serialize instead
 * of racing to a unique violation. Returns the new transcript length.
 */
export async function appendMessagesTx(
  chatId: string,
  workspaceId: string,
  messages: MessagePayload
): Promise<number> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("chat_append_messages", {
    p_chat_id: chatId,
    p_workspace_id: workspaceId,
    p_messages: messages,
  });
  if (error) throw error;
  return data ?? 0;
}

// ─── Folders ────────────────────────────────────────────────────────

export async function listFolders(
  workspaceId: string,
  userId: string
): Promise<ChatFolderRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("chat_folders")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function findFolderById(
  workspaceId: string,
  userId: string,
  folderId: string
): Promise<ChatFolderRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("chat_folders")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("id", folderId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findFolderByName(
  workspaceId: string,
  userId: string,
  name: string
): Promise<ChatFolderRow | null> {
  const db = supabaseAdmin();
  // ilike is a PATTERN match — escape %, _ and \ so a folder named
  // "100%" can't match "100x" (and stray metacharacters can't make
  // maybeSingle() see multiple rows). The ci-unique index on
  // lower(name) guarantees at most one match for the escaped literal.
  const literal = name.replace(/[\\%_]/g, "\\$&");
  const { data, error } = await db
    .from("chat_folders")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .ilike("name", literal)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function insertFolder(
  workspaceId: string,
  userId: string,
  name: string
): Promise<ChatFolderRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("chat_folders")
    .insert({ workspace_id: workspaceId, user_id: userId, name })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

type ChatFolderPatch = Partial<{
  name: string;
  visibility: string;
  access_mode: string;
}>;

export async function updateFolder(
  folderId: string,
  patch: ChatFolderPatch
): Promise<ChatFolderRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("chat_folders")
    .update(patch)
    .eq("id", folderId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Ids of every ACTIVE chat filed in the folder — the propagation target set. */
export async function listChatIdsInFolder(folderId: string): Promise<string[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("chats")
    .select("id")
    .eq("folder_id", folderId)
    .or("deleted_at.is.null");
  if (error) throw error;
  return (data ?? []).map((r) => r.id);
}

/** Folder-scope propagation: align every filed (active) chat's sharing columns. */
export async function updateChatsScopeInFolder(
  folderId: string,
  visibility: string,
  accessMode: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("chats")
    .update({
      visibility,
      access_mode: accessMode,
      updated_at: new Date().toISOString(),
    })
    .eq("folder_id", folderId)
    .or("deleted_at.is.null");
  if (error) throw error;
}

/** Chats in the folder survive — their folder_id FK is ON DELETE SET NULL. */
export async function deleteFolder(folderId: string): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.from("chat_folders").delete().eq("id", folderId);
  if (error) throw error;
}

// ─── Profiles (owner display) ───────────────────────────────────────

export async function fetchProfiles(userIds: string[]): Promise<ProfileRef[]> {
  if (userIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("profiles")
    .select("id, email, display_name, avatar_url")
    .in("id", userIds);
  if (error) throw error;
  return (data ?? []) as ProfileRef[];
}

export function pgErrorCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err) {
    return (err as { code?: string }).code ?? null;
  }
  return null;
}
