/**
 * IDENTITY + LOCUS — the ONE definition of "who am I and where am I", for
 * every tool that answers it.
 *
 * WHY THIS FILE EXISTS. Three separate surfaces used to answer the question
 * from three unreconciled sources and none of them answered all of it:
 *   - `dopl_members(op="whoami")` re-derived the caller from
 *     `GET /api/workspaces/me`, whose `userId` is typed `string | null`. When it
 *     came back null the op still printed `## You in <workspace>` and a role and
 *     simply omitted the id — a confident answer with the identifying half
 *     missing.
 *   - `dopl_channel` used a DIFFERENT id, the boot status ping's, to mark "you"
 *     on a roster. Two sources that fail independently, so the two tools could
 *     disagree about the same session inside one connection.
 *   - `dopl_ontology(op="anchor")` said "You are anchored to this object" over a
 *     member-typed object NAME, carried no caller id at all, and is what the
 *     server instructions tell every agent to call for "my/me" requests. It is
 *     the strongest identity claim in the product with the weakest backing: any
 *     agent can re-point it with `op="claim_anchor"`.
 * And the `_dopl_status` footer — the line that rides EVERY successful response
 * and that the instructions tell the agent to read — named the workspace and
 * said nothing about who was asking.
 *
 * SO: one record, resolved once at boot, rendered by the functions below, and
 * nowhere else. A display name is peer-settable and two members can share one;
 * the user id is the half nobody else can hold. Every rendering here prints the
 * id, and none of them prints a name without it.
 *
 * WHAT THIS FILE REFUSES TO CLAIM is as load-bearing as what it states — see
 * `LOCUS_NOTE`. An agent confidently wrong about where it is running is worse
 * than one that knows it cannot tell.
 */
/**
 * The recognized `X-Dopl-Runtime` value (`src/shared/auth/runtime-header.ts`).
 * Restated rather than imported: `packages/*` cannot import from the app's
 * `src/`, and the app is the only sender. A drift here shows up as an
 * `unstamped` render, never as a wrong grant — nothing gates on this.
 */
export declare const DESKTOP_SESSION_RUNTIME = "desktop-session";
/** How the presented credential was obtained. Mirrors `McpCredential.kind`. */
export type CallerCredentialKind = "device" | "oauth-app";
/**
 * Everything the server actually knows about the caller's own session,
 * resolved once at boot. Every field is nullable because every field has a
 * real way of being unknown, and "unknown" must render as unknown.
 */
export interface CallerIdentity {
    /** The immutable, server-issued user id. Null only if auth could not resolve it. */
    userId: string | null;
    /** `desktop-session` when the request carried the recognized runtime header, else null. */
    runtime: string | null;
    /** How the credential was minted. */
    credentialKind: CallerCredentialKind | null;
    /** The credential's label, UNTRUSTED — neutralized on the way out, never before. */
    credentialLabel: string | null;
}
/** No identity at all — the shape every test-constructed server gets by default. */
export declare const UNKNOWN_CALLER: CallerIdentity;
/**
 * The `_dopl_status` caller line — terse on purpose, because this rides every
 * successful response.
 *
 * WHAT IT CARRIES AND WHY EXACTLY THIS: the user id (the only half that is the
 * caller's alone, and the half an agent needs to match an addressee uuid
 * against itself) and the runtime word (the one fact that distinguishes two
 * sessions of the SAME account, which is what "which of us is which" actually
 * turns on).
 *
 * WHAT IT DELIBERATELY OMITS: the display name, which would cost a roster
 * round-trip on every request (the MCP route boots per request) and is the
 * untrustworthy half anyway; and the credential label, which is a hostname —
 * it belongs in an answer the agent asked for, not stapled to every tool result
 * where it is both a per-response token cost and one careless paste away from a
 * channel message. Both live in `whoami`.
 *
 * IT CARRIED A THIRD FIELD, the MULTIPLAYER locus: the named agent THIS ONE
 * CALL spoke as (`dopl_channel` `as_agent`), which rode the RESULT rather than
 * the identity record because a session could speak for several agents. Named
 * agents are gone (channels rollback §1) and so is the whole `_callerAgent`
 * channel through `respond.ts` and `server.ts`. A session's own identity — the
 * `X-Dopl-Session-Id` stamp — is what names a running agent now.
 */
export declare function callerStatusLine(identity: CallerIdentity): string;
/**
 * The caller's own session, for the surfaces that answer "who am I" in full.
 * Returns [] when nothing is known, so a caller can drop the section rather
 * than render an empty claim.
 *
 * The credential label goes through `inlineOr` like any other user-authored
 * string: a device label is free-form text off the mint request body (see
 * `src/shared/auth/mcp-credential.ts`), so a newline in it would open a line of
 * server narration the caller wrote.
 */
export declare function sessionLines(identity: CallerIdentity): string[];
/**
 * WHAT THE SERVER CANNOT TELL YOU. Rendered under any full identity answer.
 *
 * Every line is a refusal, and each one is a mistake that has actually been
 * made against this surface: matching on a name instead of an id; reading a
 * credential label as a location; reading an absent runtime stamp as proof of
 * an external client; and — the one that cost a whole round of real work —
 * trying to decide whether a counterparty was a different machine or a
 * different account on the same machine. Accounts are decidable here. Machines
 * are not, for anyone but yourself, and the honest answer is to say so rather
 * than let the agent pick a side.
 */
export declare const LOCUS_NOTE = "LOCUS \u2014 what this establishes, and what it does not:\n- Your user id is yours alone. A display name is typed by its owner and two members can hold the same one, so match on the id, never on the name.\n- A credential label names the machine the credential was MINTED on. It is not where this session is RUNNING: a bearer token is copyable, and the desktop writes the same one into more than one place.\n- `desktop-session` means the request carried the Dopl desktop's runtime header; `unstamped` means it did not, which is usually an external client but is also how a desktop spawn on an older build looks. It is a self-reported routing hint that grants nothing \u2014 never read it as proof.\n- About ANOTHER party: a different user id is a different ACCOUNT and the same user id is the same account \u2014 that much is decidable. Whether they are on the same MACHINE as you is not knowable from here, and this server will never tell you. Do not assert it either way.";
/**
 * The caller's identity as the first line of a full answer: name and email when
 * the roster supplied them, and the user id ALWAYS. `self` is the caller's own
 * roster row, pre-rendered by the calling tool (which owns its own member
 * formatting); when it is absent — an unreadable roster, or a boot that could
 * not resolve the caller — the id still stands on its own rather than the
 * answer silently dropping to a role with nobody attached to it.
 */
export declare function identityLine(identity: CallerIdentity, self: string | null): string;
