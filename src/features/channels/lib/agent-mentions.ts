/**
 * THE AGENT SIDE OF THE @-MENTION CONVENTION (2026-08-27, Samuel's ruling).
 *
 * ⚠ IT IS A DIFFERENT NAMESPACE FROM THE ROSTER'S, AND THAT IS THE POINT. `lib/mentions.ts`
 * resolves a token to a USER ID against the channel roster, and the server stamps that set into
 * `metadata.mentionedUserIds`. **An agent is not a member**, that resolver correctly answers
 * "nobody", and it must go on doing so — a caller-settable mention set is a notification-forgery
 * primitive. So this module answers a strictly separate question ("does this token name one of MY
 * agents") and the answer decides **tint only**: nothing here grants, addresses, triggers or
 * consents to anything.
 *
 * ⚠ THE ROUTING VERDICT IS MAIN'S AND STAYS MAIN'S. `dopl-desktop-app/main/session-dispatch.js ›
 * mentionedAgentIds` parses the same shapes against the ids actually LIVE on the thread, on the
 * machine that owns them. This module cannot reach that and does not try — it renders a tint over
 * what the local sessions feed already reports. Two readers, one convention, and the convention is
 * written down in both places because neither tree can import the other.
 *
 * ── THE HANDLE, IN FULL ─────────────────────────────────────────────────────
 * An agent answers to TWO handles, in this order:
 *
 *   1. its SLUGGED CUSTOM NAME, when the operator has renamed it (`main/agent-names.js`) —
 *      "Research Bot" → `@research-bot`;
 *   2. `agent-<id>` always — `@agent-k3v7d2mq`.
 *
 * ⚠ THE ID FORM IS ALWAYS CLAIMED, EVEN WHEN A NAME EXISTS, and that is deliberate: a name is
 * machine-local, mutable and may collide, while the id is minted once and never recycled. It is
 * the handle that cannot stop working, so it is never withdrawn — a rename must not silently break
 * an address somebody already wrote down.
 *
 * ⚠ THE SLUGGER IS `lib/mentions.ts › mentionSlug`, IMPORTED AND NOT RESTATED. One convention
 * across both namespaces (Samuel: same convention as the roster's); a second `.replace(/\s+/g,
 * "-")` here is how the two come to spell one name two ways.
 *
 * ⚠ **A NAME IS UNIQUE AMONG ADDRESSABLE AGENTS BEFORE IT EVER REACHES THIS INDEX** (Samuel,
 * 2026-09-15, verbatim: *"I think we should enforce a rule where no two agents that are
 * addressable can have the same name. … If a user launches an agent with the same name, let's
 * just have the name auto-renamed to that name and -1 … it will automatically auto-resolve to
 * coder-1 … coder-2 and so on and so forth."*). The rule is enforced where the name is COMMITTED
 * — `dopl-desktop-app/main/agent-name-unique.js`, through the one door every rename and launch
 * path already shares (`main/agent-identity-commit.js › commitRename`) — so by the time a name
 * arrives here it is already the only one of its slug in that channel.
 *
 * ⚠ **SO THIS MODULE MINTS NOTHING AND CONTESTS NOTHING, AND THAT IS THE POINT.** Samuel: *"The
 * names should reflect the slug anyway, so that almost shouldn't be a conflict ever, right?"*
 * `claim` refuses an occupied handle, so the first claimant keeps it — a branch that can only be
 * reached by a legacy row, a peer's machine, or a push this machine has not seen yet.
 *
 * ⚠ **IT REPLACES TWO EARLIER ANSWERS, AND BOTH WERE RESOLVE-TIME ANSWERS TO A COMMIT-TIME
 * PROBLEM** (`docs/specs/agent-id-visibility.md` carries the trace):
 *   · **2026-09-07, the SUFFIX MINT.** `coder-1` was computed HERE, positionally over the live
 *     set — so it was not durable: when the agent holding `coder` ended, the next one moved up and
 *     `@coder-1` came to name a different agent than it did an hour ago. The suffix is STORED now
 *     (`channel_sessions.display_name`), decided once, and re-points for nobody.
 *   · **2026-09-15 earlier the same day, FAIL-CLOSED.** A contested slug resolved to NEITHER and
 *     the author was told to use `@agent-<id>`. Samuel ruled the collision out of existence
 *     instead, which leaves nothing to disambiguate and no reason to teach an id.
 *
 * ⚠ **THE ID FORM IS STILL NEVER WITHDRAWN** — it is what a rename must not break, and what a
 * body written before a rename goes on resolving through. What changed is that no copy anywhere
 * now tells a person or an agent to reach for it.
 *
 * ⚠ **THE PRECEDENCE, IN ONE LINE: ID FORMS, THEN MEMBERS, THEN AGENTS BY CLAIM ORDER.** Ids are
 * claimed first and can never be outbid (pass 1); the MEMBER namespace is reserved against this
 * one, so an agent named after a person never takes the bare tag and the person keeps it; agent
 * against agent is decided by the order the caller supplies, which is launch order at every real
 * call site. ⚠ **A SECOND CLAIMANT SIMPLY LOSES**, which is safe only because the commit-time
 * rule above means there is not supposed to BE one: `claim` refuses an occupied key rather than
 * overwriting it, so the agent that has worn `@coder` longest goes on wearing it.
 *
 * ⚠ **ONLY ADDRESSABLE AGENTS ARE CANDIDATES, AND THE COMMIT-TIME RULE IS SCOPED THE SAME WAY.**
 * {@link addressableAgents} drops an ended session before the index is built (Samuel, 2026-09-06),
 * and `agent-name-unique.js` ignores an ended row for the same reason Samuel gave: *"If an agent
 * is ended, they can't be addressed anyway, so it won't matter. They can have duplicate names."*
 * A name an agent frees by stopping is available to the next launch, which is what makes the
 * stored suffix a fact about the launch rather than about the room's current shape.
 */

