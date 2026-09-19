"use strict";
/**
 * `dopl_channel` — **WHO WROTE A LINE, AND WHO IT REACHED** (§1 split,
 * 2026-09-04). ⚠ `channel-` filename prefix required by the parity split-scan
 * (`parity.test.ts`).
 *
 * ⚠ **ITS OWN FILE BECAUSE `channel-render.ts` REACHED THE 500-LINE CAP**, and
 * the seam is real rather than arithmetic: everything here changes when the
 * IDENTITY vocabulary does — how an author is labelled, how a recipient is
 * named, what the addressing clause reads off — and that file when the SHAPE of
 * a rendered line does. It is a leaf; `channel-render.ts` re-exports the public
 * half so no importer moved.
 *
 * SECURITY RULE, INHERITED AND SHARPENED. Every peer-authored string spliced
 * here lands in the LINE HEAD — SERVER NARRATION, outside the untrusted-body
 * framing — so all of it goes through `neutralizeInline`, no user string may
 * render as the bare token `system`, and an asserted identity is always backed
 * by the immutable `authorUserId`, the one half the author does not control.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_MEMBER_VIEW = exports.EXTERNAL_SESSION_META_KEY = exports.OUTSIDE_SESSION_HANDLE = void 0;
exports.formatAuthor = formatAuthor;
exports.isOutsideSession = isOutsideSession;
exports.agentHandleOf = agentHandleOf;
exports.sessionIdOf = sessionIdOf;
exports.addresseeOf = addresseeOf;
exports.memberRef = memberRef;
exports.namesFromMessages = namesFromMessages;
exports.agentNamesFromMessages = agentNamesFromMessages;
exports.agentRef = agentRef;
exports.wakeReasonOf = wakeReasonOf;
exports.addressTag = addressTag;
exports.sessionTail = sessionTail;
const channel_shared_1 = require("./channel-shared");
const channel_render_threads_1 = require("./channel-render-threads");
// ⚠ The outside-session vocabulary — hand-copied constants pinned against the
// web tree, plus the two projections a renderer reads. See that file.
const channel_desktop_tag_1 = require("./channel-desktop-tag");
/**
 * Author label for a message line. `agent` row renders "agent for <name>",
 * never bare name — reader treats counterparty as another member's agent.
 *
 * ⚠ **IT TAKES THE READER SINCE 2026-09-18 (A2/S45), AND THAT IS WHAT LETS IT
 * SAY `for you`.** A label built from the MESSAGE ALONE can name an operator
 * and never say whether that operator is the reader's own, so a sibling worker
 * launched by the same person and a stranger's agent rendered identically —
 * and an agent deciding whether to answer, escalate or ignore was reading the
 * one distinction it needed out of a uuid it had to go and look up. `view` is
 * the reader `formatMessages` already holds; a caller that has none passes
 * {@link NO_MEMBER_VIEW} and gets exactly the old line.
 *
 * ⚠ Two rules, both because nothing validates `display_name`:
 *   1. Name NEUTRALIZED and user row prefixed `member`, never bare. Raw name
 *      may contain newlines → can close the line and forge fresh ones (a
 *      `- **#9001** system · <ts>` row was reproduced). Name of exactly
 *      "system" would render as the bare token `system`.
 *   2. `authorUserId` appended ALWAYS, not only as name-missing fallback. Name
 *      = author's claim; id = server's record. Claim alone is uncheckable.
 *
 * 🔒 **AND SINCE 2026-09-18 IT SAYS WHEN AN AGENT IS A SIBLING** (S45). An
 * agent post is authored by its OPERATOR'S ACCOUNT, so `agent @x for Samuel
 * Wang (<id>)` is what a reader saw whether that agent was ITS OWN sibling or a
 * stranger's — and wave 3 spent two whole waves believing a sibling was another
 * member's agent, then filed a false security finding off it. `memberRef` has
 * answered `you` for the caller's own id since it was written; this is that
 * same join, applied to the author half.
 *
 * ⚠ **THE JOIN IS ON `authorUserId`, THE HALF THE AUTHOR DOES NOT CONTROL** —
 * never on a name, and never on the agent handle. Two agents of one operator
 * share that id; two operators cannot.
 *
 * ⚠ **`view` IS OPTIONAL AND AN UNRESOLVED CALLER RENDERS EXACTLY AS BEFORE.**
 * `selfUserId` is null when the boot ping failed, and "I do not know who I am"
 * must not render as "not yours" — see {@link NO_MEMBER_VIEW}.
 */
