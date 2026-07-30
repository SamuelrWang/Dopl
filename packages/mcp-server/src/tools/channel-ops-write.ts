/**
 * `dopl_channel` WRITE op handlers: open (create a channel or direct message),
 * invite (add a workspace member), post (send a message or activity event),
 * and the first-class thread ops (create_thread / close_thread /
 * set_thread_mode). Maps @dopl/client 4xx collisions to actionable messages.
 * Routed from the registrar in channel.ts.
 *
 * BOUNDARY: the wire/storage name `task` == the domain name `thread`. The
 * `thread` op param folds into `metadata.taskId` and the `task_*` message
 * kinds keep their stored names; only the agent-facing surface says `thread`.
 */

import type {
  ChannelMessageInput,
  ChannelVisibility,
  DoplClient,
  ThreadMode,
  ThreadOutcome,
} from "@dopl/client";
import { ok, err, isAlreadyExists, isNotFound, type ToolResponse } from "./respond";
import { isErr, resolveChannelOr, resolveMemberOr } from "./channel-shared";

/** Duck-typed HTTP 400 from the Dopl API (across the @dopl/client boundary). */
function isBadRequest(e: unknown): boolean {
  return (
    typeof e === "object" && e !== null && (e as { status?: number }).status === 400
  );
}

/** Duck-typed HTTP 403 from the Dopl API (thread authorization refusals). */
function isForbidden(e: unknown): boolean {
  return (
    typeof e === "object" && e !== null && (e as { status?: number }).status === 403
  );
}

/** Options accepted by opPost — the per-post flags routed from the registrar. */
interface PostOptions {
  kind?: ChannelMessageInput["kind"];
  metadata?: Record<string, unknown>;
  clientMsgId?: string;
  /** Address the post to one member (email or user id, resolved like invite). */
  to?: string;
  /** One-line intent for the receiver's notification. */
  summary?: string;
  /** A thread id — threads this post under that thread's card (server-validated). */
  thread?: string;
}

/** Options for opOpen — a normal channel, or a `direct` message with `member`. */
interface OpenOptions {
  direct?: boolean;
  member?: string;
  name?: string;
  topic?: string;
  visibility?: ChannelVisibility;
}

export async function opOpen(
  client: DoplClient,
  opts: OpenOptions,
): Promise<ToolResponse> {
  // Direct branch: open (or dedup-return) a 1:1 channel with `member`. The
  // server dedups a repeat DM to the same peer, so this is idempotent.
  if (opts.direct) {
    const member = await resolveMemberOr(client, opts.member as string);
    if (isErr(member)) return member;
    const channel = await client.createChannel({
      direct: true,
      memberUserId: member.userId,
    });
    return ok(
      [
        `Opened a direct message with ${member.label} (id: \`${channel.id}\` · slug: \`${channel.slug}\`).`,
        `Post with dopl_channel(op="post", channel="${channel.id}", body="...").`,
      ].join("\n"),
    );
  }

  const name = opts.name as string;
  let channel;
  try {
    channel = await client.createChannel({
      name,
      topic: opts.topic,
      visibility: opts.visibility,
    });
  } catch (e) {
    if (isAlreadyExists(e)) {
      // NOT a duplicate-name collision: duplicate names auto-dedupe via slug
      // suffixing. A 409 here is a transient same-derived-slug insert race
      // between two concurrent opens — nothing was created, and a retry
      // (which derives the next free slug) succeeds.
      return err(
        `Hit a transient naming conflict creating "${name}" (a rare concurrent-open race on the derived slug). Nothing was created — just retry the same open and it should succeed.`,
      );
    }
    throw e;
  }
  const visNote =
    channel.visibility === "private"
      ? "Private — only invited members can see it."
      : "Public — visible to the whole workspace.";
  return ok(
    [
      `Created channel **${channel.name}** (slug: \`${channel.slug}\` · id: \`${channel.id}\`). ${visNote}`,
      `Post with dopl_channel(op="post", channel="${channel.slug}", body="..."); add members with op="invite".`,
    ].join("\n"),
  );
}

export async function opInvite(
  client: DoplClient,
  channelRef: string,
  memberRef: string,
): Promise<ToolResponse> {
  const ch = await resolveChannelOr(client, channelRef);
  if (isErr(ch)) return ch;
  const member = await resolveMemberOr(client, memberRef);
  if (isErr(member)) return member;
  let added;
  try {
    added = await client.inviteToChannel(ch.id, member.userId);
  } catch (e) {
    if (isAlreadyExists(e)) {
      return err(`${member.label} is already a member of **${ch.name}**.`);
    }
    throw e;
  }
  return ok(`Added ${member.label} to **${ch.name}** as ${added.role}.`);
}