import { mentionHandleOf, mentionSlug } from "./mentions";

/**
 * **DOES THIS HANDLE SURVIVE THE TOKEN STRIP?** — the agent-side half of the round trip
 * `lib/mentions.ts › insertableHandle` runs for members (2026-09-07).
 *
 * ⚠ **THE SAME DEFECT LIVES IN BOTH NAMESPACES BECAUSE BOTH SLUG A FREE-TEXT NAME.** An operator
 * may call an agent "Bot!", which slugs to `bot!` — and {@link mentionHandleOf} strips the `!` off
 * any token before it is looked up, so `@bot!` asks for `bot` and reaches nobody. Anything that
 * OFFERS or SHOWS that spelling is handing a reader a tag that cannot work.
 * ⚠ **ASKED OF THE REAL PARSER, NEVER RE-DERIVED.** A punctuation list copied here is how this
 * comes apart the next time that class changes — the argument this module's header already makes
 * about the slugger, applied to the strip.
 */
function retypable(handle: string): boolean {
  return handle.length > 0 && mentionHandleOf(`@${handle}`) === handle;
}

/** An agent reduced to what the handle rule reads — satisfied by the desktop's session summary
 *  without this module importing the bridge type. */
export interface AgentMentionCandidate {
  agentId: string;
  /** The operator's own name for it (`main/agent-names.js`), or null when never renamed. */
  displayName?: string | null;
}

/** The `agent-<id>` form, which every agent claims and never loses. */
export function agentIdHandle(agentId: string): string {
  return `agent-${agentId.trim().toLowerCase()}`;
}

/**
 * THE HANDLE A PICKER SHOULD INSERT, and the one a surface should SHOW: the slugged custom name
 * when there is one, else `agent-<id>`.
 *
 * ⚠ IT IS THE PREFERRED handle, not the only one — see {@link buildAgentMentionIndex}, which
 * claims both. A caller that renders this and a resolver that accepts only this would make a
 * renamed agent unreachable by the id its operator has been quoting.
 */
export function agentMentionHandle(candidate: AgentMentionCandidate): string {
  const named = mentionSlug(candidate.displayName ?? "");
  // ⚠ AND IT MUST BE RETYPABLE (2026-09-07). A name that slugs to something the token strip eats
  // — "Bot!" → `bot!` — is a handle the picker would INSERT and the resolver would never see; the
  // id form is the fallback that always works, which is the whole reason it is never withdrawn.
  return retypable(named) ? named : agentIdHandle(candidate.agentId);
}

