import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Database } from "@/shared/supabase/types";
import type { ChatFolderRow, ChatMessageRow, ChatRow, ProfileRef } from "./dto";
import { CHAT_LIST_LIMIT } from "../constants";

type ChatUpdate = Database["public"]["Tables"]["chats"]["Update"];

/** Chat row + PostgREST-embedded message count. */
export type ChatRowWithCount = ChatRow & { chat_messages: Array<{ count: number }> };

const CHAT_SELECT = "*, chat_messages(count)";

export function countOf(row: ChatRowWithCount): number {
  return row.chat_messages[0]?.count ?? 0;
}

// ─── Retention window ───────────────────────────────────────────────

/** Free-plan retention cutoff, `YYYY-MM-DD`, computed on the DB clock so the
 *  window boundary lives in Postgres, not JS date math. Feed to `.gte`/`.lt`
 *  on `session_date`. Migration: `chats_retention_cutoff`. */
export async function retentionCutoff(windowDays: number): Promise<string> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("chats_retention_cutoff", {
    p_window_days: windowDays,
  });
  if (error) throw error;
  return data as string;
}

// ─── Chats ──────────────────────────────────────────────────────────

/** Own chats + workspace-public ones. `since` (retention cutoff) excludes
 *  older `session_date` rows in the query — hidden, never deleted. `null` =
 *  full history. */
export async function listVisibleChats(
  workspaceId: string,
  userId: string,
  since: string | null = null
): Promise<{ rows: ChatRowWithCount[]; truncated: boolean }> {
  const db = supabaseAdmin();
  let query = db
    .from("chats")
    .select(CHAT_SELECT)
    .eq("workspace_id", workspaceId)
    // ⚠ Raw `.or()` string because `deleted_at` is not in the generated
    // column types. A separate top-level `.or()` AND-combines with the
    // owner/public predicate below.
    .or("deleted_at.is.null")
    .or(`owner_id.eq.${userId},visibility.eq.public`);
  if (since) query = query.gte("session_date", since);
  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .limit(CHAT_LIST_LIMIT);
  if (error) throw error;
  const rows = (data ?? []) as ChatRowWithCount[];
  // ⚠ AT the ceiling counts as CLIPPED — at is indistinguishable from over
  // (INVARIANTS §9). And it is measured on the RAW rows, before the caller's
  // visibility filter: a page that filters down to two chats out of two hundred
  // read is still a page that did not reach the end of the archive.
  return { rows, truncated: rows.length >= CHAT_LIST_LIMIT };
}

/** Readable chats OUTSIDE the retention window. Same owner-or-public
 *  predicate as `listVisibleChats`; head-count only. Drives the "N older
 *  chats hidden" upgrade affordance. */
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
    // Trashed chats are neither shown nor counted as retention-hidden.
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
    // Active reads never resolve a trashed chat — it reads as missing.
    .or("deleted_at.is.null")
    .maybeSingle();
  if (error) throw error;
  return data as ChatRowWithCount | null;
}

// ⚠ Deliberately does NOT filter `deleted_at`: the (workspace_id, owner_id,
// client_session_id) unique index spans trashed rows, so a re-export must
// find a soft-deleted match and revive it rather than collide.
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

// `deleted_at` is not in the generated `ChatUpdate` type, so revive writes
// widen the patch here and cast on the way to Supabase.
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
 * ⚠ PERMANENT delete of ONE chat — no trash, no restore. `chat_messages`
 * cascade via FK; `chat_grants_cleanup` trigger drops team grants. The
 * `workspace_id` predicate is redundant with the caller but makes a
 * cross-workspace mutation structurally impossible.
 */
export async function hardDeleteChat(workspaceId: string, chatId: string): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("chats")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", chatId);
  if (error) throw error;
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

/** Header INSERT + messages INSERT in ONE transaction
 *  (chat_create_with_messages): a failed transcript write rolls the header
 *  back, so no 0-message orphan. Re-export uses `mergeMessages` instead. */
export async function createChatWithMessages(
  header: ChatCreateHeader,
  messages: MessagePayload
): Promise<ChatRow> {
  const db = supabaseAdmin();
  // RPC not in the generated Database types — hence the `as never` casts.
  const { data, error } = await db.rpc(
    "chat_create_with_messages" as never,
    { p_chat: header, p_messages: messages } as never
  );
  if (error) throw error;
  return data as unknown as ChatRow;
}

/** Non-destructive re-export merge: upsert re-sent messages by position and
 *  KEEP existing rows beyond them, so an op="append"-extended transcript
 *  survives. Returned length = re-sent ∪ preserved. */
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

/** Positions computed inside the transaction (chat_append_messages, FOR
 *  UPDATE on the chat row), so concurrent appends serialize instead of
 *  racing to a unique violation. Returns new transcript length. */
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
  // ⚠ ilike is a PATTERN match — escape %, _ and \ so "100%" can't match
  // "100x" and stray metacharacters can't make maybeSingle() see multiple
  // rows. ci-unique index on lower(name) → at most one match once escaped.
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