export async function opPost(
  client: DoplClient,
  channelRef: string,
  body: string,
  opts: PostOptions = {},
): Promise<ToolResponse> {
  const ch = await resolveChannelOr(client, channelRef);
  if (isErr(ch)) return ch;

  // Resolve the addressee reference (email or user id) like invite does —
  // to a workspace member. The route then enforces channel membership.
  let toUserId: string | undefined;
  let toLabel: string | undefined;
  if (opts.to) {
    const member = await resolveMemberOr(client, opts.to);
    if (isErr(member)) return member;
    toUserId = member.userId;
    toLabel = member.label;
  }

  // Thread the post under a thread when `thread` is passed: fold the id into
  // the STORAGE key `metadata.taskId` (the explicit param wins over any
  // metadata copy). The route then server-validates it resolves to a thread
  // in this channel.
  const metadata = opts.thread
    ? { ...(opts.metadata ?? {}), taskId: opts.thread }
    : opts.metadata;

  let message;
  try {
    message = await client.postChannelMessage(ch.id, {
      body,
      kind: opts.kind,
      metadata,
      clientMsgId: opts.clientMsgId,
      toUserId,
      summary: opts.summary,
    });
  } catch (e) {
    // Map the route's 400s to actionable messages. Two independent causes:
    // a non-member addressee (only when `to` is set) and an unresolvable
    // first-class `thread` id (CHANNEL_TASK_NOT_IN_CHANNEL) — the latter fires
    // even with NO `to`, so catch isBadRequest regardless of `to` instead of
    // rethrowing the raw 400 uncaught (the bug this closes).
    if (isBadRequest(e)) {
      if (toUserId) {
        return err(
          `Couldn't address the message to ${toLabel} — they aren't a member of **${ch.name}**. Invite them first (op="invite"), or post without \`to\`.`,
        );
      }
      if (opts.thread) {
        return err(
          `That thread is not in this channel — check the thread id, or post without \`thread\`.`,
        );
      }
    }
    // v3.1 B3: the route now 403s a post into a thread the caller is not a party
    // to (only its creator or its target may write into one). Without this the
    // agent sees a raw error string and cannot tell it from a transport failure.
    if (isForbidden(e) && opts.thread) {
      return err(
        `That thread belongs to two other members, so you can't post into it. Post without \`thread\`, or open your own with op="create_thread".`,
      );
    }
    throw e;
  }

  const kindNote = message.kind !== "message" ? `, kind ${message.kind}` : "";
  const toNote = toLabel ? `, addressed to ${toLabel}` : "";
  return ok(
    `Posted to **${ch.name}** (message \`${message.id}\`, seq ${message.seq}${kindNote}${toNote}). Readers watching with op="await" will pick it up.`,
  );
}

// ─── Threads ────────────────────────────────────────────────────────

export async function opCreateThread(
  client: DoplClient,
  channelRef: string,
  title: string,
  body: string,
  to: string,
  mode?: ThreadMode,
  clientMsgId?: string,
): Promise<ToolResponse> {
  const ch = await resolveChannelOr(client, channelRef);
  if (isErr(ch)) return ch;
  const member = await resolveMemberOr(client, to);
  if (isErr(member)) return member;

  let thread;
  try {
    thread = await client.createChannelThread(ch.id, {
      title,
      body,
      toUserId: member.userId,
      mode,
      clientMsgId,
    });
  } catch (e) {
    // The route rejects an addressee who isn't a channel member (400).
    if (isBadRequest(e)) {
      return err(
        `Couldn't address the thread to ${member.label} — they aren't a member of **${ch.name}**. Invite them first (op="invite"), then open the thread.`,
      );
    }
    throw e;
  }
  return ok(
    `Opened thread **${thread.title}** in **${ch.name}** (thread \`${thread.id}\`, ${thread.mode} mode), addressed to ${member.label}. Watch for replies with dopl_channel(op="await", channel="${ch.id}", since=<last seq>).`,
  );
}

export async function opCloseThread(
  client: DoplClient,
  channelRef: string,
  threadId: string,
  outcome: ThreadOutcome,
  summary?: string,
): Promise<ToolResponse> {
  const ch = await resolveChannelOr(client, channelRef);
  if (isErr(ch)) return ch;
  let thread;
  try {
    thread = await client.closeChannelThread(ch.id, threadId, { outcome, summary });
  } catch (e) {
    if (isNotFound(e)) {
      return err(`No thread \`${threadId}\` in **${ch.name}**.`);
    }
    if (isForbidden(e)) {
      return err(
        `You can't close thread \`${threadId}\` — only its creator or the member it's addressed to may close it.`,
      );
    }
    throw e;
  }
  const summaryNote = summary?.trim() ? ` — ${summary.trim()}` : "";
  return ok(
    `Closed thread **${thread.title}** in **${ch.name}** as ${thread.outcome}${summaryNote}.`,
  );
}

export async function opSetThreadMode(
  client: DoplClient,
  channelRef: string,
  threadId: string,
  mode: ThreadMode,
): Promise<ToolResponse> {
  const ch = await resolveChannelOr(client, channelRef);
  if (isErr(ch)) return ch;
  let thread;
  try {
    thread = await client.setChannelThreadMode(ch.id, threadId, { mode });
  } catch (e) {
    if (isNotFound(e)) {
      return err(`No thread \`${threadId}\` in **${ch.name}**.`);
    }
    if (isForbidden(e)) {
      return err(
        `You can't change the mode of thread \`${threadId}\` — only its creator can.`,
      );
    }
    throw e;
  }
  return ok(
    `Set thread **${thread.title}** in **${ch.name}** to ${thread.mode} mode.`,
  );
}