/**
 * Handle -> the agent id it names.
 *
 * ⚠ **NO `| null`, AND THE TYPE IS WHERE SAMUEL'S RULING IS PROVED RATHER THAN ASSERTED.** A
 * contested handle is not representable because a COLLISION is not representable: no two
 * ADDRESSABLE agents in one channel wear one name, enforced where the name is committed
 * (`main/agent-name-unique.js`). The header carries the full argument and the two resolve-time
 * answers this replaced.
 *
 * ⚠ **`undefined` IS THE ONE ABSENCE AND IT MEANS "no such handle".** There is no second kind to
 * tell it apart from any more, which is why `agentHandleContested` is deleted rather than kept as
 * a helper whose subject no longer exists.
 *
 * ⚠ **THE MEMBER INDEX STILL CARRIES `| null` AND STILL FAILS AMBIGUITY CLOSED**, and the two are
 * not converging: a member's handles come from their real name and email and are NOT the app's to
 * rewrite — `@diana-1` would be a handle no human agreed to wear. An agent's name is the app's to
 * assign at launch, which is exactly what makes a suffix honest for it and not for them.
 */
export type AgentMentionIndex = ReadonlyMap<string, string>;

/**
 * WHAT A RESOLVED AGENT TAG SHOWS A HUMAN — the agent's current name, or `null` when there is
 * none to show (Samuel, 2026-09-04: *"the UI should never make a human read @agent-h1anog51"*).
 *
 * ⚠ **IT IS A FACE, AND IT CHANGES NOTHING ABOUT THE ADDRESS.** The id stays the stored form, the
 * wire form and what the desktop routes on (`main/session-dispatch.js › mentionedAgentIds`); this
 * is read at RENDER time off the live identity map, which is why a rename re-faces every existing
 * mention on the next push without touching a single stored body.
 *
 * ⚠ **`null` IS THE ORDINARY ANSWER AND THE CALLER MUST RENDER THE RAW TOKEN FOR IT.** An agent
 * that was never renamed has no name, and the caller renders what the author typed.
 *
 * ⚠ **AN ENDED AGENT IS STILL FACED HERE, AND THAT IS DELIBERATE** (corrected 2026-09-06). This
 * paragraph used to say a dead agent faces `null` "because the identity map is the LIVE feed plus
 * the peer projection and both drop a session when it stops" — **false about the LOCAL feed**, and
 * the assumption behind a real defect: `main/session-summary.js › reportList` is live sessions PLUS
 * `retainedEnded()` for seven days, each row carrying a real `agentId` and a live `displayName`, so
 * the operator's own ended agent stayed in the map and its tag went on tinting blue as if it could
 * be reached. The fix narrows the HANDLE namespace ({@link addressableAgents}), never this map:
 * ATTRIBUTION must keep naming a dead agent on its own past messages. So a resolved tag still wears
 * a name — an ended agent simply no longer resolves.
 * ⚠ A PEER's ended agent was always faceless and still is, for the reason this used to claim for
 * both: the server projection drops stopped rows (`session-state-push.js › liveForWire`).
 *
 * ⚠ **A SHARED NAME IS DISAMBIGUATED, NEVER GUESSED AT.** Two agents CAN each be called "Bug
 * Reviewer" — names are per-machine, operator-set and deliberately not unique — so when the name
 * this id carries is also worn by another agent in the map, this answers `null` and the caller
 * falls back to the raw token. **Resolution is always id → name and never name → id**, so a
 * collision costs the label and can never misroute or mislabel WHICH agent was tagged.
 * ⚠ Case- and space-insensitive, because "bug reviewer" and "Bug Reviewer" are one name to a
 * reader and a collision the eye cannot see is the one worth catching.
 */
export function agentMentionFace(
  agentId: string,
  /** id -> what its operator calls it. Satisfied by `view-model.ts › AuthorIndex.agents` without
   *  this module importing that type. */
  identities: ReadonlyMap<string, { displayName?: string | null }>
): string | null {
  const name = (identities.get(agentId)?.displayName ?? "").trim();
  if (name.length === 0) return null;
  const same = name.toLowerCase();
  for (const [otherId, other] of identities) {
    if (otherId === agentId) continue;
    if ((other.displayName ?? "").trim().toLowerCase() === same) {
      // ⚠ A COLLISION FACES NOTHING (Samuel, 2026-09-05). The old answer was
      // `Bug Reviewer #k3v7d2mq`, which carries a SPACE — and a tag a reader cannot retype is
      // the misfire this whole rule exists to prevent. `null` hands the caller the raw token,
      // which for the id form IS the unambiguous address and for a typed name form is exactly
      // what the writer wrote. Disambiguation by falling back to the address, never by
      // inventing a handle that resolves to nobody.
      return null;
    }
  }
  // ⚠ SLUGGED, ALWAYS (Samuel, 2026-09-05): lower case, spaces as dashes. A face is a TAG a
  // reader may retype, so it has to be spelled the way the resolver spells it — "Research Bot"
  // renders `@research-bot`, never `@Research Bot`. `mentionSlug` is the ONE slugger this tree
  // has (`lib/mentions.ts`); a second `.replace(/\s+/g, "-")` here is how the composer's insert
  // and the transcript's tint would come to disagree about what a handle is.
  // ⚠ AND THE SAME SENTENCE DECIDES THE PUNCTUATION CASE (2026-09-07). "A face is a TAG a reader
  // may retype" is only true if the spelling survives the strip: an agent named "Bot!" faced
  // `@bot!`, which asks the resolver for `bot` and reaches nobody — a tag rendered as reachable
  // that no reader could ever make work. `null` here is the documented ordinary answer and the
  // caller renders the RAW token, which for the id form IS the address. Attribution is untouched:
  // this is the face on a TAG, not the name on a card.
  const slug = mentionSlug(name);
  return retypable(slug) ? slug : null;
}

