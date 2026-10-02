import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { readClient } from "@/shared/supabase/caller-client";
import type { Database } from "@/shared/supabase/types";
import type { ChatFolderRow, ChatMessageRow, ChatRow, ProfileRef } from "./dto";
import { CHAT_LIST_LIMIT } from "../constants";

/**
 * Raw I/O for chats, their transcripts and their folders.
 *
 * 🔒 TWO CLIENTS — which one a function takes IS RLS phase 2 (Wave B B12; phase 1
 * split: `knowledge/server/repository-bases.ts`). `readClient()` = caller's
 * client when `RLS_CALLER_SCOPED_READS` is on, else `supabaseAdmin()`.
 *   * "What may this caller see" reads → `readClient()`; filter is
 *     `chats_member_select` → `dopl_chat_readable()`, equal to
 *     `service-shared.ts › canSeeChat`.
 *   * SYSTEM-question reads (re-export idempotency, post-write transcript length,
 *     folder-propagation targets) keep `supabaseAdmin()`, marked at the call site.
 *   * Uncovered tables (`chat_folders`, `profiles`) keep `supabaseAdmin()`.
 *   * Writes stay on the service role until RLS phase 4.
 */

type ChatUpdate = Database["public"]["Tables"]["chats"]["Update"];

/** Chat row + PostgREST-embedded message count. */
export type ChatRowWithCount = ChatRow & { chat_messages: Array<{ count: number }> };

const CHAT_SELECT = "*, chat_messages(count)";

export function countOf(row: ChatRowWithCount): number {
  return row.chat_messages[0]?.count ?? 0;
}

// ─── Retention window ───────────────────────────────────────────────

/** Free-plan retention cutoff `YYYY-MM-DD`, on the DB clock (not JS date math).
 *  Feed to `.gte`/`.lt` on `session_date`. */
export async function retentionCutoff(windowDays: number): Promise<string> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("chats_retention_cutoff", {
    p_window_days: windowDays,
  });
  if (error) throw error;
  return data as string;
}

// ─── Chats ──────────────────────────────────────────────────────────

/** Own + workspace-public chats. `since` hides (never deletes) older
 *  `session_date` rows; `null` = full history. */
export async function listVisibleChats(
  workspaceId: string,
  userId: string,
  since: string | null = null
): Promise<{ rows: ChatRowWithCount[]; truncated: boolean }> {
  const db = readClient();
  let query = db
    .from("chats")
    .select(CHAT_SELECT)
    .eq("workspace_id", workspaceId)
    // ⚠ Raw `.or()`: `deleted_at` isn't in the generated types. Separate
    // top-level `.or()`s AND-combine.
    .or("deleted_at.is.null")
    .or(`owner_id.eq.${userId},visibility.eq.public`);
  if (since) query = query.gte("session_date", since);
  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .limit(CHAT_LIST_LIMIT);
  if (error) throw error;
  const rows = (data ?? []) as ChatRowWithCount[];
  // ⚠ AT the ceiling = CLIPPED (INVARIANTS §9), measured on RAW rows before
  // the caller's visibility filter.
  return { rows, truncated: rows.length >= CHAT_LIST_LIMIT };
}

/** Head-count of readable chats OUTSIDE the retention window ("N older chats
 *  hidden" upgrade affordance). */
export async function countHiddenChats(
  workspaceId: string,
  userId: string,
  since: string
): Promise<number> {
  const db = readClient();
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
  const db = readClient();
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

// ⚠ No `deleted_at` filter: the (workspace_id, owner_id, client_session_id)
// unique index spans trashed rows, so re-export must find and revive them.
// ⚠ SERVICE ROLE ON PURPOSE — idempotency lookup against that index; caller-
// scoped, it would miss unreadable rows and the next insert would collide.
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

// `deleted_at` isn't in the generated `ChatUpdate` type; widen + cast.
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

/** ⚠ PERMANENT delete — messages cascade via FK, `chat_grants_cleanup` drops
 *  grants. Redundant `workspace_id` predicate blocks cross-workspace deletes. */
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
  const db = readClient();
  const { data, error } = await db
    .from("chat_messages")
    .select("*")
    .eq("chat_id", chatId)
    .order("position", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** ⚠ SERVICE ROLE ON PURPOSE — post-write transcript LENGTH; caller-scoped it
 *  could under-report what was just written. */
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

/** Header + messages in ONE transaction — no 0-message orphan on failure. */
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

/** Re-export merge: upsert by position, KEEP rows beyond (append-extended
 *  transcripts survive). Returns re-sent ∪ preserved length. */
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

/** Positions assigned in-transaction (FOR UPDATE) so concurrent appends
 *  serialize. Returns new transcript length. */
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
  // ⚠ ilike is a PATTERN — escape %, _, \ so maybeSingle() sees ≤1 row
  // (ci-unique index on lower(name)).
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

/** ACTIVE chat ids in the folder — the propagation target set.
 *  ⚠ SERVICE ROLE ON PURPOSE: caller-scoped, unreadable rows would stay at the
 *  old scope — a silent partial re-share. */
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
