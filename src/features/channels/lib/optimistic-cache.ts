import type {
  Channel,
  ChannelConsentRequest,
  ChannelMessage,
  ChannelThread,
  AgentToolProfile,
} from "../types";

/**
 * The pure half of the channels optimistic layer: what a not-yet-saved row LOOKS
 * like, and how a cache absorbs one. Split from the hooks so every rule is
 * testable with no React, DOM or network — these are the rules that decide
 * whether a retry duplicates a message.
 *
 * ⚠ THE CACHE SHAPES ARE THE RAW RESPONSE BODIES. `useApiQuery` stores what the
 * endpoint returned and applies `select` on READ, so a patch operates on
 * `{ messages: [...] }` / `{ tasks: [...] }`, never on the selected array.
 */

/** Marks a row that exists only in this client's cache. */
const PENDING_ID_PREFIX = "pending:";

export function pendingMessageId(clientMsgId: string): string {
  return `${PENDING_ID_PREFIX}${clientMsgId}`;
}

/** True for a row the server has not acknowledged yet. */
export function isPendingId(id: string): boolean {
  return id.startsWith(PENDING_ID_PREFIX);
}

/**
 * Idempotency key (`channel_messages.client_msg_id`, unique per channel; same
 * for `channel_tasks`). It is what makes a retry safe: the second POST returns
 * the FIRST one's row, so hammering Send cannot double-post and a rolled-back
 * optimistic row can be resent verbatim.
 */
export function newClientMsgId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID();
  // Non-secure contexts and older runtimes: per-channel uniqueness is all the
  // unique index asks for, and ⚠ this key is never a security boundary.
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface MessagesCache {
  messages: ChannelMessage[];
}
export interface ThreadsCache {
  tasks: ChannelThread[];
}
export interface ChannelsCache {
  channels: Channel[];
}
export interface ConsentCache {
  requests: ChannelConsentRequest[];
}

function nextSeq(messages: ChannelMessage[]): number {
  let max = 0;
  for (const message of messages) {
    if (message.seq > max) max = message.seq;
  }
  return max + 1;
}

export interface PendingMessageInput {
  channelId: string;
  clientMsgId: string;
  body: string;
  authorUserId: string;
  authorName?: string | null;
  authorAvatarUrl?: string | null;
  /** `taskId` binds the row into its THREAD — the transcript's thread card
   *  (`channels-v2/view-model.ts › threadIdOf`); it bound a session card until
   *  wiring plan Phase 5 deleted that. `to_user_id` renders the addressee line.
   *  ⚠ Wire spellings, as the transcript reads them. */
  metadata?: Record<string, unknown>;
  /** Injected in tests; defaults to now. */
  createdAt?: string;
}

/**
 * The row the transcript renders one frame after the click. ⚠ A real
 * {@link ChannelMessage} — same shape, same renderer, NO parallel "draft"
 * concept — carrying a pending id plus the `clientMsgId` the server echoes back,
 * the pair {@link reconcileMessage} matches on.
 */
export function buildPendingMessage(
  cache: MessagesCache | undefined,
  input: PendingMessageInput
): ChannelMessage {
  return {
    id: pendingMessageId(input.clientMsgId),
    seq: nextSeq(cache?.messages ?? []),
    channelId: input.channelId,
    authorUserId: input.authorUserId,
    authorKind: "user",
    kind: "message",
    body: input.body,
    metadata: input.metadata ?? {},
    clientMsgId: input.clientMsgId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    authorName: input.authorName ?? null,
    authorAvatarUrl: input.authorAvatarUrl ?? null,
  };
}

/**
 * Append a pending row, IDEMPOTENTLY — a repeat `clientMsgId` REPLACES the
 * existing row rather than adding a second, so a resend after a rolled-back
 * failure reads as one message on both sides of the wire.
 *
 * ⚠ An undefined cache stays undefined: writing a one-message list into a query
 * that never loaded renders a transcript of exactly that message and then flips
 * when the read lands.
 */
export function appendPendingMessage(
  cache: MessagesCache | undefined,
  message: ChannelMessage
): MessagesCache | undefined {
  if (!cache) return cache;
  const existing = cache.messages.findIndex(
    (m) => m.clientMsgId !== null && m.clientMsgId === message.clientMsgId
  );
  if (existing >= 0) {
    const messages = cache.messages.slice();
    messages[existing] = message;
    return { ...cache, messages };
  }
  return { ...cache, messages: [...cache.messages, message] };
}

/**
 * Fold the POST's own answer in. ⚠ The saved row replaces its pending twin IN
 * PLACE (matched on `clientMsgId`), so the message keeps its position and the
 * transcript does not jump. A saved row with no pending twin is appended once.
 */
export function reconcileMessage(
  cache: MessagesCache | undefined,
  saved: ChannelMessage
): MessagesCache | undefined {
  if (!cache) return cache;
  const key = saved.clientMsgId;
  const index = cache.messages.findIndex(
    (m) => m.id === saved.id || (key !== null && m.clientMsgId === key)
  );
  const messages = cache.messages.slice();
  if (index >= 0) messages[index] = saved;
  else messages.push(saved);
  return { ...cache, messages };
}

/** Re-point a pending row at the thread id the server just minted. */
export function retagPendingMessage(
  cache: MessagesCache | undefined,
  clientMsgId: string,
  metadata: Record<string, unknown>
): MessagesCache | undefined {
  if (!cache) return cache;
  return {
    ...cache,
    messages: cache.messages.map((m) =>
      m.clientMsgId === clientMsgId
        ? { ...m, metadata: { ...m.metadata, ...metadata } }
        : m
    ),
  };
}