/**
 * **THE TAG THE SERVER RESOLVED, SPELLED FOR A READER** — the face a routed-but-untagged row
 * shows above its body, and the raw address that rides on its `title` (Samuel, 2026-09-05).
 *
 * ⚠ **ONE PLACE DECIDES HOW A RESOLVED TAG IS SPELLED**, which is why this is here beside
 * {@link agentMentionFace} rather than inline in the transcript: the row and its hover text have
 * to agree, a thread card will want the same line, and a component cannot be unit-tested for a
 * string as cheaply as a function can.
 * ⚠ **IT REUSES {@link agentMentionFace} RATHER THAN RE-READING THE MAP**, so a routed tag and a
 * TYPED one are faced identically — same name, same `Name #id` collision form, same fallback to
 * the raw handle for an agent that has ended. Two spellings of one address is how a reader comes
 * to think two different agents were involved.
 * ⚠ **`null` FOR AN EMPTY LIST, NOT AN EMPTY STRING** — the caller renders NOTHING for a row the
 * server aimed at nobody, and "" would draw an arrow pointing at whitespace.
 * ⚠ **THE TITLE IS ALWAYS THE IDS**, never the faces: a hover exists to show the thing the face
 * replaced, and an agent with no name would otherwise hover to a copy of itself.
 */
export function routedTagLabel(
  agentIds: readonly string[],
  identities: ReadonlyMap<string, { displayName?: string | null }>
): { face: string; title: string } | null {
  if (agentIds.length === 0) return null;
  const address = (id: string) => `@${agentIdHandle(id)}`;
  return {
    face: agentIds
      .map((id) => {
        const named = agentMentionFace(id, identities);
        return named === null ? address(id) : `@${named}`;
      })
      .join(" "),
    title: agentIds.map(address).join(" "),
  };
}

/**
 * **THE AGENTS THAT MAY STILL CLAIM A HANDLE — the identity map narrowed to the REACHABLE**
 * (Samuel, 2026-09-06). An ENDED agent is dropped: nothing can reach it, so its tag must not
 * tint, and the missing highlight IS the signal that the name addresses nobody.
 *
 * ⚠ **THIS IS THE ONLY NARROWING, AND IT IS NOT THE IDENTITY MAP.** Callers pass
 * `AuthorIndex.agents` WHOLE everywhere else — attribution names the author of a past message,
 * and a session that has stopped still wrote what it wrote. Filtering the map itself would blank
 * the name on every message a dead agent ever sent, which is the failure this fix must not trade
 * for the one it repairs.
 *
 * ⚠ **THE MAP'S TYPE IS STRUCTURAL, NOT IMPORTED**, on the same rule as {@link agentMentionFace}:
 * this module answers a question ABOUT the identity map without depending on `view-model.ts`.
 * ⚠ **ABSENT `ended` IS LIVE**, so a host that reports no session state (the peer projection,
 * which drops stopped rows before they ever arrive) is unchanged and is not double-handled.
 */
export function addressableAgents(
  agents: ReadonlyMap<string, { displayName?: string | null; ended?: boolean }>
): AgentMentionCandidate[] {
  const out: AgentMentionCandidate[] = [];
  for (const [agentId, identity] of agents) {
    if (identity.ended === true) continue;
    out.push({ agentId, displayName: identity.displayName ?? null });
  }
  return out;
}