function formatAuthor(m, view = exports.NO_MEMBER_VIEW) {
    const id = m.authorUserId ? `\`${m.authorUserId}\`` : null;
    // `system` is a server-controlled enum, not user text; `PostableAuthorKindSchema`
    // blocks a caller minting one. Only label here with no untrusted half.
    if (m.authorKind === "system")
        return id ? `system ${id}` : "system";
    const named = m.authorName ? (0, channel_shared_1.neutralizeInline)(m.authorName) : null;
    // ⚠ **`for you` IS AN ASSERTION ABOUT THE READER, SO IT IS MADE OFF THE
    // IMMUTABLE ID AND NOTHING ELSE** — the same half `memberRef` matches on, and
    // never the name.
    // ⚠ **BOTH SIDES MUST BE PRESENT** (batch D): a null `authorUserId` on a row
    // with an unresolved reader would otherwise compare `null === null` and claim
    // every anonymous row as the reader's own.
    const mine = view.selfUserId != null &&
        m.authorUserId != null &&
        m.authorUserId === view.selfUserId;
    const who = mine ? "you" : named && id ? `${named} (${id})` : (named ?? id);
    /**
     * **AN OUTSIDE SESSION SAYS SO** (2026-09-18, Samuel's ruling).
     *
     * ⚠ **THE DEFECT THIS CLOSES IS A STYLE ONE WITH A REAL COST.** A Claude Code
     * or Codex run on the operator's device token posts under the operator's
     * ACCOUNT, so this line read `agent for Samuel Wang` — or, with no session
     * stamp to build a handle from, simply `an agent`. An in-channel agent reading
     * that answered "@samuel-wang …" in short, human-facing prose to what was
     * actually another agent's question. The label is what lets it choose the
     * right register, which is the whole of ruling (a).
     *
     * ⚠ **IT REPLACES THE `agent` LABEL RATHER THAN QUALIFYING IT**, for the same
     * reason `SESSION ENDED` takes the kind slot in `channel-render.ts`: `agent ·
     * outside session` reads as two facts about one row where there is only one,
     * and the retired `Agent · <id>` chip is the in-repo precedent for not
     * building that idiom back.
     *
     * ⚠ **`for <who>` IS KEPT AND IS THE HALF THAT IS CHECKABLE.** `authorUserId`
     * is the server's own record and the one thing the author does not control —
     * the label is a projection off a server-stamped flag, and the id is what
     * backs it.
     *
     * ⚠ **AND `for you` WHEN THE READER IS THE OPERATOR** (A2/S45): the reader's
     * own outside session is the one case where the label can also say what to do
     * about it, so it carries the reply handle. Both halves were written on
     * separate branches and are ONE line here (integration, 2026-09-19).
     */
    // ⚠ **THROUGH `authorViewOf`, NEVER THE RAW FLAG.** Read directly, the flag
    // labelled a `user` row an outside session — the write path cannot produce
    // one, but a renderer must not be the thing that trusts that, and the
    // projection is the ONE place the "only an agent row can be one" rule lives.
    if (isOutsideSession(m)) {
        const label = who ? `outside session for ${who}` : "an outside session";
        return mine ? `${label} — reply ${channel_desktop_tag_1.DESKTOP_HANDLE_TAG}` : label;
    }
    if (m.authorKind === "agent") {
        const handle = agentHandleOf(m);
        const label = handle ? `agent ${handle}` : "agent";
        // ⚠ **`for you` REPLACES THE OPERATOR CLAUSE, IT DOES NOT JOIN IT.** The
        // operator IS the reader here, so `for you (Samuel Wang (<id>))` would be
        // the same fact twice and the id is already on every other row of the page.
        if (mine)
            return `${label} for you — YOUR OWN agent`;
        return who ? `${label} for ${who}` : (handle ? label : "an agent");
    }
    return who ? `member ${who}` : "a member";
}
/**
 * 🔒 **THE GROUP HANDLE FOR AN OPERATOR'S OUTSIDE SESSIONS** — one built-in
 * handle meaning *the operator's MCP sessions that are not app-spawned agents*
 * (Claude Code, Codex, Cursor, a script).
 *
 * ⚠ **THE SEAM IS CLOSED AND THE MECHANISM ARRIVED** (integration, 2026-09-19).
 * The handle's minting, its reservation against the member/agent namespaces and
 * the author kind on the wire were built on the SIBLING BRANCH that is now
 * merged, so this is an ALIAS of `channel-desktop-tag.ts ›
 * DESKTOP_GROUP_HANDLE` and not a second declaration of the string. Two copies
 * of a handle is exactly how a rename lands in one renderer and not the other.
 */
