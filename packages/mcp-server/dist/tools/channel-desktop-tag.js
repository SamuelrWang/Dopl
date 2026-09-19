"use strict";
/**
 * **`@desktop` AND THE OUTSIDE-SESSION LABEL, AS THIS PACKAGE SEES THEM**
 * (2026-09-18, Samuel's ruling on the external-session group tag).
 *
 * ⚠ **HAND-COPIED CONSTANTS from `src/features/channels/lib/desktop-handle.ts`**
 * — `packages/*` cannot import the app's `src/` (INVARIANTS §13), the same
 * arrangement `identity.ts › DESKTOP_SESSION_RUNTIME` has with
 * `shared/auth/runtime-header.ts`. ⚠ Drift is SILENT and looks like "the tag
 * stopped working", so it is pinned by `channel-desktop-tag.test.ts`, which
 * reads the web tree's file directly.
 *
 * ⚠ **THIS PACKAGE ONLY READS.** The write side — resolution, stripping,
 * stamping — is entirely in the web tree; what lives here is how a STORED row
 * renders. So nothing in this file decides anything, and a value it does not
 * recognize must render as *absent*, never as a guess.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (`parity.test.ts`) and the removed-vocabulary source scan
 * (`channel-law.test.ts`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXTERNAL_SESSION_METADATA_KEY = exports.DESKTOP_TO_METADATA_KEY = exports.DESKTOP_HANDLE_TAG = exports.DESKTOP_GROUP_HANDLE = void 0;
exports.desktopAddresseeOf = desktopAddresseeOf;
exports.isExternalSessionPost = isExternalSessionPost;
exports.outsideRelevance = outsideRelevance;
exports.authorViewOf = authorViewOf;
const channel_shared_1 = require("./channel-shared");
/** The reserved group handle, bare. ⚠ Mirror of `lib/desktop-handle.ts`. */
exports.DESKTOP_GROUP_HANDLE = "desktop";
/** How `@desktop` renders in an addressing arrow. ⚠ One spelling, imported. */
exports.DESKTOP_HANDLE_TAG = `@${exports.DESKTOP_GROUP_HANDLE}`;
/** Server-owned key carrying the operator whose outside sessions were addressed. */
exports.DESKTOP_TO_METADATA_KEY = "to_desktop";
/** Server-owned key marking a post an OUTSIDE SESSION wrote. */
exports.EXTERNAL_SESSION_METADATA_KEY = "external_session";
/**
 * **WHOSE OUTSIDE SESSIONS THIS MESSAGE WAS ADDRESSED TO**, or `undefined`.
 *
 * ⚠ **`undefined` IS "NOT ADDRESSED TO ANY DESKTOP LANE", AND THAT IS THE ONLY
 * READING.** It is also what every row written before this key existed carries,
 * and what an older server stamps — all three collapse to the same rendering,
 * which is the pre-2026-09-18 one. There is no third state to tell apart here,
 * unlike `recipientAgentIds`' `[]`-versus-`null`.
 */
function desktopAddresseeOf(m) {
    // ⚠ `null` RATHER THAN `metaString`'s `undefined`, so this answers in the same
    // vocabulary as the web tree's `lib/desktop-handle.ts › desktopAddresseeOf`.
    // Two spellings of "absent" across a hand-copied pair is how one side grows a
    // `=== undefined` the other never satisfies.
    return (0, channel_shared_1.metaString)(m, exports.DESKTOP_TO_METADATA_KEY) ?? null;
}
/**
 * **WAS THIS POST WRITTEN BY AN OUTSIDE SESSION?**
 *
 * ⚠ **STRICTLY `=== true`.** The web tree stamps the key ONLY when the answer is
 * yes and never writes an explicit `false`, so any other value — absent, `null`,
 * a string some older build wrote — means *this server did not say*, and the
 * honest rendering of that is the ordinary agent label. Coercing with `!!` would
 * turn a truthy junk value into a confident claim about who wrote somebody's
 * message.
 */
function isExternalSessionPost(m) {
    const value = m.metadata?.[exports.EXTERNAL_SESSION_METADATA_KEY];
    return value === true;
}
/**
 * Classify one PAGE, in order. ⚠ **A PAGE-WIDE PASS RATHER THAN A PER-LINE
 * PREDICATE**, because class (ii) is positional: it depends on whether this
 * operator's own outside session has spoken EARLIER in the same room, which no
 * single row knows.
 *
 * ⚠ **THE "SAME ROOM" FENCE IS REAL.** A page can span channels (the workspace
 * hold, the account-wide read), so the "has my outside session spoken" flag is
 * kept per `channelId` — otherwise a record in a quiet room would inherit
 * relevance from an exchange in a different one.
 *
 * ⚠ **`selfUserId === null` YIELDS NOTHING.** A connection that could not
 * resolve its own user id cannot say which messages are for it, and a guess
 * here would mark a peer's traffic as the caller's.
 */
function outsideRelevance(messages, selfUserId) {
    const out = new Map();
    if (selfUserId === null)
        return out;
    const spokeHere = new Set();
    for (const m of messages) {
        const mine = m.authorUserId === selfUserId;
        if (desktopAddresseeOf(m) === selfUserId) {
            out.set(m.id, "addressed");
        }
        else if (m.authorKind === "agent" && !isExternalSessionPost(m)) {
            // (i) — an agent named the operator as a person.
            const named = (m.recipientUserIds ?? []).includes(selfUserId);
            // (ii) — a record or unaddressed post after my own outside session spoke.
            //   ⚠ `recipientUserIds` and `recipientAgentIds` BOTH empty is the
            //   "resolved to nobody" answer; `null`/absent is a pre-verdict row and
            //   must NOT be read as unaddressed, which is the same three-way
            //   distinction `addressTag` keeps.
            const resolvedToNobody = (m.recipientUserIds ?? null) !== null &&
                (m.recipientAgentIds ?? null) !== null &&
                (m.recipientUserIds ?? []).length === 0 &&
                (m.recipientAgentIds ?? []).length === 0;
            const trailing = resolvedToNobody && spokeHere.has(m.channelId);
            out.set(m.id, named || trailing ? "likely" : null);
        }
        else {
            out.set(m.id, null);
        }
        // ⚠ SET AFTER CLASSIFYING, so an outside session's OWN post never marks
        // itself as a reply to itself — the flag is about what comes NEXT.
        if (mine && isExternalSessionPost(m))
            spokeHere.add(m.channelId);
    }
    return out;
}
function authorViewOf(m) {
    // ⚠ ONLY AN `agent` ROW CAN BE ONE. A human composer post is `user` whatever
    // metadata it carries, and `system` is server-minted — promoting either would
    // be inventing an authorship claim from a flag that was never about them.
    return m.authorKind === "agent" && isExternalSessionPost(m)
        ? "external"
        : m.authorKind;
}
