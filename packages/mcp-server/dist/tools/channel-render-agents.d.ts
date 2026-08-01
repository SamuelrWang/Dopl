/**
 * WHICH AGENTS A MESSAGE NAMES, and how they are rendered on a transcript line.
 *
 * Split out of `channel-render.ts` at the §2 500-line cap when BLOCKER-3 landed,
 * and the seam is not arithmetic. Everything else in that file renders ONE ROW
 * of something the API already handed us shaped — a channel, a thread, a member,
 * a message's own columns. This reads an ADDRESS out of jsonb: two fields that
 * say the same thing, either of which may be absent, neither of which is typed,
 * on rows that predate both. That is a parsing concern with a render tail, it
 * changes when the addressing does rather than when the layout does, and it is
 * the only part of a message line that a READ has to fetch a roster to name.
 *
 * The `channel-` filename prefix is required by the parity split-scan
 * (parity.test.ts). The one-way dependency is deliberate: `channel-render.ts`
 * imports {@link agentRef} from here and nothing here imports it back, so the
 * agent-identity modules (`channel-agent-refs.ts`) can keep importing
 * `memberRef` from `channel-render.ts` without a cycle.
 */
import type { ChannelMessage } from "@dopl/client";
/**
 * WHICH AGENTS A MESSAGE NAMES — `metadata.to_agent_ids`, with the compat
 * scalar `to_agent_id` as the fallback.
 *
 * BLOCKER-3. Until now the read ops rendered `addresseeOf` alone, so "@quartz
 * @onyx work on X" came back as `· to <quartz's owner>` and NOTHING else: a
 * co-addressed agent could not see it had been named. That is the precondition
 * for two rules the tool description states as law — "addressed alongside
 * another agent? exactly one of you opens the thread", and the lowest-agent-id
 * tie-break that decides which one — so an agent following the law could not
 * tell the law applied. It also made `AWAIT_UNNAMED_NOTICE` actively false: the
 * owner of the SECOND addressed agent is not `to_user_id` (the server stamps
 * the FIRST agent's owner there), so their wake said "NONE of the messages
 * above NAMES you as its addressee" about a message that named their agent by
 * handle.
 *
 * BOTH FIELDS, because they are one address written twice.
 * `resolvePostMetadata` strips any caller copy of either and re-stamps them
 * from the validated addressing: `to_agent_ids` is the address and
 * `to_agent_id` is a COMPAT MIRROR of its head, kept for installed desktops
 * that predate the array. A row written by one of those, or by any path before
 * the array existed, carries only the scalar — so reading the array alone would
 * render a single-agent address as unaddressed, which is the exact false the
 * whole fix is about.
 *
 * Defensive about the shape for the same reason `readAddressedAgentIds`
 * (service-thread-handshake.ts) is: this is a jsonb column with no type-level
 * guarantee, and rows predate the keys entirely. Non-string entries are
 * dropped, repeats collapse, and the HEAD KEEPS ITS POSITION — the head is the
 * agent whose owner the server addressed, so re-ordering here would silently
 * disagree with the member tag beside it.
 */
export declare function addressedAgentIdsOf(m: ChannelMessage): string[];
/**
 * True when ANY message in a listing names an agent.
 *
 * This is what keeps the roster read OFF the hot path: `read` and `await` fetch
 * handles only when something they are about to render actually needs one, so
 * an ordinary transcript — and the poll loop behind it — pays nothing for a
 * feature it does not use.
 */
export declare function anyAgentAddressed(messages: ChannelMessage[]): boolean;
/**
 * An AGENT id, rendered the way `memberRef` renders a user id: the handle as a
 * neutralized value AND the immutable id, never the handle alone.
 *
 * The handle is member-typed — its owner picks it at summon time and renames it
 * at will — so it is the CLAIM, and the id is the server's record of it. That
 * is the rule `agentLabel` (channel-agent-refs.ts) states for the write side;
 * this is the same rule on the read side. The id goes through `inlineOr` too,
 * which is stricter than `agentLabel`'s hand-built span: this one is read back
 * off a jsonb column rather than off a typed row, and a hand-built code span is
 * not a container.
 *
 * `names` is best-effort: it comes from a roster read that FAILS SOFT, so an
 * agent that could not be named renders as its bare id. That is the honest
 * degradation — a bare id is still actionable (op="agents" resolves it), where
 * dropping the mention would hide that the message named an agent at all.
 */
export declare function agentRef(agentId: string, names: Map<string, string>): string;
/**
 * The `· to agents ...` tag for one message line, or "" when it names none.
 *
 * ONE TAG, NOT A PLURALIZED PAIR: it is written the same way for one agent as
 * for five, so a reader (or a grep, or the tool description that teaches it) has
 * a single token to scan for. The count is legible from the list itself.
 */
export declare function agentAddressTag(m: ChannelMessage, names: Map<string, string>): string;