exports.OUTSIDE_SESSION_HANDLE = channel_desktop_tag_1.DESKTOP_GROUP_HANDLE;
/**
 * ⚠ **THE THIRD AUTHOR SHAPE IS NOT A NEW `authorKind`, AND IT IS NOT A DTO
 * FIELD EITHER.** `@dopl/contracts › MessageAuthorKind` is a CLOSED union guarded
 * by `scripts/check-message-kind-drift.ts` and the column's own `CHECK`, and both
 * `ChannelMessage` declarations sit at the 500-line cap — so the outside-session
 * marker rides server-owned `metadata.external_session` and is READ THROUGH A
 * FUNCTION on the sibling branch (`authorViewOf(message)` →
 * `MessageAuthorKind | "external"`).
 *
 * 🔒 **THIS IS THE ONE PLACE THIS TIER ASKS THE QUESTION**, and since the merge
 * (2026-09-19) it does not ask it itself: the body IS
 * `authorViewOf(m) === "external"`, and nothing else in this package moved.
 * Reading `metadata.external_session` directly would label a `user` row an
 * outside session; `authorViewOf` is the ONE place the "only an `agent` row can
 * be one" rule lives, and this function is now a named reading of it.
 *
 * ⚠ **THE OLD-PAYLOAD ANSWER IS `false`, AND IT IS `false` ON PURPOSE** (§8's
 * rule for a new payload field): a row written or cached before the marker
 * existed carries no `external_session`, and `undefined === true` is false — so
 * an old row renders exactly the line it always did rather than being reported
 * as an outside session nobody marked.
 */
exports.EXTERNAL_SESSION_META_KEY = channel_desktop_tag_1.EXTERNAL_SESSION_METADATA_KEY;
function isOutsideSession(m) {
    return (0, channel_desktop_tag_1.authorViewOf)(m) === "external";
}
/**
 * **WHICH AGENT — BY THE NAME ITS OPERATOR GAVE IT** (2026-09-04).
 *
 * ⚠ **THE LINE PRINTED `agent for Samuel Wang` AND A BARE ID TAIL, AND NEVER THE
 * NAME.** An operator runs several agents under ONE account, renames them, and
 * then talks about them by those names; a reader of this transcript had the
 * operator's name and an eight-character id and no way to join the two. The
 * server now sends the join as one field, `authorAgentName`.
 *
 * ⚠ **THE ID FORM IS THE FALLBACK AND IT NEVER STOPS WORKING** — a name is
 * absent for an older server, a swept session row, or an agent nobody renamed,
 * and `agent-<id>` is minted once and never recycled. That is the same
 * precedence `lib/agent-mentions.ts › agentMentionHandle` applies in the web
 * tree, stated here because this package cannot import it.
 *
 * ⚠ **NEUTRALIZED, AND IT LANDS IN THE LINE HEAD.** A display name has no
 * charset validation anywhere in the product; the head is OUTSIDE the
 * untrusted-body framing, so this is zone two by this file's security rule.
 * ⚠ **AND IT IS NOT AN ASSERTED IDENTITY ON ITS OWN**: the label still carries
 * `for <operator> (<user id>)`, the half the author does not control.
 */
function agentHandleOf(m) {
    const named = m.authorAgentName ? (0, channel_shared_1.neutralizeInline)(m.authorAgentName) : null;
    if (named)
        return `@${named}`;
    const session = sessionIdOf(m);
    const tail = session ? sessionTail(session) : null;
    return tail ? `@agent-${(0, channel_shared_1.inlineOr)(tail, channel_render_threads_1.UNREADABLE_ID)}` : null;
}
/**
 * WHICH SESSION WROTE THIS LINE — `metadata.session_id`. An agent post is
 * authored by its OWNER'S ACCOUNT and one operator runs many concurrent
 * sessions, so an author label alone cannot name the process; this field is the
 * only thing on the wire that can.
 *
 * Not peer-controlled: `resolvePostMetadata` deletes any caller copy and
 * re-stamps from `X-Dopl-Session-Id`, shape-checked in `session-header.ts` (id
 * chars only, no whitespace, ≤128). ⚠ Neutralized at render anyway — the write
 * path is a claim about today's code, not about rows already in the table, and
 * this lands in the LINE HEAD, outside untrusted-body framing.
 */
