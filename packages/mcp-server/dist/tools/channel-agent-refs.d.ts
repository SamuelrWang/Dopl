/**
 * AGENT IDENTITY for `dopl_channel`: how an agent is NAMED in a result, how a
 * caller-supplied agent reference is resolved to a row, and how a thread's
 * participant set is rendered.
 *
 * Split from `channel-ops-agents.ts` (which owns the six roster/participant OPS)
 * because these are used by ops in three other files — `post` resolves
 * `to_agent` / `as_agent`, `create_thread` resolves its `participants` seed,
 * `get_thread` renders the set. Same seam `channel-shared.ts` already draws
 * between resolvers and handlers. The `channel-` filename prefix is required by
 * the parity split-scan (parity.test.ts).
 *
 * NARRATION — the rule, stated once for every agent-named line in the tool. An
 * agent HANDLE is member-typed: its owner picks it at summon time and renames it
 * at will. It is charset-bounded in the database (`^[a-z][a-z0-9-]{1,30}$`), and
 * that is NOT a licence to splice it raw — deciding per site whether a value is
 * "really" attacker-reachable is the exact reasoning that left `close_thread`
 * rendering a raw peer title through a whole audit. So every handle goes through
 * `inlineOr`, every owner name through `memberRef` (which neutralizes and
 * carries the id), and NO handle is ever rendered without the immutable id
 * beside it: the handle is the claim, the id is the server's record of it.
 */
import type { ChannelAgent, DoplClient, ThreadParticipant, ThreadParticipantRef } from "@dopl/client";
import { type ToolResponse } from "./respond";
import { type MemberView } from "./channel-render";
/** Fallbacks for member-typed text that neutralized to nothing. */
export declare const NO_HANDLE = "(unreadable handle)";
export declare const NO_AGENT_ID = "(unreadable id)";
/** The lifecycle states `set_agent_status` accepts (mirrors the route's enum). */
export declare const AGENT_STATUSES: readonly ["summoned", "active", "parked", "dismissed"];
/**
 * How an agent is NAMED in output: the handle as a value, and ALWAYS the
 * immutable id beside it. The handle is what a human types and what a rename
 * changes; the id is what the server issued and what a claim can be checked
 * against. Rendering the handle alone would let one member's agent wear
 * another's name for a turn — which is exactly what `as_agent` is verified
 * against server-side.
 */
export declare function agentLabel(a: ChannelAgent): string;
/**
 * Resolve one agent reference against THIS channel's roster, or a ToolResponse
 * error naming the agents the channel does have.
 *
 * Resolving here rather than posting the raw string is what lets every op that
 * names an agent report a miss as "this room has no such agent, here are its
 * agents" instead of an opaque 400 — the same reason `resolveMemberOr` exists.
 */
export declare function resolveAgentOr(client: DoplClient, channelId: string, ref: string): Promise<ChannelAgent | ToolResponse>;
/** The agent identities on one post: who it is FOR, and who it is FROM. */
interface PostAgents {
    /**
     * EVERY addressed agent, in the order the caller named them, deduped —
     * `to_agent` first, then `to_agents`. Empty when the post addresses no agent.
     *
     * The ORDER is load-bearing and is the caller's: the server stamps the FIRST
     * one's owner as `metadata.to_user_id` (the owner bridge) and mirrors the
     * first id into the compat scalar `metadata.to_agent_id`
     * (`service-writes-agents.ts`). Re-sorting here would silently re-point which
     * machine a multi-address message is delivered to.
     */
    tos: ChannelAgent[];
    /**
     * The FIRST addressed agent, i.e. `tos[0]`. Kept as its own field because it
     * is what the result's addressing lines and the `to`/`to_agent` conflict note
     * are ABOUT — the head is the one whose owner the server addresses.
     */
    to?: ChannelAgent;
    /** `as_agent` — the caller's OWN agent, the one this post is attributed to. */
    as?: ChannelAgent;
}
/**
 * Resolve `to_agent` / `to_agents` / `as_agent` for a post, all against THIS
 * channel's roster, in ONE round-trip whichever of them is set (and none at all
 * when none is — an ordinary post pays nothing for this).
 *
 * MULTI-ADDRESS. `to_agents` is the N-agent form of `to_agent` ("@quartz @onyx
 * work together"), and `to_agent` is exactly its one-element case, so the two
 * are concatenated and resolved by the SAME matcher. ALL OR NOTHING, mirroring
 * `resolveAgentAddressing` on the server: one ref that names no agent of this
 * channel fails the whole post, naming that ref. A partial address is the worse
 * outcome by far — the caller believes N machines are working and fewer are.
 *
 * DEDUPE IS BY RESOLVED ID, not by string, so naming one agent by handle and by
 * id is one address rather than two. The server dedupes again (it must — it is
 * the boundary); doing it here as well is what keeps the RESULT's "addressed to
 * agents ..." line equal to what was actually sent.
 *
 * WHY RESOLVE `as_agent` HERE when the route wants a uuid anyway: an agent knows
 * its own HANDLE — that is the name it was summoned under and the name the room
 * addresses it by — and nothing hands it a uuid. Requiring the id would put a
 * lookup call in front of every self-attributed post, which is the surest way to
 * have agents skip attribution entirely. The OWNERSHIP check remains the
 * server's alone: this turns a name into an id, it does not decide whose agent
 * it is, and a non-owner is refused with a 403 at the route.
 */
