import type {
  AgentTrustRule,
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
export const PENDING_ID_PREFIX = "pending:";

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
export interface TrustCache {
  rules: AgentTrustRule[];
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
  /** `taskId` binds the row into a session card; `to_user_id` renders the
   *  addressee line. ⚠ Wire spellings, as the transcript reads them. */
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
 * The thread row that makes a pending session card read as ACTIVE.
 * ⚠ Without it the card derives from messages alone, and a lone human message
 * with no agent reply and no lifecycle marker computes to "done" — a request
 * would read "Thread complete" the instant it was sent.
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

export function dropThread(
  cache: ThreadsCache | undefined,
  threadId: string
): ThreadsCache | undefined {
  if (!cache) return cache;
  return { ...cache, tasks: cache.tasks.filter((t) => t.id !== threadId) };
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
 * Trust renders from the RULE LIST, so the optimistic add needs a ROW, not a
 * flag. Only `trustedUserId` is read by the view's lens; the rest is filled so
 * the row is a valid `AgentTrustRule` needing no special case.
 */
export function addTrustRuleRow(
  cache: TrustCache | undefined,
  input: { trustedUserId: string; operatorUserId: string; workspaceId: string }
): TrustCache | undefined {
  if (!cache) return cache;
  if (cache.rules.some((r) => r.trustedUserId === input.trustedUserId)) {
    return cache;
  }
  return {
    ...cache,
    rules: [
      ...cache.rules,
      {
        id: pendingMessageId(input.trustedUserId),
        operatorUserId: input.operatorUserId,
        trustedUserId: input.trustedUserId,
        workspaceId: input.workspaceId,
        createdAt: new Date().toISOString(),
        trustedName: null,
        trustedEmail: null,
        trustedAvatarUrl: null,
      },
    ],
  };
}

export function removeTrustRuleRow(
  cache: TrustCache | undefined,
  trustedUserId: string
): TrustCache | undefined {
  if (!cache) return cache;
  return {
    ...cache,
    rules: cache.rules.filter((r) => r.trustedUserId !== trustedUserId),
  };
}

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
