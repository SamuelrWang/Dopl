/**
 * **THE TAG ROW AT THE TOP OF A MESSAGE** (Samuel, 2026-10-08, the reversal of the pill removal):
 * everyone the message NAMES, drawn from what the SERVER resolved, never from a client re-parse.
 *  - People: `metadata.mentionedUserIds` — the body's resolved @-tags plus members it addresses
 *    (an agent must also tag them inline, `service-writes-metadata-mentions.ts`).
 *  - Agents: `recipient_agent_ids` — `to=` agents and the body's resolved agent tags — except
 *    when the server PICKED the agent for an unaddressed post (`wake_reason`): it was not named.
 * One rule for every message, human or agent. A typed `@word` that resolved to nobody has no id,
 * so it can never be pilled. Order follows the body: a face's first `@handle` occurrence, with
 * names the text does not spell (a `to=`-only agent) after, in server order.
 * Faces resolve at render, never stored on a row.
 */

import { agentFaceName } from "@/shared/lib/agent-name";
import { agentIdHandle, agentMentionFace } from "./agent-mentions";
import { mentionHandleOf, mentionSlug } from "./mentions";

/** One delivered-to face. Both strings are already words; the raw agent id is never rendered. */
export interface RecipientTag {
  kind: "agent" | "person";
  /** A React key only; never rendered. */
  id: string;
  /** `@handle` when a reader could retype it, else the plain name. */
  face: string;
  /** The address the face replaced, for the hover. */
  title: string;
}

type AgentRosterMap = ReadonlyMap<string, { displayName?: string | null }>;
type MemberIdentities = ReadonlyMap<
  string,
  { displayName?: string | null; email?: string | null }
>;

/** First non-blank value: profile fields may be `""`, which `??` would pass through. */
function firstWords(...candidates: (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    const trimmed = (candidate ?? "").trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

/**
 * A person's face: `@slug` only when the real parser round-trips it (`@` promises a retypable
 * handle), else the bare name.
 */
function personFace(name: string): string {
  const slug = mentionSlug(name);
  return slug.length > 0 && mentionHandleOf(`@${slug}`) === slug ? `@${slug}` : name;
}

/**
 * The `to=` set as faces, agents first, then people, in stamped order, ids deduped. `[]`, `null`
 * and `undefined` all mean no tag.
 */
export function recipientTags(
  recipients: {
    agentIds?: readonly string[] | null;
    userIds?: readonly string[] | null;
  },
  agents: AgentRosterMap,
  members: MemberIdentities
): RecipientTag[] {
  const out: RecipientTag[] = [];
  const seen = new Set<string>();
  for (const id of recipients.agentIds ?? []) {
    if (id.length === 0 || seen.has(`a:${id}`)) continue;
    seen.add(`a:${id}`);
    // 🔒 Samuel, 2026-09-15: the name, never the machine token; no retypable handle, no `@`.
    const handle = agentMentionFace(id, agents);
    out.push({
      kind: "agent",
      id,
      face: handle !== null ? `@${handle}` : agentFaceName(agents.get(id)?.displayName),
      title: `@${agentIdHandle(id)}`,
    });
  }
  for (const id of recipients.userIds ?? []) {
    if (id.length === 0 || seen.has(`u:${id}`)) continue;
    seen.add(`u:${id}`);
    // An unknown user is named "Member" (no `@`), never dropped: a dropped face hides a delivery.
    const name = firstWords(members.get(id)?.displayName, members.get(id)?.email);
    out.push(
      name === null
        ? { kind: "person", id, face: "Member", title: "Member" }
        : { kind: "person", id, face: personFace(name), title: name }
    );
  }
  return out;
}

/**
 * The address set as one comparable string; `view-model-rows.ts › isContinuation` breaks a run on
 * it, since a run shows one pill. Order-insensitive and deduped; absent (`?`) stays distinct from
 * `[]` so legacy rows group unchanged.
 */
export function addressKey(recipients: {
  agentIds?: readonly string[] | null;
  userIds?: readonly string[] | null;
}): string {
  const part = (ids: readonly string[] | null | undefined): string =>
    ids === null || ids === undefined ? "?" : [...new Set(ids)].sort().join(",");
  return `${part(recipients.agentIds)}|${part(recipients.userIds)}`;
}

/** Where `face` (an `@handle`) first appears in `body`, case-insensitively; Infinity if nowhere. */
function bodyPosition(body: string, face: string): number {
  if (!face.startsWith("@")) return Infinity;
  const at = body.toLowerCase().indexOf(face.toLowerCase());
  return at === -1 ? Infinity : at;
}

/**
 * The tag row for one message: people the server stamped as named, agents it resolved, deduped,
 * in body order. Empty draws nothing.
 */
export function messageTags(
  message: {
    body: string;
    tagUserIds?: readonly string[] | null;
    tagAgentIds?: readonly string[] | null;
  },
  agents: AgentRosterMap,
  members: MemberIdentities
): RecipientTag[] {
  const tags = recipientTags(
    { agentIds: message.tagAgentIds, userIds: message.tagUserIds },
    agents,
    members
  );
  return tags
    .map((tag, order) => ({ tag, order, at: bodyPosition(message.body, tag.face) }))
    .sort((a, b) => (a.at === b.at ? a.order - b.order : a.at - b.at))
    .map((x) => x.tag);
}