function sessionIdOf(m) {
    return (0, channel_shared_1.metaString)(m, "session_id");
}
/**
 * WHO A MESSAGE IS FOR — `metadata.to_user_id`. Separates "for ME" from "for
 * another member's agent" from "for nobody". An unaddressed ask in a 3+ member
 * channel triggers no agent at all (deliberate, fail-closed), so "unaddressed"
 * is a load-bearing fact, not a missing field.
 *
 * Not peer-controlled: `resolvePostMetadata` deletes any caller copy and
 * re-stamps from the route's validated `toUserId` uuid (or the resolved DM
 * peer). ⚠ Neutralized at render anyway — old rows predate today's write path.
 */
function addresseeOf(m) {
    return (0, channel_shared_1.metaString)(m, "to_user_id");
}
/** No caller identity and no names — every id renders as a bare id. */
exports.NO_MEMBER_VIEW = {
    selfUserId: null,
    names: new Map(),
};
/**
 * User id rendered actionably: `you` for the caller, else neutralized name AND
 * immutable id ({@link formatAuthor} shape). ⚠ Never name alone — display name
 * is owner-settable, so an unbacked name lets one member's label pose as another's.
 */
function memberRef(userId, view) {
    if (view.selfUserId !== null && userId === view.selfUserId)
        return "you";
    const id = (0, channel_shared_1.inlineOr)(userId, channel_render_threads_1.UNREADABLE_ID);
    const name = view.names.get(userId);
    const safeName = name ? (0, channel_shared_1.neutralizeInline)(name) : null;
    return safeName ? `${safeName} (${id})` : id;
}
/**
 * Names harvested from the listing itself — API already hydrates `authorName`,
 * so anyone who SPOKE in the window is named free; silent addressees render by
 * id. ⚠ No round-trip: `read`/`await` are the hot path.
 */
function namesFromMessages(messages) {
    const names = new Map();
    for (const m of messages) {
        if (m.authorUserId && m.authorName && !names.has(m.authorUserId)) {
            names.set(m.authorUserId, m.authorName);
        }
    }
    return names;
}
/**
 * Agent names harvested from the page's own agent AUTHORS — the same trick
 * {@link namesFromMessages} plays for members, and for the same reason: the
 * recipient columns carry IDS, the read already carries each author's name, and
 * a per-recipient round trip on the hot path would buy one string.
 *
 * ⚠ **A MISS IS THE `agent-<id>` HANDLE, NOT A BLANK** — an agent that has been
 * addressed but has not SPOKEN on this page is not on it, and the id form is the
 * handle that never stops working.
 */
function agentNamesFromMessages(messages) {
    const out = new Map();
    for (const m of messages) {
        if (m.authorKind !== "agent" || !m.authorAgentName)
            continue;
        const session = sessionIdOf(m);
        const id = session ? sessionTail(session) : null;
        if (id && !out.has(id))
            out.set(id, m.authorAgentName);
    }
    return out;
}
/**
 * ONE AGENT RECIPIENT, RENDERED — its operator's name when this page knows it,
 * else the `agent-<id>` handle. ⚠ Both halves neutralized: the name has no
 * charset rule anywhere in the product, and the id comes off a stored column.
 */
function agentRef(agentId, view) {
    const name = view.agentNames?.get(agentId);
    const safe = name ? (0, channel_shared_1.neutralizeInline)(name) : null;
    return safe ? `@${safe}` : `@agent-${(0, channel_shared_1.inlineOr)(agentId, channel_render_threads_1.UNREADABLE_ID)}`;
}
/**
 * **WHY THE SERVER PICKED THIS AGENT** — `metadata.wake_reason`, when nobody was
 * named and RR3 chose (2026-09-04).
 *
 * ⚠ **A CLOSED SET, TESTED AS ONE.** The key is server-stamped and stripped from
 * caller metadata, but this renders into the LINE HEAD — server narration — and
 * the write path is a claim about today's code, not about rows already in the
 * table. Anything outside the vocabulary renders as nothing rather than as
 * whatever the row carried, which is the same rule `formatSessionLine` applies
 * to `state`.
 */
