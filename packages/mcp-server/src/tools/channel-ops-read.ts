/**
 * `dopl_channel` READ op handlers: list (channels), read (messages), await
 * (long-poll for new messages). All non-mutating. Routed from the
 * registrar in channel.ts.
 */

import type { AwaitResult, ChannelMessage, DoplClient } from "@dopl/client";
import { ok, isNotFound, type ToolResponse } from "./respond";
import { channelNotFound } from "./channel-shared";

/**
 * One rendered message line. `task_*` events already carry a
 * human-readable render in `body` (per the data model), so the listing
 * needs no per-kind special-casing — just tag non-chat kinds.
 */
function formatMessage(m: ChannelMessage): string {
  const author =
    m.authorKind === "system"
      ? "system"
      : m.authorUserId
        ? `${m.authorKind} \`${m.authorUserId}\``
        : m.authorKind;
  const kindTag = m.kind !== "message" ? ` · ${m.kind}` : "";
  const head = `**#${m.seq}** ${author}${kindTag} · ${m.createdAt}`;
  const body = m.body ? `\n  ${m.body.replace(/\n/g, "\n  ")}` : "";
  return `- ${head}${body}`;
}

export async function opList(client: DoplClient): Promise<ToolResponse> {
  const channels = await client.listChannels();
  if (channels.length === 0) {
    return ok(
      'No channels yet. Create one with dopl_channel(op="open", name="...").',
    );
  }
  const lines = [`## Channels — ${channels.length}\n`];
  for (const c of channels) {
    const bits = [`id: \`${c.id}\``, c.visibility];
    if (c.memberCount !== undefined) {
      bits.push(`${c.memberCount} member${c.memberCount === 1 ? "" : "s"}`);
    }
    if (c.lastMessageAt) bits.push(`last activity ${c.lastMessageAt}`);
    const topic = c.topic ? ` — ${c.topic}` : "";
    lines.push(`- **${c.name}** (slug: \`${c.slug}\` · ${bits.join(" · ")})${topic}`);
  }
  lines.push(
    '\nRead a channel with dopl_channel(op="read", channel=<slug|id>); post with op="post"; watch for new messages with op="await".',
  );
  return ok(lines.join("\n"));
}

export async function opRead(
  client: DoplClient,
  ref: string,
  since?: number,
  limit?: number,
): Promise<ToolResponse> {
  // Hot path — no pre-resolve. The route accepts slug-or-id in the
  // [channelId] segment and enforces visibility itself, so we hand it the
  // caller's ref directly and skip a per-call listChannels() round-trip. A
  // route 404 (unknown ref, or one the caller can't see) maps to a clean
  // not-found; the ref stands in for the channel name in the output.
  let messages: ChannelMessage[];
  try {
    messages = await client.readChannelMessages(ref, { since, limit });
  } catch (e) {
    if (isNotFound(e)) return channelNotFound(ref);
    throw e;
  }
  if (messages.length === 0) {
    const sinceNote = since !== undefined ? ` after seq ${since}` : "";
    return ok(
      `No messages in **${ref}**${sinceNote}. Watch for new ones with dopl_channel(op="await", channel="${ref}", since=${since ?? 0}).`,
    );
  }
  const lines = [
    `## ${ref} — ${messages.length} message${messages.length === 1 ? "" : "s"}\n`,
  ];
  for (const m of messages) lines.push(formatMessage(m));
  const lastSeq = messages[messages.length - 1].seq;
  lines.push(
    `\nHighest seq shown: ${lastSeq}. Watch for newer messages with dopl_channel(op="await", channel="${ref}", since=${lastSeq}).`,
  );
  return ok(lines.join("\n"));
}

export async function opAwait(
  client: DoplClient,
  ref: string,
  since: number,
  timeoutMs?: number,
): Promise<ToolResponse> {
  // Hot path — same rationale as opRead, and this one runs inside the
  // listener's poll loop, so the saved round-trip compounds per cycle. Pass
  // the ref straight through; map a route 404 to a clean not-found.
  let result: AwaitResult;
  try {
    result = await client.awaitChannelMessages(ref, { since, timeoutMs });
  } catch (e) {
    if (isNotFound(e)) return channelNotFound(ref);
    throw e;
  }
  if (result.messages.length === 0) {
    return ok(
      `No new messages in **${ref}** since seq ${since} (the poll timed out). Re-call dopl_channel(op="await", channel="${ref}", since=${since}) to keep watching.`,
    );
  }
  const lines = [
    `## ${ref} — ${result.messages.length} new message${result.messages.length === 1 ? "" : "s"} since seq ${since}\n`,
  ];
  for (const m of result.messages) lines.push(formatMessage(m));
  const lastSeq = result.messages[result.messages.length - 1].seq;
  lines.push(
    `\nAdvance your cursor to seq ${lastSeq}, then re-call dopl_channel(op="await", channel="${ref}", since=${lastSeq}) to keep watching.`,
  );
  return ok(lines.join("\n"));
}
