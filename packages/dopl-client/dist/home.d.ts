/**
 * Home-surface methods for `DoplClient`. Free functions over `DoplTransport`;
 * the class-side method group is `client-home.ts`.
 *
 * 🔒 **BOTH ADDRESS `/api/channels?scope=account` (Samuel's ruling R-26 (b),
 * 2026-09-17: *one endpoint*).** `GET|POST /api/home/channels` is **DELETED**,
 * not aliased — it 404s — and `scope` is what chooses the route's ACCOUNT arm.
 * ⚠ **THE PARAM IS NOT OPTIONAL HERE EVEN THOUGH IT IS ON THE WIRE**: the route
 * defaults an absent `scope` to `container`, which is `withWorkspaceAuth` and
 * would 400 `WORKSPACE_REQUIRED` at exactly the caller these two exist for.
 *
 * ⚠ USER-SCOPED, NOT WORKSPACE-SCOPED. That arm is `withUserAuth` and reads no
 * `X-Workspace-Id`; the fence is the caller's own membership rows, so a
 * container the caller does not belong to is unreachable from any query behind
 * it. A workspace header on these calls would be noise that suggests a scoping
 * this arm does not have.
 *
 * 🚫 **NO LINK MINT, EVER, AND THE OMISSION IS THE DESIGN.**
 * `POST /api/home/links` is `sessionOnly` because it mints a credential that
 * reaches a PERSON, and `DELETE .../links/[linkId]` and the claim are
 * `sessionOnly` for the same reason. Binding any of them here would publish a
 * method every MCP tool holds and no MCP caller may use — the same argument that
 * keeps `deleteAgentTemplate` unbound.
 */
import type { DoplTransport } from "./transport.js";
import type { HomeChannelCreateResult, HomeChannelsPayload } from "./home-types.js";
/**
 * Every channel the caller is in, account-wide.
 *
 * ⚠ **THE NAME SAYS "HOME" AND THE ANSWER IS WIDER THAN THAT** — every container
 * of every kind, not the `kind='link'` rooms alone. The name is kept because
 * `client-surface.test.ts` pins the published method list by name; the field
 * that tells the kinds apart is `Channel.container`, asked POSITIVELY. See
 * `home-types.ts`.
 *
 * 🔒 ⚠ **THIS IS AN ENUMERATION, AND IT IS NOT NARROWED HERE.** The route
 * answers for the WHOLE ACCOUNT; the CONTAINER LOCK (B3)
 * that narrows a pinned session to one room lives in the MCP layer
 * (`packages/mcp-server/src/workspace-directory.ts › narrowToLock`), because the lock is a
 * property of one MCP CONNECTION and not of the credential. A caller of this
 * function that forgets to narrow has built the enumeration oracle B3 exists to
 * deny — do not add a second reader that skips it.
 */
export declare function getHomeChannels(t: DoplTransport): Promise<HomeChannelsPayload>;
/**
 * Create a home channel: a solo container plus one private channel inside it.
 *
 * ⚠ DELIBERATELY REACHABLE BY AN AGENT TOKEN (Samuel's ruling 2026-08-24, and
 * Q11 2026-08-28): the route is NOT `sessionOnly` because creating a room you
 * are alone in mints nothing that reaches another person. Adding somebody to it
 * is the separate, session-gated act.
 */
export declare function createHomeChannel(t: DoplTransport, input: {
    name: string;
}): Promise<HomeChannelCreateResult>;