/**
 * The pending THREAD row, so a request has a thread to render against the frame
 * it was sent in. It is still the row `use-thread-writes.ts` and
 * `use-thread-writes-fanout.ts` patch in at submit.
 * ⚠ HISTORY, kept because it is why this function exists at all: it was written
 * to make a pending SESSION CARD read as ACTIVE — without the row that card
 * derived from messages alone, and a lone human message with no agent reply and
 * no lifecycle marker computed to "done", so a request read "Thread complete"
 * the instant it was sent. The session card was deleted in wiring plan Phase 5
 * (2026-08-18) and threads no longer have a finished state at all (INVARIANTS
 * §5), so that particular misreading is gone with it.
 */
export function buildPendingThread(input: {
  id: string;
  channelId: string;
  workspaceId: string;
  title: string;
  createdBy: string;
  targetUserId: string;
  createdAt?: string;
}): ChannelThread {
  const now = input.createdAt ?? new Date().toISOString();
  return {
    id: input.id,
    channelId: input.channelId,
    workspaceId: input.workspaceId,
    title: input.title,
    status: "open",
    outcome: null,
    mode: "interactive",
    createdBy: input.createdBy,
    targetUserId: input.targetUserId,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    outcomeSummary: null,
  };
}

export function upsertThread(
  cache: ThreadsCache | undefined,
  thread: ChannelThread,
  replaceId = thread.id
): ThreadsCache | undefined {
  if (!cache) return cache;
  const index = cache.tasks.findIndex((t) => t.id === replaceId);
  const tasks = cache.tasks.slice();
  if (index >= 0) tasks[index] = thread;
  else tasks.push(thread);
  return { ...cache, tasks };
}

/**
 * DROP one thread row from the thread list — the optimistic half of the thread
 * DELETE (Samuel, 2026-08-21).
 *
 * ⚠ IT STOOD HERE, WAS DELETED ON 2026-08-20 FOR HAVING NO CALLER, AND THE
 * DELETION NOTE SAID "none possible: a thread has no delete route". That was true
 * of the tree and false a day later — the route exists now
 * (`DELETE /api/channels/[channelId]/tasks/[taskId]`). ⚠ Still NOT a finished
 * state: a thread has no `closed`, and this removes the row rather than marking
 * it (INVARIANTS §5).
 */
export function dropThread(
  cache: ThreadsCache | undefined,
  threadId: string
): ThreadsCache | undefined {
  if (!cache) return cache;
  return { ...cache, tasks: cache.tasks.filter((t) => t.id !== threadId) };
}

/**
 * DROP every transcript row tagged for one thread — the other half of the same
 * optimistic patch.
 *
 * ⚠ BOTH HALVES OR NEITHER. The thread list and the transcript are separate cache
 * entries, and dropping only the thread leaves its messages rendering in the
 * channel view under a thread card that no longer exists. The server deletes them
 * in the same call (`service-tasks-delete.ts › deleteTask`), so this is the cache
 * saying the same thing.
 *
 * ⚠ THE TAG IS READ FROM THE WIRE KEY `metadata.taskId`, exactly as the server
 * matches it and as `buildPendingMessage` writes it — never from a domain field,
 * because there is not one.
 */
export function dropThreadMessages(
  cache: MessagesCache | undefined,
  threadId: string
): MessagesCache | undefined {
  if (!cache) return cache;
  return {
    ...cache,
    messages: cache.messages.filter((m) => m.metadata?.taskId !== threadId),
  };
}

/** Patch one channel row in the list cache (both archived variants). */
export function patchChannel(
  cache: ChannelsCache | undefined,
  channelId: string,
  patch: Partial<Channel>
): ChannelsCache | undefined {
  if (!cache) return cache;
  return {
    ...cache,
    channels: cache.channels.map((c) =>
      c.id === channelId ? { ...c, ...patch } : c
    ),
  };
}

export function setToolProfile(
  cache: ChannelsCache | undefined,
  channelId: string,
  myAgentToolProfile: AgentToolProfile
): ChannelsCache | undefined {
  return patchChannel(cache, channelId, { myAgentToolProfile });
}

/**
 * The favourite toggle's optimistic patch — a nullable TIMESTAMP, so the
 * un-favourite writes `null` rather than dropping the field.
 *
 * ⚠ The client stamps its own clock for the optimistic frame and the SERVER
 * stamps the stored one; they differ by the round trip and nothing renders the
 * value, only its nullness. If a surface ever orders by it, this is the line
 * that would have to stop inventing a time.
 */
export function setFavorite(
  cache: ChannelsCache | undefined,
  channelId: string,
  favorited: boolean,
  now: string = new Date().toISOString()
): ChannelsCache | undefined {
  return patchChannel(cache, channelId, {
    myFavoritedAt: favorited ? now : null,
  });
}

// ⚠ `TrustCache`, `addTrustRuleRow` AND `removeTrustRuleRow` STOOD HERE AND ARE
// DELETED (Samuel, 2026-08-22). They were the optimistic half of the "Always
// allow" roster — standing consent for an INBOUND ask, which is the decision
// that ruling retired. Their one caller was the `trust` mutation in
// `use-channel-preference-writes.ts`, deleted with them.

/**
 * A decided consent request leaves the inbox at once. The inbox only holds
 * `pending` rows, so dropping it IS the decided state; a failure rolls the whole
 * list back, which puts the card back.
 */
export function dropConsentRequest(
  cache: ConsentCache | undefined,
  id: string
): ConsentCache | undefined {
  if (!cache) return cache;
  return { ...cache, requests: cache.requests.filter((r) => r.id !== id) };
}
