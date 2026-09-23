/**
 * **WHO A POST WAS ACTUALLY DELIVERED TO, SPELLED FOR A READER** — the faces the
 * transcript draws beside an agent's attribution pill (Samuel, 2026-09-22,
 * decision #2200 option 1: *"Render the tag from the real address"*).
 *
 * ⚠ **IT READS THE ADDRESS, NEVER THE BODY, AND THAT IS THE WHOLE RULING.** The
 * ask was for a tag that *"can never disagree with actual delivery"*: agents were
 * typing `@orchestrator` into their own prose while the real `to=` set was
 * server-stamped somewhere else, so the two could point at different people in
 * either direction. `channel_messages.recipient_user_ids` /
 * `recipient_agent_ids` are stripped from caller input and re-stamped server-side
 * (`server/service-writes-metadata.ts`), which is what makes them safe to face as
 * "this reached them". Nothing here parses a message body, and nothing may start
 * to: a re-derivation from prose is the disagreement this exists to remove.
 *
 * ⚠ **IT REPLACES THE `→ @agent` LINE THAT WAS DELETED ON 2026-09-20, AND SAMUEL
 * MOVED THAT RULING HIMSELF.** That renderer was removed because the composer had
 * begun writing the tag INTO the draft, so chrome would have shown one fact twice
 * (`routed-tag.test.tsx` carries the argument). The 2026-09-22 decision reverses
 * the direction of the consolidation rather than the principle — ONE surface for
 * the address, and it is now the CHROME, with the tool description telling agents
 * to stop typing recipients (`packages/mcp-server`, same wave). So:
 *   - this draws only on rows an AGENT wrote, where the typed tag is going away;
 *   - a HUMAN's row stays untagged, because their composer still inserts the
 *     handle into the words they send (`composer.tsx › submit`).
 * That gate lives in `view-model-rows.ts › toMessageRow`, stated once.
 *
 * ⚠ **THE FACES ARE RESOLVED AT RENDER AND NEVER STORED ON A ROW** — the rule
 * `attribution-pill.tsx › attributionName` and `agent-mentions.ts ›
 * routedTagLabel` already follow, for the same reason: a display name is
 * machine-local and renamed at will, so a copy frozen at send time would face an
 * old name forever. Rows carry IDS; this turns them into words.
 */

import { agentFaceName } from "@/shared/lib/agent-name";
import { agentIdHandle, agentMentionFace } from "./agent-mentions";
import { mentionHandleOf, mentionSlug } from "./mentions";

/** One delivered-to face. ⚠ Both strings are already WORDS — a component renders
 *  these and resolves nothing, which is what keeps the raw agent id off every
 *  surface (`agent-id-visibility.test.ts`'s sweep covers the components). */
export interface RecipientTag {
  /** An AGENT's session or a PERSON — different namespaces, never merged. */
  kind: "agent" | "person";
  /** The id this face stands for. ⚠ A REACT KEY AND NOTHING ELSE; never rendered. */
  id: string;
  /** What the tag reads: `@handle` when the handle is one a reader could retype,
   *  else the plain NAME with no `@` — see {@link personFace}. */
  face: string;
  /** The address the face replaced, for the hover. Equal to {@link face} when
   *  nothing was replaced, and the caller drops a title that adds nothing. */
  title: string;
}

/** Structural, on `agent-mentions.ts`'s own rule: this module answers a question
 *  ABOUT the identity map without importing `view-model.ts`. */
type AgentIdentities = ReadonlyMap<string, { displayName?: string | null }>;
type MemberIdentities = ReadonlyMap<
  string,
  { displayName?: string | null; email?: string | null }
>;

/** `labelFor`'s own ladder (`view-model.ts`), and its reason: both fields are free
 *  text a profile may carry BLANK, and `""` is not nullish — so `??` alone would
 *  render a tag with no words in it. */
