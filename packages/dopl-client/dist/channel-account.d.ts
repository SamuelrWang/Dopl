/**
 * ACCOUNT-WIDE channel methods for `DoplClient`. Free functions over
 * `DoplTransport`; the class-side methods are on `client-channels.ts`.
 *
 * ⚠ **USER-SCOPED, NOT WORKSPACE-SCOPED — DO NOT SET A WORKSPACE ON THESE
 * CALLS.** `/api/channels/account/**` is `withUserAuth` and reads no
 * `X-Workspace-Id`; the fence is the caller's own `channel_members` rows, so a
 * channel the caller does not belong to is unreachable from any query behind
 * them. This is the same rule `home.ts` states for `/api/home/channels`, and a
 * workspace header here would be noise suggesting a scoping the routes do not
 * have. ⚠ The transport's AsyncLocalStorage override still applies if a caller
 * wraps one of these in `workspaceContext.run(...)` — it changes nothing about
 * the answer and it should not be done.
 *
 * ⚠ **NEITHER OF THESE IS A HOLD.** They are ordinary bounded pages. The
 * long-poll is `awaitWorkspaceMessages`, which is workspace-scoped and stays
 * that way; do not give these a `timeoutMs`.
 *
 * 🔒 **THEY ENUMERATE, AND THEY ARE NOT NARROWED HERE.** The routes answer for
 * the whole account; the CONTAINER LOCK (B3) that narrows a pinned MCP session
 * to one room lives in the MCP layer
 * (`packages/mcp-server/src/workspace-directory.ts › narrowToLock`), because a lock is a property
 * of one MCP CONNECTION and not of the credential. A caller of these functions
 * that forgets to narrow has built the enumeration oracle B3 exists to deny —
 * the identical caveat `home.ts › getHomeChannels` carries.
 */
import type { DoplTransport } from "./transport.js";
import type { AccountMessagesOptions, AccountMessagesPage, AccountStatus, AccountStatusOptions } from "./account-types.js";
/**
 * Every channel the caller is in, everywhere: its tenancy, its high-water seq,
 * the caller's own live sessions in it, unread past a cursor, and what is
 * addressed to the caller and unanswered.
 */
export declare function getAccountStatus(t: DoplTransport, opts?: AccountStatusOptions): Promise<AccountStatus>;
/** New messages past ONE cursor across every channel the caller is in. */
export declare function readAccountMessages(t: DoplTransport, opts: AccountMessagesOptions): Promise<AccountMessagesPage>;