const WAKE_REASONS = new Set([
    "default",
    "only agent",
    "most recent",
    "most recently launched",
]);
function wakeReasonOf(m) {
    const reason = (0, channel_shared_1.metaString)(m, "wake_reason");
    return reason && WAKE_REASONS.has(reason) ? reason : undefined;
}
/**
 * **WHO THIS MESSAGE WAS FOR, OFF THE COLUMNS THAT DECIDED IT** (2026-09-04).
 *
 * ⚠ **IT READ `metadata.to_user_id` ALONE AND PRINTED `· unaddressed` FOR
 * EVERYTHING ELSE**, so rows carrying `recipient_agent_ids={deynelz3}` and
 * `delivery=woken` — a wake that demonstrably happened — were rendered to the
 * agent that had just been woken as addressed to nobody (#974–#979). `to_user_id`
 * is the MEMBER half of an addressing decision the server now makes in full and
 * stores in two columns.
 *
 * ⚠ **THE THREE-WAY DISTINCTION IS THE WHOLE OF IT.** Both columns ABSENT (or
 * null) is "this server computed no verdict" — an older deployment, or a row
 * written before the migration — and that falls back to the `to_user_id`
 * vocabulary this line has always had. `[]` on both is "resolved to nobody",
 * which is `→ nobody` and is an ANSWER. Collapsing the two would report a
 * pre-verdict row as one that reached nobody.
 */
function addressTag(m, view) {
    const agents = m.recipientAgentIds;
    const users = m.recipientUserIds;
    if ((agents === null || agents === undefined) &&
        (users === null || users === undefined)) {
        const to = addresseeOf(m);
        return to ? ` · to ${memberRef(to, view)}` : " · unaddressed";
    }
    /**
     * **`→ @desktop` — THE OUTSIDE-SESSION LANE, RENDERED AS ITS OWN ADDRESSEE**
     * (2026-09-18).
     *
     * ⚠ **IT IS READ OFF `metadata.to_desktop` BECAUSE IT IS DELIBERATELY IN
     * NEITHER RECIPIENT COLUMN.** Those two are what machines route on, and this
     * address must reach no machine; so the arrow — which is a READER'S view of
     * the same decision — has to join the third source itself, or a
     * `@desktop`-addressed post renders `→ nobody` and reads as a record.
     *
     * ⚠ **IT NAMES WHOSE, UNLESS IT IS YOURS.** One operator per handle means a
     * room with two members holds two `@desktop`s; an unqualified tag on a peer's
     * would invite an outside session to adopt a message aimed at somebody else's
     * tooling. `you` is spelled by the bare tag, which is the form the reader
     * types back.
     */
    const desktopFor = (0, channel_desktop_tag_1.desktopAddresseeOf)(m);
    const desktopTag = desktopFor === null
        ? []
        : [
            view.selfUserId !== null && desktopFor === view.selfUserId
                ? channel_desktop_tag_1.DESKTOP_HANDLE_TAG
                : `${channel_desktop_tag_1.DESKTOP_HANDLE_TAG} (${memberRef(desktopFor, view)})`,
        ];
    const names = [
        ...(agents ?? []).map((id) => agentRef(id, view)),
        ...(users ?? []).map((id) => memberRef(id, view)),
        ...desktopTag,
    ];
    if (names.length === 0)
        return " · → nobody";
    const why = wakeReasonOf(m);
    return ` · → ${names.join(", ")}${why ? ` (${why})` : ""}`;
}
/**
 * THE SLOT-KEY SEGMENT THAT NAMES A SESSION. `metadata.session_id` is the
 * desktop's slot key, `<channelId>:<taskId>:<agentId>`
 * (`main/session-store.js › sessionKey`), and the AGENT id is the only segment
 * that distinguishes one session from another on the SAME thread — which is the
 * whole point of multiplayer.
 *
 * ⚠ IT USED TO SLICE AFTER THE FIRST COLON, and that predates the third segment
 * (fixed 2026-08-22). The key was `<channel>:<agent-or-thread>` when this was
 * written, so the slice was the tail; against a three-segment key it renders
 * `<thread>:<agent>` — an identity that is not a session, that repeats the
 * thread already tagged two clauses away, and that is long enough to bury the
 * one part a reader needs.
 *
 * ⚠ BOTH SHAPES STILL ARRIVE, so it reads from the END rather than counting
 * segments: rows written before the widening carry two, and a mid-wave record
 * can carry an EMPTY agent segment (the middle one is legitimately empty for a
 * responder with no first-class thread). The `|| ` fallbacks walk back rather
 * than rendering an empty span. ⚠ The agent charset (`^[a-z][a-z0-9]{7}$`)
 * carries no colon, so the last segment is unambiguous.
 */
function sessionTail(sessionId) {
    const parts = sessionId.split(":");
    if (parts.length < 2)
        return sessionId;
    return parts[parts.length - 1] || parts[parts.length - 2] || sessionId;
}