/**
 * Live agents -> handle index. ⚠ BUILT FROM THE MACHINE'S OWN FEED, so it holds only agents this
 * operator is running: a peer's agent has no entry, cannot be tinted, and could not be addressed
 * anyway (their ids are minted on their machine and known to no server).
 *
 * ⚠ IT CLAIMS A HANDLE FOR EVERY CANDIDATE IT IS GIVEN AND DOES NOT ASK WHETHER ONE IS STILL
 * RUNNING — the CALLER decides who is eligible ({@link addressableAgents} for the transcript,
 * `lib/draft-recipients.ts › liveAgentCandidates` for the composer's picker). Baking a liveness
 * rule in here would silently re-answer `resolveDefaultResponder`'s arm 1, whose candidates are
 * the server's own live set.
 */
export function buildAgentMentionIndex(
  candidates: readonly AgentMentionCandidate[],
  /**
   * **HANDLES THE AGENT NAMESPACE MAY NOT TAKE — the MEMBER handles for this room**
   * (2026-09-07).
   *
   * ⚠ **MEMBERS OUTRANK AGENTS, AND THIS IS WHERE THAT IS ENFORCED.** The two namespaces are
   * resolved by different functions over one body (`resolveMentions` for people,
   * this index for agents), so an agent an operator names "Diana" would otherwise claim
   * `@diana` in ITS namespace while the member kept it in THEIRS — one token, two different
   * answers, and which one wins decided by whichever caller asked. The member keeps the bare
   * tag; the agent keeps its id form and is reached by that.
   *
   * ⚠ **OPTIONAL, AND ABSENT MEANS "NO MEMBER NAMESPACE TO RESPECT", NOT "NO MEMBERS".** A
   * caller that has no roster in hand (the desktop's own body parse) is unchanged, and the
   * fail-safe direction is the harmless one: it may hand a bare slug a member also wears to an
   * agent, which is exactly today's behaviour rather than a new hazard.
   */
  reservedHandles: Iterable<string> = []
): AgentMentionIndex {
  const index = new Map<string, string>();
  const reserved = new Set<string>();
  for (const handle of reservedHandles) {
    const trimmed = handle.trim().toLowerCase();
    if (trimmed.length > 0) reserved.add(trimmed);
  }
  // ⚠ TWO PASSES SINCE 2026-09-07, AND THE SPLIT IS WHAT MAKES THE HEADER'S PROMISE TRUE.
  // It used to be one loop claiming `agent-<id>` then the name per candidate, which reads like
  // "the id form first" but is not: the id form is only claimed before THAT candidate's own
  // name, not before every other candidate's. So an agent its operator had named, literally,
  // `Agent K3v7d2mq` slugged to `agent-k3v7d2mq` and CONTESTED the permanent id handle of the
  // agent whose id that is — two claimants, ambiguity fails closed, and the id form resolved to
  // NOBODY. That is precisely the outcome this module's header forbids ("it is the handle that
  // cannot stop working, so it is never withdrawn"), reachable by a rename, and reachable ACROSS
  // MEMBERS: the server builds this index over the room's live rows whoever runs them
  // (`server/service-wake-verdict-handles.ts`), so one member could withdraw another member's
  // agent from addressing by naming their own agent after it.
  //
  // PASS 1 — every id form, before any name is looked at. Ids are minted unique and never
  // recycled, so these cannot contest each other, and pass 2 can never take one off them.
  const idForms = new Set<string>();
  for (const candidate of candidates) {
    const id = candidate.agentId.trim().toLowerCase();
    if (id.length === 0) continue;
    const handle = agentIdHandle(id);
    idForms.add(handle);
    if (!index.has(handle) && !reserved.has(handle)) index.set(handle, id);
  }
  // PASS 2 — NAMES, CLAIMED FIRST-COME AND NEITHER MINTED NOR CONTESTED (Samuel, 2026-09-15:
  // *"no two agents that are addressable can have the same name"*, enforced at COMMIT).
  //
  // ⚠ **THE THREE OUTCOMES, AND THE THIRD IS NOT SUPPOSED TO HAPPEN.**
  //   · A free, retypable slug is CLAIMED — one agent, one name, and with the commit-time rule
  //     in force this is every case.
  //   · A slug held by an ID FORM or by the MEMBER namespace is DROPPED: the id form is
  //     untouchable (pass 1 wrote it, and `idForms` keeps this pass off those keys), and a member
  //     outranks an agent. The agent keeps its id form, the fallback that never fails.
  //   · A slug a DIFFERENT agent already claimed is DROPPED TOO, so the first keeps it. **That
  //     branch is reachable only by something the commit rule cannot see** — a row written before
  //     this wave, a PEER's agent (names are minted on the machine that owns them), or a push
  //     this build has not received yet. Naming the first claimant is the weakest honest answer;
  //     it never re-points an address and never withdraws one.
  //
  // ⚠ **A NAME THAT CANNOT SURVIVE THE TOKEN STRIP CLAIMS NOTHING** (`retypable`): "Bot!" slugs
  // to `bot!`, which `mentionHandleOf` clips to `bot` before any lookup, so offering it would
  // hand a reader a tag that cannot work.
  for (const candidate of candidates) {
    const id = candidate.agentId.trim().toLowerCase();
    if (id.length === 0) continue;
    const named = mentionSlug(candidate.displayName ?? "");
    if (named.length === 0 || !retypable(named)) continue;
    if (reserved.has(named) || idForms.has(named) || index.has(named)) continue;
    index.set(named, id);
  }
  return index;
}

