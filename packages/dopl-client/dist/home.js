"use strict";
/**
 * Home-surface methods for `DoplClient`. Free functions over `DoplTransport`;
 * the class-side method group is `client-home.ts`.
 *
 * ⚠ USER-SCOPED, NOT WORKSPACE-SCOPED. `/api/home/channels` is `withUserAuth`
 * and reads no `X-Workspace-Id`; the fence is the caller's own membership rows,
 * so a container the caller does not belong to is unreachable from any query
 * behind it. A workspace header on these calls would be noise that suggests a
 * scoping this route does not have.
 *
 * 🚫 **NO LINK MINT, EVER, AND THE OMISSION IS THE DESIGN.**
 * `POST /api/home/links` is `sessionOnly` because it mints a credential that
 * reaches a PERSON, and `DELETE .../links/[linkId]` and the claim are
 * `sessionOnly` for the same reason. Binding any of them here would publish a
 * method every MCP tool holds and no MCP caller may use — the same argument that
 * keeps `deleteAgentTemplate` unbound.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHomeChannels = getHomeChannels;
exports.createHomeChannel = createHomeChannel;
/**
 * The caller's home channels.
 *
 * 🔒 ⚠ **THIS IS AN ENUMERATION, AND IT IS NOT NARROWED HERE.** The route
 * answers every home channel the account belongs to; the CONTAINER LOCK (B3)
 * that narrows a pinned session to one room lives in the MCP layer
 * (`packages/mcp-server/src/workspace-directory.ts › narrowToLock`), because the lock is a
 * property of one MCP CONNECTION and not of the credential. A caller of this
 * function that forgets to narrow has built the enumeration oracle B3 exists to
 * deny — do not add a second reader that skips it.
 */
async function getHomeChannels(t) {
    return t.request("/api/home/channels", {
        toolName: "home_list_channels",
    });
}
/**
 * Create a home channel: a solo container plus one private channel inside it.
 *
 * ⚠ DELIBERATELY REACHABLE BY AN AGENT TOKEN (Samuel's ruling 2026-08-24, and
 * Q11 2026-08-28): the route is NOT `sessionOnly` because creating a room you
 * are alone in mints nothing that reaches another person. Adding somebody to it
 * is the separate, session-gated act.
 */
async function createHomeChannel(t, input) {
    return t.request("/api/home/channels", {
        method: "POST",
        body: input,
        toolName: "home_create_channel",
    });
}