export declare function resolvePostAgentsOr(client: DoplClient, channelId: string, toAgent?: string, asAgent?: string, toAgents?: string[]): Promise<PostAgents | ToolResponse>;
/**
 * The prefix form `participants` takes on `create_thread`: `agent:<handle or
 * id>` or `user:<email or user id>`, resolved here into the `{kind, id}` refs
 * the route stores.
 *
 * Both halves resolve against THIS CHANNEL — agents through
 * {@link resolveAgentOr}, people through {@link resolveChannelMemberOr} — which
 * is the same roster the route's own `assertIdentityBelongs` checks. That is
 * deliberate and it is B2's fix: a seed the route would reject must be rejected
 * HERE, because by the time the route rejects it the thread row already exists.
 *
 * WHY A STRING FORM rather than the route's object shape: the route needs
 * UUIDs, and an agent in a room knows HANDLES and EMAILS — the two things the
 * room actually uses to name people. A uuid-only object array would put a lookup
 * call in front of every breakout room, and a nested-object array is the shape
 * MCP clients most often mangle. The prefix is mandatory precisely because a
 * bare id is ambiguous: it could name either kind.
 */
export declare function resolveParticipantSeedOr(client: DoplClient, channelId: string, specs: string[]): Promise<ThreadParticipantRef[] | ToolResponse>;
/**
 * A thread's participant set, rendered for `get_thread` — the surface that
 * answers "is this MY breakout room?".
 *
 * An empty set is stated OUTRIGHT rather than omitted: a thread with no
 * participants is not a thread whose set failed to load, it is a thread still on
 * the creator/target pair rule, and those are different facts to act on.
 *
 * `agentNames` is best-effort (its fetch fails soft), so an agent that cannot be
 * named still renders by id — never a handle with no id, and never an id
 * silently dropped.
 */
export declare function participantLines(
/**
 * The set. `undefined` is NOT the same as empty and is not rendered at all:
 * `@dopl/client` normalizes a missing field to `[]`, so undefined here means
 * the set never loaded, and claiming "none" would assert the pair gate on a
 * thread we know nothing about. Saying nothing is the honest render.
 */
participants: ThreadParticipant[] | undefined, view: MemberView, agentNames: Map<string, string>): string[];
/** The channel's agent handles by id, for naming participants. Fails soft. */
export declare function agentNamesById(client: DoplClient, channelId: string): Promise<Map<string, string>>;
/**
 * The two things a READ needs to know about a channel's agents (BLOCKER-3):
 * what each addressed agent is CALLED, and which of them are the caller's.
 */
export interface AgentAddressIndex {
    /** `agentId → handle`, for {@link import("./channel-render").agentRef}. */
    names: Map<string, string>;
    /**
     * The ids of the agents this caller OWNS. Ownership is the only notion of
     * "mine" available here and it is the right one: an agent runs on its
     * owner's machine, and this connection speaks for that machine. A message
     * naming ANY of these named this side, whoever `to_user_id` points at.
     */
    mine: Set<string>;
}
/** Empty index — every agent renders as a bare id and none is the caller's. */
export declare const NO_AGENT_INDEX: AgentAddressIndex;
/**
 * The channel's agents, indexed for the read path. FAILS SOFT, on the same rule
 * as `memberNames`: this is ENRICHMENT, and a roster that 404s, 403s or times
 * out must degrade to bare ids rather than turn a successful read into an error
 * the agent might retry. The op that calls it has already established the
 * channel is visible (its own call would have 404'd first).
 *
 * `ref` may be a slug or an id — the agents route resolves either
 * (`loadVisibleChannel`), so the hot read path does not have to pre-resolve.
 *
 * The empty `mine` set on failure is the SAFE direction for the one predicate
 * that reads it: an unknown owner means "this message may not name you", which
 * leaves `AWAIT_UNNAMED_NOTICE` firing as it did before. A guessed one would
 * suppress the notice on somebody else's exchange.
 */
export declare function agentAddressIndex(client: DoplClient, ref: string, selfUserId: string | null): Promise<AgentAddressIndex>;
export {};