function firstWords(...candidates: (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    const trimmed = (candidate ?? "").trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

/**
 * A PERSON's face: their handle when the roster name slugs to one that survives
 * the token strip, else their name.
 *
 * ⚠ **THE `@` IS A PROMISE AND THE ABSENCE IS THE INFORMATION** — `agentMentionFace`'s
 * rule, applied to the member namespace. `@` says "a handle you could retype";
 * a name that slugs to something `mentionHandleOf` then strips ("Diana Jr.")
 * would render an address that resolves to nobody, so that case shows the name
 * bare instead. ⚠ **ASKED OF THE REAL PARSER, NEVER A PUNCTUATION LIST** — the
 * round trip is what keeps this true the next time that class changes.
 *
 * ⚠ **AMBIGUITY IS NOT THIS FUNCTION'S PROBLEM, UNLIKE THE COMPOSER'S.**
 * `mentions.ts › insertableHandle` fails a contested handle closed because it is
 * choosing text to INSERT, which a resolver then has to read back. This is a
 * REPORT of a delivery that already happened, addressed by user id — so two
 * members sharing a first name changes which words are the nicest to show, never
 * who the post reached.
 */
function personFace(name: string): string {
  const slug = mentionSlug(name);
  return slug.length > 0 && mentionHandleOf(`@${slug}`) === slug ? `@${slug}` : name;
}

/**
 * The `to=` set as faces, agents first, then people, each in the order the server
 * stamped them.
 *
 * ⚠ **AN EMPTY RESULT IS THE ORDINARY CASE AND THE CALLER DRAWS NOTHING.** Three
 * different absences land here and all three mean "no tag": a RECORD, which
 * reached nobody by design (`[]`); a row written before the columns existed
 * (`null`); and a row this tree built rather than read (`undefined`). ⚠ **DO NOT
 * FACE THEM DIFFERENTLY** — `[]` and `null` are distinguishable in the type but
 * not to a reader, and a "record" marker drawn from `[]` would be absent on every
 * legacy row that also reached nobody. Silence is the one honest rendering of all
 * three.
 *
 * ⚠ **IDS ARE DEDUPED, NOT TRUSTED TO BE UNIQUE.** The two arrays are separate
 * namespaces (a user id and an agent id can never collide), but a caller may
 * repeat an id inside one of them, and two identical tags read as two deliveries.
 */
export function recipientTags(
  recipients: {
    agentIds?: readonly string[] | null;
    userIds?: readonly string[] | null;
  },
  agents: AgentIdentities,
  members: MemberIdentities
): RecipientTag[] {
  const out: RecipientTag[] = [];
  const seen = new Set<string>();
  for (const id of recipients.agentIds ?? []) {
    if (id.length === 0 || seen.has(`a:${id}`)) continue;
    seen.add(`a:${id}`);
    // ⚠ THE NAME, NEVER THE MACHINE TOKEN — `routedTagLabel`'s treatment to the
    // letter, so a routed tag, a typed tag and this one face one agent the same
    // way. No retypable handle (never named, a COLLIDING name, or one the slugger
    // cannot spell) means no `@`, and the raw address stays one hover away.
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
    // ⚠ UNKNOWN IS NAMED, NOT DROPPED. `threadParties` drops ids the roster cannot
    // answer for because it is drawing FACES; a recipient dropped here would be a
    // delivery the row silently omits, which is the disagreement in the other
    // direction. `Member` is `labelFor`'s own word for the same gap.
    // ⚠ **AND IT GETS NO `@`, BECAUSE THERE IS NOTHING TO SLUG.** `@member` would
    // read as a handle that resolves to somebody, invented out of the fact that the
    // roster came up empty — the promise {@link personFace} exists to keep.
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
 * THE ADDRESS SET AS ONE COMPARABLE STRING — what `view-model-rows.ts ›
 * isContinuation` breaks a run on.
 *
 * ⚠ **A RUN SHOWS ONE PILL, SO IT MAY ONLY HOLD ONE ADDRESS.** The tag hangs off
 * the attribution pill, and a continuation has no pill — so three posts to three
 * different places would collapse under ONE tag naming the first of them, which
 * is precisely the disagreement this wave was called to remove. Changing the
 * address therefore earns a new header.
 *
 * ⚠ **ABSENT IS ITS OWN VALUE, NOT EMPTY** (`?`), so a legacy run whose rows all
 * carry `null` groups exactly as it did before this existed — the arrays' three
 * readings are kept apart here for the one place it changes behaviour.
 * ⚠ **ORDER-INSENSITIVE**: the same two recipients stamped in either order are
 * one address, and a sort is cheaper than a reader wondering why a run split.
 */
export function addressKey(recipients: {
  agentIds?: readonly string[] | null;
  userIds?: readonly string[] | null;
}): string {
  const part = (ids: readonly string[] | null | undefined): string =>
    ids === null || ids === undefined ? "?" : [...ids].sort().join(",");
  return `${part(recipients.agentIds)}|${part(recipients.userIds)}`;
}
