/** The channel tools' text (`granular-text.ts › ToolText`). */

import { z } from "zod";

import type { ToolText } from "./granular-text.js";

/** The channel PATCH/POST routes' `topic` cap (`src/features/channels/schema.ts › ChannelTopicSchema`). */
export const CHANNEL_DESCRIPTION_MAX_CHARS = 2000;

/** Carried past the legacy schema, whose `summary` caps at a notification's 200. */
const channelDescription = z.string().trim().max(CHANNEL_DESCRIPTION_MAX_CHARS);

/** A decision is its own tool: the named refusal points there, and nothing is sent. */
const sendKind = z.enum(["message", "milestone", "record"], {
  error: (issue) =>
    issue.input === "decision"
      ? 'Refused: kind="decision" is dopl_request_decision, which carries the options; nothing was sent.'
      : undefined,
});

const AGENT_NAME = 'Display name in Title Case ("Picker Fix" → @picker-fix), one line, max 60.';

export const CHANNEL_TEXT: Readonly<Record<string, ToolText>> = {
  dopl_list_channels: {
    description:
      "Channels you are in within one container, with slugs and ids. Start here before reading or posting; dopl_get_status covers every container at once.",
  },
  dopl_get_channel: {
    description:
      'One channel\'s facts: action="status" your live agents in it (omit `channel` for every channel), "members" its roster, "threads" its threads.',
    params: { channel: 'Channel slug or id; required except for action="status".' },
  },
  dopl_read_channel: {
    description:
      "A channel's transcript, newest page first or only messages after `since`; omit `channel` to read every channel. With `wait_ms` it HOLDS until a message arrives: wait that way, never poll on a timer.",
    params: {
      thread: "Only this thread: its header plus that exchange.",
      since: "Last message seq you processed; only newer ones return. Required with wait_ms or without channel.",
      limit: "Max messages; without since, the newest page.",
      wait_ms: "Hold up to this long for a message after since.",
    },
    fenced: true,
  },
  dopl_send_message: {
    description:
      'Post to a channel for members, their agents or `@agent-<id>`; kind="milestone" marks a step on a thread, "record" addresses nobody. A question a person must answer is dopl_request_decision.',
    params: {
      to: "Recipients: member email or id, `@agent-<id>` or a handle, comma-separated. None on a record.",
      body: "Message text. Recipients render from `to`: never write a routing header.",
      kind: '"message" (default), "milestone" (needs thread) or "record".',
      thread: 'Thread id, or "new" to open one titled by summary (needs to).',
      summary: "One-line intent: the notification recipients see.",
    },
    required: ["channel", "body"],
    types: { kind: sendKind },
  },
  dopl_request_decision: {
    description:
      "Post a decision card a person answers in one press: `summary` is the question, `body` the context, `options` the choices. @-tag the person in the body; it starts nobody's agent.",
    params: {
      body: "Context for the decision.",
      summary: "The question the card asks.",
      options: "2-6 choices, each with its consequence.",
      recommendation: "The option you would take (0-based index into options) and why.",
      thread: "Thread to post the card on.",
    },
    required: ["channel", "body", "summary", "options"],
  },
  dopl_create_channel: {
    description:
      "Open a channel: a named room (`name`) or a direct 1:1 (`to`), never both. Private, invite-only, unless public. A room outside any workspace is dopl_create_workspace.",
    params: {
      name: "Name of a named room.",
      description: "What the room is for.",
      visibility: '"private" (default) or "public" to every workspace member.',
      to: "Member to open a 1:1 with.",
    },
    types: { description: channelDescription },
  },
  dopl_update_channel: {
    description:
      'action="update": rename, describe or replace the info card; with none of them it READS the card. action="thread_mode": set a thread interactive or autonomous. Rename and describe need manager rights.',
    params: {
      name: "New channel name.",
      description: 'New description; "" clears it.',
      info_card: "The whole card, replacing the current one: an omitted row is deleted, {} clears it.",
      thread: 'action="thread_mode": the thread.',
      mode: 'action="thread_mode": the mode.',
    },
    required: ["channel"],
    types: { description: channelDescription },
  },
  dopl_invite_to_channel: {
    description: "Invite a member into a channel. Inviting someone already in changes nothing.",
    params: { to: "Member email or user id." },
    required: ["channel", "to"],
  },
  dopl_launch_agent: {
    description:
      "Launch one of YOUR agents in a channel, blank or from an agent identity. Your operator's desktop starts it; posture is a request their machine only narrows.",
    params: {
      name: AGENT_NAME,
      thread: "Thread the agent works in.",
      body: "Opening instruction, max 2,000 chars.",
      model: "Model id; omitted, the identity's, else the default.",
      runtime: "Runtime, e.g. claude or codex; omitted, the channel's. Refused, never swapped, if unavailable.",
      identity: "Identity id, or a name in this channel's container; omitted, a blank agent.",
      color: "Colour marker; omitted, the first free one.",
      posture: "Freedom to ask for; omit an axis to run at the operator's setting.",
    },
    required: ["channel", "name"],
  },
  dopl_manage_session: {
    description:
      'One of YOUR running agents in a channel: action="direct" a private message, "rename", "posture" re-ask its freedom, "end" stop it.',
    params: {
      to: "Your agent: `@agent-<id>`, never a handle.",
      name: `action="rename": ${AGENT_NAME} "" clears it.`,
      posture: 'action="posture": tools and/or messages freedom to ask for.',
      body: 'action="direct": the private message.',
    },
    required: ["channel", "to"],
  },
  dopl_manage_artifact: {
    description:
      'Fold a run of channel messages into one card (action="create"), add or remove one message, or dissolve it. Nothing is edited or deleted; dissolve restores the messages.',
    params: {
      artifact: "Artifact id from create; required except on create.",
      messages: "Message seqs: the whole run on create, exactly one on add or remove.",
      name: "create: the card's name.",
      summary: "create: what the run was about.",
    },
    required: ["channel"],
  },
};
