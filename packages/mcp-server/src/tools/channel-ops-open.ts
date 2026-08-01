/**
 * `dopl_channel` ROOM-LIFECYCLE op handlers: open (create a channel, or open a
 * direct 1:1 message) and invite (add a workspace member to one).
 *
 * Split out of `channel-ops-write.ts` at the §2 500-line cap when SHOULD-FIX-6's
 * result-line extraction alone left that file at 503. The seam is the one its
 * own header had been describing for three waves without acting on: these two
 * ops make a ROOM and decide WHO IS IN IT, `post` decides what is said in it.
 * They share no state, no error mapping and no narration beyond `NO_NAME` — and
 * `post` is where every behaviour round lands, while these two have not changed
 * in shape since v1.1. `channel-ops-agents.ts` drew the same line for the AGENT
 * roster; this is the human half of it.
 *
 * The `channel-` filename prefix is required by the parity split-scan
 * (parity.test.ts).
 *
 * PEER-CONTROLLED TEXT (Q1, write side). Every string below is server NARRATION
 * — no untrusted-content framing, read by the model as the tool speaking — and
 * two peer-authored values reach it:
 *
 *   - `ch.name` / `channel.name`. `resolveChannelOr` lists channels including
 *     PUBLIC ones the caller was never invited to, so the name can come from
 *     someone the agent has had no contact with. Neutralized at every site.
 *   - `member.label` — `profiles.display_name`. Render-safe by the time it
 *     arrives: `resolveMemberOr` neutralizes at the source, so the label is
 *     spliced directly and must NOT be neutralized twice.
 */

import type { ChannelVisibility, DoplClient } from "@dopl/client";
import { ok, err, isAlreadyExists, type ToolResponse } from "./respond";
import {
  inlineOr,
  isErr,
  resolveChannelOr,
  resolveMemberOr,
} from "./channel-shared";

/** Fallback for peer text that neutralized to nothing — never an empty span. */
const NO_NAME = "(unnamed)";

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
      // The caller's own name, one argument old — neutralized on the same flat
      // rule as everything else rather than on a per-site judgement about who
      // could have authored it. Judging per site is what left close_thread raw.
      `Created channel **${inlineOr(channel.name, NO_NAME)}** (slug: \`${channel.slug}\` · id: \`${channel.id}\`). ${visNote}`,
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
  const chName = inlineOr(ch.name, NO_NAME);
  const member = await resolveMemberOr(client, memberRef);
  if (isErr(member)) return member;
  let added;
  try {
    added = await client.inviteToChannel(ch.id, member.userId);
  } catch (e) {
    if (isAlreadyExists(e)) {
      return err(`${member.label} is already a member of **${chName}**.`);
    }
    throw e;
  }
  return ok(`Added ${member.label} to **${chName}** as ${added.role}.`);
}
