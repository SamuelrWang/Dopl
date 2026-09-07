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
 * ⚠ **AMBIGUITY NO LONGER FAILS CLOSED — IT MINTS A SUFFIX** (2026-09-07, Samuel, verbatim: *"if
 * coder exists, then other slugs will be coder-1, coder-2, coder-3"*). Two agents an operator has
 * given the same name used to contest one slug and it resolved to NEITHER, so a rename could take
 * a working handle away from an agent that was never renamed. The first claimant keeps `coder`
 * and the second is minted `coder-1`; both stay addressable, and no handle in this index maps to
 * `null` any more — {@link AgentMentionIndex} carries no `null` at all, which is where that is
 * proved rather than asserted.
 *
 * ⚠ **THE PRECEDENCE, IN ONE LINE: ID FORMS, THEN MEMBERS, THEN AGENTS BY CLAIM ORDER.** Ids are
 * claimed first and can never be outbid (pass 1); the MEMBER namespace is reserved against this
 * one, so an agent named after a person gets `-1` and the person keeps the bare tag; agent
 * against agent is decided by the order the caller supplies, which is launch order at every real
 * call site.
 *
 * ⚠ **THIS IS AN AGENT RULE AND MUST NOT BE COPIED TO MEMBERS.** `lib/mentions.ts` still fails
 * ambiguity closed, correctly: a member's handles come from their real name and email, and
 * `@diana-1` would be a handle no human agreed to wear. An agent's name is machine-local and
 * operator-set, which is exactly what makes a minted suffix honest for it.
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
 * ⚠ **NO `| null` SINCE 2026-09-07, AND THE TYPE IS THE PROOF** (Samuel's suffix ruling: *"if
 * coder exists, then other slugs will be coder-1, coder-2, coder-3"*). This map used to carry
 * `null` for a contested handle — ambiguity failing closed, the answer
 * `lib/mentions.ts › buildMentionIndex` still gives for members. {@link buildAgentMentionIndex}
 * now MINTS a suffix instead of contesting, so it never writes a handle twice and there is no
 * value left for `null` to describe. Narrowing the type is what makes that unrepresentable
 * rather than merely unreached — a comment claiming "this cannot happen" is the claim nothing
 * checks.
 *
 * ⚠ **THE MEMBER INDEX IS DELIBERATELY NOT CHANGED WITH IT.** A member's handles come from
 * their real name and email and are not the app's to mint; `@diana-1` would be a handle no
 * human agreed to wear. An agent's name is machine-local and operator-set, which is exactly why
 * a suffix is honest there and not here.
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
   * (2026-09-07, Samuel's suffix ruling).
   *
   * ⚠ **MEMBERS OUTRANK AGENTS, AND THIS IS WHERE THAT IS ENFORCED.** The two namespaces are
   * resolved by different functions over one body (`resolveMentions` for people,
   * this index for agents), so an agent an operator names "Diana" would otherwise claim
   * `@diana` in ITS namespace while the member kept it in THEIRS — one token, two different
   * answers, and which one wins decided by whichever caller asked. The member keeps the bare
   * tag; the agent is minted `diana-1` and stays addressable there.
   *
   * ⚠ **OPTIONAL, AND ABSENT MEANS "NO MEMBER NAMESPACE TO RESPECT", NOT "NO MEMBERS".** A
   * caller that has no roster in hand (the desktop's own body parse) is unchanged, and the
   * fail-safe direction is the harmless one: it may mint a bare slug a member also wears, which
   * is exactly today's behaviour rather than a new hazard.
   */
  reservedHandles: Iterable<string> = []
): AgentMentionIndex {
  const index = new Map<string, string>();
  const reserved = new Set<string>();
  for (const handle of reservedHandles) {
    const trimmed = handle.trim().toLowerCase();
    if (trimmed.length > 0) reserved.add(trimmed);
  }
  const taken = (handle: string) => index.has(handle) || reserved.has(handle);
  const claim = (handle: string, agentId: string) => {
    if (handle.length === 0 || taken(handle)) return;
    index.set(handle, agentId);
  };
  /**
   * **THE SUFFIX MINT** — `coder`, else `coder-1`, `coder-2`, `coder-3` … (Samuel, verbatim).
   *
   * ⚠ **IT IS BOUNDED BY THE CANDIDATE COUNT AND CANNOT SPIN.** At most one handle per
   * candidate is minted here, so `n` candidates can occupy at most `n` slots in any one family
   * — the loop therefore finds a free slot in at most `n + reserved` steps and the guard below
   * is a statement of that fact, not a hope.
   *
   * ⚠ **THE SUFFIXED FORM MUST ITSELF BE RETYPABLE**, checked rather than assumed: the base is
   * already a slug and `-1` adds only characters `mentionHandleOf` keeps, but this is the round
   * trip that says so instead of a second copy of the punctuation class.
   */
  const mint = (base: string): string | null => {
    if (!taken(base) && retypable(base)) return base;
    for (let n = 1; n <= candidates.length + reserved.size + 1; n += 1) {
      const suffixed = `${base}-${n}`;
      if (!taken(suffixed) && retypable(suffixed)) return suffixed;
    }
    return null;
  };
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
  // ⚠ AND THE REFUSAL IT PRODUCED WAS A LOOP, which is why this is a defect and not a curiosity.
  // `ChannelAgentHandleAmbiguousError` lists the claimants AS THEIR ID FORMS — so the error told
  // the writer to retry with `@agent-k3v7d2mq`, the exact handle that had just been refused.
  // PASS 1 — every id form, before any name is looked at. Ids are minted unique and never
  // recycled, so these cannot contest each other.
  // ⚠ THE `idForms` SET IS GONE (2026-09-07): pass 2 used it to DROP a colliding name, and a
  // collision is now a mint. The index itself is the only record of what is taken, which is one
  // fewer thing to keep in step with it.
  for (const candidate of candidates) {
    const id = candidate.agentId.trim().toLowerCase();
    if (id.length === 0) continue;
    claim(agentIdHandle(id), id);
  }
  // PASS 2 — NAMES, WHICH NOW MINT A SUFFIX INSTEAD OF LOSING (2026-09-07, Samuel: *"if coder
  // exists, then other slugs will be coder-1, coder-2, coder-3"*).
  //
  // ⚠ **WHAT THIS REPLACES, IN BOTH DIRECTIONS, BECAUSE BOTH OLD ANSWERS LOST AN ADDRESS.**
  //   · A name colliding with an ID FORM was DROPPED — the namer kept only their own id form,
  //     and their chosen name reached nobody at all. It is minted `-1` now.
  //   · Two agents sharing a NAME CONTESTED the slug and it resolved to NEITHER, so a rename
  //     could take a working handle away from an agent that was never renamed. The first
  //     claimant keeps the bare slug and the second is minted `-1`.
  //
  // ⚠ **CLAIM ORDER DECIDES WHO KEEPS THE BARE SLUG, AND IT IS THE CALLER'S ORDER.** That is
  // launch order at every real call site (the server sorts by `started_at`, the composer passes
  // the peer projection's own order), so the agent that has worn `@coder` longest goes on
  // wearing it. ⚠ **AND THE SUFFIXES ARE POSITIONAL, NOT DURABLE — this is the honest caveat.**
  // If the agent holding `@coder` ENDS, it leaves the candidate set and the next one moves up,
  // so `@coder-1` can come to name a different agent than it did an hour ago. Only the ID FORM
  // is permanent, which is precisely what this module's header has always claimed for it and
  // why pass 1 can never be outbid. A suffix is a convenience over a live set, not an address
  // to write down.
  //
  // ⚠ **AN UNMINTABLE NAME IS DROPPED, WHICH IS THE OLD BEHAVIOUR KEPT FOR THE ONE CASE THAT
  // DESERVES IT**: a name that cannot survive the token strip in any spelling. The agent is
  // still reachable by the id form pass 1 gave it — the fallback that never fails.
  for (const candidate of candidates) {
    const id = candidate.agentId.trim().toLowerCase();
    if (id.length === 0) continue;
    const named = mentionSlug(candidate.displayName ?? "");
    if (named.length === 0) continue;
    // ⚠ `idForms.has(named)` IS NO LONGER A DROP, ONLY A COLLISION — `mint` sees the id form
    // sitting in the index and moves to `-1`. The id form is still untouchable because `claim`
    // refuses an occupied handle rather than overwriting one.
    const handle = mint(named);
    if (handle !== null) claim(handle, id);
  }
  return index;
}

/**
 * **THE HANDLE A PICKER SHOULD INSERT FOR A CHOSEN AGENT** — the agent-side twin of
 * `lib/mentions.ts › insertableHandle`, and it exists for that function's exact reason
 * (2026-09-07, with the suffix ruling).
 *
 * ⚠ **{@link agentMentionHandle} IS NOT SAFE TO INSERT ONCE SUFFIXES EXIST, AND THIS IS THE
 * WHOLE POINT.** That function is per-candidate and knows nothing of the room: given two agents
 * both named "Coder" it answers `coder` for BOTH, so a picker using it would insert a token
 * that reaches the OTHER agent — a row that shows one name and tags somebody else, which is
 * F-210 in the agent namespace. Only the index knows which spelling this agent actually won.
 *
 * ⚠ **IT ASKS THE INDEX AND NEVER RE-DERIVES THE SUFFIX.** Recomputing "it was second, so it
 * must be `-1`" here would be a second copy of the mint, stale the moment the candidate order
 * or the reserved set changes. The index is the answer; this reads it back.
 *
 * ⚠ **THE ID FORM IS THE FALLBACK AND IT CANNOT FAIL**, which is why this returns a string and
 * not `string | null` as the member version does: pass 1 claims `agent-<id>` for every
 * candidate before any name is looked at, so an agent always has at least that handle. A member
 * can genuinely run out of spellings; an agent cannot.
 */
export function insertableAgentHandle(
  candidate: AgentMentionCandidate,
  index: AgentMentionIndex
): string {
  const id = candidate.agentId.trim().toLowerCase();
  const named = mentionSlug(candidate.displayName ?? "");
  if (named.length > 0) {
    // ⚠ THE BARE SLUG FIRST, THEN ITS SUFFIXED FORMS, so a picker shows the shortest spelling
    // this agent actually holds. The scan is bounded by the index rather than by a guess.
    if (index.get(named) === id) return named;
    for (const [handle, holder] of index) {
      if (holder === id && handle.startsWith(`${named}-`)) return handle;
    }
  }
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
  return index.get(handle) ?? null;
}

/**
 * WHY THIS AGENT AND NOT ANOTHER — the one word a surface prints beside a name
 * the author did not type.
 *
 * ⚠ **A CLOSED SET, SHARED BY BOTH TREES**, because it is stored (the server
 * stamps it into `metadata.wake_reason`) and rendered (the MCP read line, the
 * composer's chip). A free-form sentence here would be a second vocabulary the
 * renderers would each narrow differently.
 */
export type ResponderReason =
  // ⚠ `"default"` IS RETIRED (2026-09-06, Samuel's ruling on items 10 and 11). It named the
  // channel's configured `default_responder_agent_name` — a ROOM-WIDE pin of one specific
  // agent, set by a manager. His reasoning for killing it: *"if there's another member in the
  // room, their last agent address would be different from my last agent address."* One room
  // cannot hold one answer to a per-person question. ⚠ THE MEMBER OF THIS UNION IS KEPT so a
  // stored `metadata.wake_reason` written before today still renders as something rather than
  // as an unknown code; nothing produces it any more.
  | "default"
  /** Exactly one agent is live in the room. */
  | "only agent"
  /** Several are live; this one the ASKING PERSON addressed most recently. */
  | "most recent"
  /** Several are live and none was addressed lately; this one launched last. */
  | "most recently launched";

/**
 * **WHO ANSWERS THIS PERSON'S UNADDRESSED MESSAGES** — the per-user setting (2026-09-06,
 * Samuel's ruling on items 10 and 11).
 *
 * ⚠ **TWO OPTIONS, AND DELIBERATELY NO "PIN A SPECIFIC AGENT".** Agents are ephemeral — they
 * end, and their ids are minted per launch — so a pinned handle is a setting that decays into
 * naming nothing. That is the defect the room-wide `default_responder_agent_name` had, and it
 * is why the replacement is a RULE rather than a NAME.
 *
 * ⚠ **PER USER, NOT PER ROOM, AND THAT IS THE WHOLE RULING.** *"If there's another member in
 * the room, their last agent address would be different from my last agent address."*
 *
 * ⚠ **`"none"` MUST KILL EVERY FALLBACK, NOT JUST THE RECENCY ONE.** See
 * {@link resolveDefaultResponder} — arms 2, 3 and 4 all fire without anyone configuring
 * anything, so gating only the recency arm would leave a single-agent room still
 * auto-answering under "No one", which is the selection not being honoured.
 */
export type UnaddressedResponderSetting =
  /** Nobody answers this person's untagged messages. No agent is woken. */
  | "none"
  /** The agent this person addressed most recently in this room, if it is still live. */
  | "last_addressed";

/**
 * ⚠ **THE DEFAULT IS `last_addressed`, AND IT IS SAMUEL'S OWN STANDING RULING RATHER THAN A
 * PREFERENCE.** B1 (2026-09-04) says a forgotten `@` must never stall a conversation, and he
 * made that call off a live incident (row #966: a person wrote in a room with two live agents
 * and no default, the post stored `verdict=none`, fed 0 of 2, and he had to send it again with
 * a tag). Defaulting to `"none"` would silently reverse that for every room whose members
 * never open Settings — and silently reversing his rulings is the defect class this whole wave
 * exists to remove. `"none"` stays available as a deliberate act.
 */
export const UNADDRESSED_RESPONDER_DEFAULT: UnaddressedResponderSetting = "last_addressed";

/**
 * Coerce a stored / wire value to the closed set, fail-safe to the default.
 *
 * ⚠ **JUNK LANDS ON THE DEFAULT, NOT ON `"none"`.** The narrow answer looks like the safe one
 * and is not: `"none"` means "this person's untagged messages reach nobody", so an unreadable
 * column would silently stop answering a member who never chose that. Absent means "never
 * configured", which B1 already answers.
 */
export function normalizeUnaddressedResponder(
  raw: unknown
): UnaddressedResponderSetting {
  return raw === "none" || raw === "last_addressed"
    ? raw
    : UNADDRESSED_RESPONDER_DEFAULT;
}

export interface ResponderChoice {
  agentId: string;
  reason: ResponderReason;
}

/**
 * **THE CHANNEL'S DEFAULT RESPONDER, RESOLVED — ALL OF RR3, AS ONE PURE
 * FUNCTION** (2026-09-02, v2 wave B slice B10; arms 3a/3b added 2026-09-04).
 *
 * ⚠ **IT LIVES HERE BECAUSE TWO TREES ASK IT AND ONLY ONE OF THEM MAY IMPORT
 * `server-only`.** The rule was written for `server/service-wake-verdict-resilience.ts
 * › defaultResponder`, which still owns WHEN it is asked; the composer's recipient
 * line asks the same question about a draft that has not been sent yet, and a
 * second spelling of it is how the line comes to name an agent the server would
 * not have woken. `defaultResponder` is now a two-line adapter over this, so
 * there is one declaration and the server's own tests still drive it.
 *
 * THE ARMS, IN ORDER:
 *   1. the CONFIGURED handle (`channels.default_responder_agent_name`), if it is
 *      live in this room — tried as written and as its `agent-<id>` form, because
 *      the setting stores a handle and an operator may have typed either;
 *   2. else the room's ONE live agent;
 *   3. else, with several live: the one that POSTED here most recently
 *      (`recentAgentIds`, most-recent-first);
 *   4. else the FIRST candidate in the order the caller supplied — see the
 *      ordering note below.
 *
 * ⚠ **ARMS 3 AND 4 ARE SAMUEL'S B1 RULING APPLIED TO THE CASE IT HAD BEEN LEFT
 * OUT OF** (2026-09-04). "Two live agents and no setting" answered `null`, on the
 * argument that choosing between them is a guess — and the ruling in the same
 * breath is that **a forgotten `@` must never stall a conversation**. Row #966 is
 * what that costs: a person wrote in a room with two live agents and no default,
 * the post stored `verdict=none` and fed 0 of 2, and he had to send it again with
 * a tag. Two agents is the ordinary shape of a multiplayer channel, so the
 * "deliberately nobody" arm was the common case, not the edge.
 * ⚠ **AND IT IS NOT A GUESS, WHICH IS WHY IT IS SAYABLE.** "The one that spoke
 * here last" is the conversation's own answer to who is being talked to, and the
 * choice is STAMPED ({@link ResponderReason}) so the transcript can say why — the
 * thing a silent pick would not have.
 * ⚠ **THE CONFIGURED RESPONDER STILL WINS**, so an operator who has said who
 * answers is never second-guessed by recency.
 *
 * ⚠ **NOTHING HERE ORDERS THE CANDIDATES AND NOTHING SHOULD.** Arm 4 means "the
 * caller's first", and each caller documents its own ordering as its best
 * available answer to *most recently launched*: the server sorts by
 * `started_at` (`service-wake-verdict-resilience.ts › launchOrder`), the composer
 * passes the peer projection's own newest-first order. Baking a sort in would
 * give one caller a rule it did not ask for — the same argument the freshness
 * note below makes.
 *
 * ⚠ **NOTHING HERE FILTERS FOR FRESHNESS AND NOTHING SHOULD.** The caller decides
 * what "live" means: the server passes `liveChannelSessions` (PRESENCE — the
 * projection's full-set replace, Samuel's 2026-08-22 ruling), the composer passes
 * what the peer projection last answered. Baking a clock in would give one caller
 * a rule it did not ask for — and until 2026-09-05 the server's caller baked one
 * in for itself, which is how an idle agent stopped being addressable at all.
 */
export function resolveDefaultResponder(
  /**
   * ⚠ **THIS PARAMETER REPLACED `configured` ON 2026-09-06** (Samuel's ruling, items 10/11).
   * It was the channel's room-wide `default_responder_agent_name` — a manager pinning ONE
   * specific agent for EVERYBODY. It is now the ASKING PERSON's own two-valued setting.
   *
   * ⚠ **`"none"` SHORT-CIRCUITS EVERYTHING BELOW.** Not just the recency arm: arms 2, 3 and 4
   * all fire with nothing configured, so a single-agent room would otherwise go on
   * auto-answering under "No one" — the selection not being honoured, which is the complaint
   * this item came from.
   *
   * ⚠ **AN ABSENT VALUE IS THE DEFAULT, NOT `"none"`** — see
   * {@link UNADDRESSED_RESPONDER_DEFAULT}. Callers pass the coerced value; this signature does
   * not accept `null` precisely so "I could not read the setting" cannot be spelled as "the
   * user chose nobody".
   */
  setting: UnaddressedResponderSetting,
  candidates: readonly AgentMentionCandidate[],
  /** Agent ids the ASKING PERSON has ADDRESSED in this room, MOST RECENT FIRST
   *  (`lib/agent-post-stamp.ts › recentAgentsAddressedBy`; it credited
   *  `recentAgentPosters` until 2026-09-06, stale since the arm changed feed on
   *  2026-09-04). ⚠ **UNBOUNDED IN TIME** since 2026-09-06 — this loop's
   *  intersection with the live candidates is what ends the stickiness when an
   *  agent ends. Empty is a complete answer: arm 3 then falls to the caller's own
   *  ordering. */
  recentAgentIds: readonly string[] = []
): ResponderChoice | null {
  // ⚠ **THE WHOLE FUNCTION IS OFF WHEN THE PERSON SAID NOBODY.** First line, before any
  // candidate is looked at, so there is no arm below that can be reached with `"none"` set —
  // which is the only way "must not fire ANYWHERE" is enforceable rather than remembered.
  if (setting === "none") return null;
  // ⚠ **ARM 1 IS DELETED (2026-09-06).** It resolved the channel's configured handle against
  // the mention index, tried as written and as its `agent-<id>` form, and answered
  // `reason: "default"`. It was the room-wide pin; the setting above replaces it with a rule.
  // ⚠ NOTE WHAT WENT WITH IT: this was `buildAgentMentionIndex`'s ONLY call inside this
  // function, so the two-pass claim order (z5ztx9ts, 2026-09-07) is untouched by this change
  // and has one fewer caller to satisfy, not one more.
  const ids = [...new Set(candidates.map((c) => c.agentId))];
  if (ids.length === 0) return null;
  if (ids.length === 1) return { agentId: ids[0], reason: "only agent" };
  for (const id of recentAgentIds) {
    if (ids.includes(id)) return { agentId: id, reason: "most recent" };
  }
  return { agentId: ids[0], reason: "most recently launched" };
}