/**
 * **THE HANDLE A PICKER SHOULD INSERT FOR A CHOSEN AGENT** — the agent-side twin of
 * `lib/mentions.ts › insertableHandle`, and it exists for that function's exact reason
 * (2026-09-07).
 *
 * ⚠ **{@link agentMentionHandle} IS NOT SAFE TO INSERT, AND THIS IS THE WHOLE POINT.** That
 * function is per-candidate and knows nothing of the room: given two agents that somehow share a
 * name it answers the same slug for BOTH, so a picker using it would insert a token that reaches
 * the OTHER one — a row that shows a name and tags somebody else, which is F-210 in the agent
 * namespace. Only the index knows whether this agent actually won that spelling.
 *
 * ⚠ **IT ASKS THE INDEX AND NEVER RE-DERIVES THE ANSWER.** Recomputing "it was second, so it
 * lost" here would be a second copy of the claim rule, stale the moment the candidate order or
 * the reserved set changes. The index is the answer; this reads it back. ⚠ **AND WITH THE
 * COMMIT-TIME UNIQUENESS RULE IN FORCE IT SHOULD ALWAYS RETURN THE NAME** — the id-form fallback
 * is for a MEMBER-reserved slug, a name the token strip eats, and the rows that rule cannot see
 * (a peer's agent, a legacy row).
 *
 * ⚠ **THE ID FORM IS THE FALLBACK AND IT CANNOT FAIL**, which is why this returns a string and
 * not `string | null` as the member version does: pass 1 claims `agent-<id>` for every
 * candidate before any name is looked at, so an agent always has at least that handle. A member
 * can genuinely run out of spellings; an agent cannot.
 * ⚠ **IT NO LONGER SCANS FOR A `-1` SPELLING, AND THAT IS NOT A LOSS.** The 2026-09-07 mint
 * computed suffixes HERE, over the live set; they are STORED at launch now, so `coder-1` IS this
 * agent's `displayName` and `mentionSlug` finds it on the first line. A scan for a handle nothing
 * writes would be a loop over nothing.
 */
export function insertableAgentHandle(
  candidate: AgentMentionCandidate,
  index: AgentMentionIndex
): string {
  const id = candidate.agentId.trim().toLowerCase();
  const named = mentionSlug(candidate.displayName ?? "");
  if (named.length > 0 && index.get(named) === id) return named;
  return agentIdHandle(id);
}

/**
 * The agent a single token names, or null.
 *
 * ⚠ IT TAKES THE ALREADY-STRIPPED HANDLE, not the raw token: `lib/mentions.ts › mentionHandleOf`
 * owns trailing punctuation and markup, and a second strip rule here would be the two-parsers
 * defect this whole family is built to avoid.
 */
export function resolveAgentHandle(
  handle: string | null,
  index: AgentMentionIndex
): string | null {
  if (handle === null) return null;
  // ⚠ `?? null` IS THE ONE ABSENCE NOW — "no such handle". There is no contested value to tell
  // it apart from: the collision is prevented at commit (`main/agent-name-unique.js`), which is
  // why {@link AgentMentionIndex} carries no `null`.
  return index.get(handle) ?? null;
}

// ⚠ THE DEFAULT-RESPONDER LANE MOVED TO `agent-mentions-responder.ts`
// (2026-09-14, 500-line cap) — RR3, its reason vocabulary and the per-member
// setting. Re-exported here because that is the path every caller already
// imports them from (§1).
export type {
  ResponderChoice,
  ResponderReason,
  UnaddressedResponderSetting,
} from "./agent-mentions-responder";
export {
  normalizeUnaddressedResponder,
  resolveDefaultResponder,
  UNADDRESSED_RESPONDER_DEFAULT,
} from "./agent-mentions-responder";
