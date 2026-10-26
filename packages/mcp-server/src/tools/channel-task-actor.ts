/**
 * Who a task names: `to=` parsed into the route's actor refs, and an actor rendered back as the
 * handle `to=` takes, so a task result always hands a value the next call can pass.
 */

import { callRef } from "../call-ref.js";
import type { ChannelMember, DoplClient, TaskActor, TaskActorRef } from "@dopl/client";
import { bareAgentId, isAgentId } from "./channel-agent-id";
import { isErr, memberNames } from "./channel-shared";
import { nameSlug, type MemberView } from "./channel-render-identity";
import { inlineOr, UUID_RE } from "./narration";
import { err, type ToolResponse } from "./respond";

const PLAIN_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** `src/features/channels/constants.ts › CHANNEL_TASK_ASSIGNEE_MAX`. */
const TASK_ASSIGNEE_MAX = 20;

const UNCHANGED = "Nothing was changed — field=to";

function unresolved(raw: string, channel: string): ToolResponse {
  return err(
    [
      `${UNCHANGED} reason=unresolved value=${inlineOr(raw, "`(empty)`")}`,
      `A member is \`@<handle>\`, an email or a user id from ${callRef("channel.rooms.members", { channel: `"${channel}"` })}; an agent is \`@agent-<id>\` from ${callRef("channel.status", { channel: `"${channel}"` })}.`,
    ].join("\n"),
  );
}

/** One `to=` token. A bare eight-character id is an agent; with `@` it is a member's handle first. */
async function resolveOne(
  token: string,
  roster: () => Promise<ChannelMember[]>,
  channel: string,
): Promise<TaskActorRef | ToolResponse> {
  if (/^@?agent-/i.test(token)) {
    const agentId = bareAgentId(token);
    return isAgentId(agentId) ? { kind: "agent", agentId } : unresolved(token, channel);
  }
  if (UUID_RE.test(token)) return { kind: "person", userId: token };
  if (!token.startsWith("@") && isAgentId(token)) return { kind: "agent", agentId: token };

  const isEmail = token.includes("@") && !token.startsWith("@");
  const wanted = token.replace(/^@/, "").toLowerCase();
  const keyOf = (m: ChannelMember) =>
    isEmail ? (m.email ?? "").toLowerCase() : nameSlug(m.displayName || m.email || "");
  const hits = (await roster()).filter((m) => keyOf(m) === wanted);
  if (hits.length === 1) return { kind: "person", userId: hits[0]!.userId };
  if (hits.length > 1) {
    return err(`${UNCHANGED} reason=ambiguous value=${inlineOr(token, "`(empty)`")}: ${hits.length} members match. Pass that member's user id.`);
  }
  return !isEmail && isAgentId(wanted) ? { kind: "agent", agentId: wanted } : unresolved(token, channel);
}

/** Every comma-separated token of `to`, against the channel's roster, read at most once. */
export async function resolveTaskActors(
  client: DoplClient,
  channelId: string,
  channel: string,
  to: string,
): Promise<TaskActorRef[] | ToolResponse> {
  const tokens = to.split(",").map((t) => t.trim()).filter(Boolean);
  if (tokens.length > TASK_ASSIGNEE_MAX) {
    return err(`${UNCHANGED} reason=too_many count=${tokens.length} max=${TASK_ASSIGNEE_MAX}.`);
  }
  let members: Promise<ChannelMember[]> | null = null;
  const roster = () => (members ??= client.listChannelMembers(channelId));
  const refs: TaskActorRef[] = [];
  for (const token of tokens) {
    const ref = await resolveOne(token, roster, channel);
    if (isErr(ref)) return ref;
    refs.push(ref);
  }
  return refs;
}

/** Exactly one actor, for the actions that name one. */
export async function resolveTaskActor(
  client: DoplClient,
  channelId: string,
  channel: string,
  to: string,
): Promise<TaskActorRef | ToolResponse> {
  const refs = await resolveTaskActors(client, channelId, channel, to);
  if (isErr(refs)) return refs;
  if (refs.length !== 1) {
    return err(`${UNCHANGED} reason=not_one count=${refs.length}: this action names exactly one member or agent.`);
  }
  return refs[0]!;
}

/** The roster view actor handles render through; read only when a person is shown. */
export async function taskMemberView(client: DoplClient, channelId: string, actors: TaskActor[]): Promise<MemberView> {
  const needs = actors.some((a) => a.kind === "person");
  return { selfUserId: null, names: needs ? await memberNames(client, channelId) : new Map() };
}

/** An actor as the handle `to=` takes: `@agent-<id>`, a member's unique plain `@handle`, else their user id. */
export function actorHandle(actor: TaskActor | null, view: MemberView): string {
  if (actor === null) return "-";
  if (actor.kind === "agent") return `@agent-${actor.agentId}`;
  const name = view.names.get(actor.userId);
  if (!name) return actor.userId;
  const slug = nameSlug(name);
  const unique = [...view.names.values()].filter((n) => nameSlug(n) === slug).length === 1;
  return unique && PLAIN_SLUG_RE.test(slug) && !slug.startsWith("agent-") ? `@${slug}` : actor.userId;
}
