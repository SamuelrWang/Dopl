/**
 * `dopl_channel` WRITE op handlers: open (create a channel), invite (add a
 * workspace member), post (send a message or task-activity event). Maps
 * @dopl/client already-exists (409) collisions to actionable messages.
 * Routed from the registrar in channel.ts.
 */

import type { ChannelMessageInput, ChannelVisibility, DoplClient } from "@dopl/client";
import { ok, err, isAlreadyExists, type ToolResponse } from "./respond";
import { isErr, resolveChannelOr, resolveMemberOr } from "./channel-shared";

export async function opOpen(
  client: DoplClient,
  name: string,
  topic?: string,
  visibility?: ChannelVisibility,
): Promise<ToolResponse> {
  let channel;
  try {
    channel = await client.createChannel({ name, topic, visibility });
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
  kind?: ChannelMessageInput["kind"],
  metadata?: Record<string, unknown>,
  clientMsgId?: string,
): Promise<ToolResponse> {
  const ch = await resolveChannelOr(client, channelRef);
  if (isErr(ch)) return ch;
  const message = await client.postChannelMessage(ch.id, {
    body,
    kind,
    metadata,
    clientMsgId,
  });
  const kindNote = message.kind !== "message" ? `, kind ${message.kind}` : "";
  return ok(
    `Posted to **${ch.name}** (message \`${message.id}\`, seq ${message.seq}${kindNote}). Readers watching with op="await" will pick it up.`,
  );
}
