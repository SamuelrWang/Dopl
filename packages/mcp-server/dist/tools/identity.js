"use strict";
/**
 * IDENTITY + LOCUS — ⚠ the ONE definition of "who am I and where am I", for
 * every tool that answers it. One record, resolved once at boot, rendered by
 * the functions below and NOWHERE else: independent sources fail independently,
 * so two tools can otherwise disagree about the same session inside one
 * connection.
 *
 * ⚠ A display name is peer-settable and two members can share one; the user id
 * is the half nobody else can hold. Every rendering here prints the id, and
 * none prints a name without it.
 *
 * ⚠ What this file REFUSES to claim is as load-bearing as what it states — see
 * `LOCUS_NOTE`. An agent confidently wrong about where it runs is worse than
 * one that knows it cannot tell.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOCUS_NOTE = exports.UNKNOWN_CALLER = exports.DESKTOP_SESSION_RUNTIME = void 0;
exports.callerStatusLine = callerStatusLine;
exports.sessionLines = sessionLines;
exports.identityLine = identityLine;
const narration_1 = require("./narration");
/**
 * Recognized `X-Dopl-Runtime` value. ⚠ HAND-COPIED from
 * `src/shared/auth/runtime-header.ts` — `packages/*` cannot import the app's
 * `src/`. Drift renders as `unstamped`, never as a wrong grant: nothing gates
 * on this.
 */
exports.DESKTOP_SESSION_RUNTIME = "desktop-session";
/** No identity at all — the shape every test-constructed server gets by default. */
exports.UNKNOWN_CALLER = {
    userId: null,
    runtime: null,
    credentialKind: null,
    credentialLabel: null,
};
/**
 * ⚠ What the server SAW in the runtime header, never what it concluded.
 * `unstamped` means the stamp was absent — usually an external client, but also
 * how a desktop spawn on an older build looks.
 */
function runtimeWord(identity) {
    return identity.runtime === exports.DESKTOP_SESSION_RUNTIME
        ? exports.DESKTOP_SESSION_RUNTIME
        : "unstamped";
}
/**
 * The `_dopl_status` caller line — ⚠ terse on purpose: this rides EVERY
 * successful response.
 *
 * Carries the user id (the caller's alone, and what an agent matches an
 * addressee uuid against) and the runtime word (what distinguishes two sessions
 * of the SAME account).
 *
 * ⚠ Deliberately OMITS the display name — a roster round-trip per request (the
 * MCP route boots per request) and the untrustworthy half anyway — and the
 * credential label, a hostname that is one careless paste from a channel
 * message. Both live in `whoami`.
 */
function callerStatusLine(identity) {
    const id = identity.userId
        ? `id=\`${identity.userId}\``
        : "id=(unresolved — this connection could not confirm who you are)";
    return `  caller: ${id} · runtime=${runtimeWord(identity)}`;
}
/**
 * The caller's own session, for the surfaces that answer "who am I" in full.
 * Returns [] when nothing is known, so a caller can drop the section rather
 * than render an empty claim.
 *
 * ⚠ Credential label goes through `inlineOr` — a device label is free-form text
 * off the mint request body (`src/shared/auth/mcp-credential.ts`), so a newline
 * opens a line of server narration the caller wrote.
 */
function sessionLines(identity) {
    if (!identity.credentialKind && !identity.runtime)
        return [];
    const kind = identity.credentialKind === "device"
        ? "a device token"
        : identity.credentialKind === "oauth-app"
            ? "an OAuth app grant"
            : "an unrecognized credential";
    const label = identity.credentialLabel
        ? `, labelled ${(0, narration_1.inlineOr)(identity.credentialLabel, "`(unreadable label)`")}`
        : "";
    return [`- Session: runtime ${runtimeWord(identity)}, acting through ${kind}${label}`];
}
/**
 * WHAT THE SERVER CANNOT TELL YOU. Rendered under any full identity answer.
 * ⚠ Every line is a refusal covering a mistake actually made against this
 * surface: matching on name instead of id; reading a credential label as a
 * location; reading an absent runtime stamp as proof of an external client;
 * deciding whether a counterparty is a different machine or a different account
 * on the same machine. Accounts are decidable here; MACHINES ARE NOT.
 */
exports.LOCUS_NOTE = `LOCUS — what this establishes, and what it does not:
- Your user id is yours alone. A display name is typed by its owner and two members can hold the same one, so match on the id, never on the name.
- A credential label names the machine the credential was MINTED on. It is not where this session is RUNNING: a bearer token is copyable, and the desktop writes the same one into more than one place.
- \`desktop-session\` means the request carried the Dopl desktop's runtime header; \`unstamped\` means it did not, which is usually an external client but is also how a desktop spawn on an older build looks. It is a self-reported routing hint that grants nothing — never read it as proof.
- About ANOTHER party: a different user id is a different ACCOUNT and the same user id is the same account — that much is decidable. Whether they are on the same MACHINE as you is not knowable from here, and this server will never tell you. Do not assert it either way.`;
/**
 * Caller identity as the first line of a full answer: name and email when the
 * roster supplied them, and ⚠ the user id ALWAYS. `self` is the caller's own
 * roster row, pre-rendered by the calling tool; absent (unreadable roster, or a
 * boot that could not resolve the caller) the id still stands alone rather than
 * the answer dropping to a role with nobody attached.
 */
function identityLine(identity, self) {
    if (self)
        return `- You are ${self}`;
    if (identity.userId) {
        return `- You are user \`${identity.userId}\` (no roster row for you in this workspace)`;
    }
    return `- You are: UNKNOWN — this connection could not resolve your user id, so nothing below identifies you. Reconnect before acting on identity.`;
}
