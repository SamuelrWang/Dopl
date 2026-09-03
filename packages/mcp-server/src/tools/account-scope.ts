/**
 * account-scope.ts — 🔒 **THE ONE SEAM THE ACCOUNT-WIDE CHANNEL READS PASS
 * THROUGH**, and the reason is B3.
 *
 * `GET /api/channels/account/status` and `.../messages` are `withUserAuth`: they
 * answer for the WHOLE ACCOUNT, every workspace and every home-channel
 * container, because that is the question T20/T21/T22 exist to answer in one
 * call. A container-LOCKED MCP session must see exactly the room it is standing
 * in and learn nothing about the existence of another — and the route cannot
 * enforce that, because a lock is a property of one MCP CONNECTION and not of
 * the credential.
 *
 * ⚠ **SO THE NARROWING LIVES HERE, ONCE, AND IT DELEGATES TO
 * `workspace-directory.ts › narrowToLock`.** That function's docblock states the rule this
 * one obeys: there is ONE reader of `WorkspaceDirectory.lockedWorkspaceId()`,
 * and a second reader has rebuilt the enumeration oracle B3 denies. A caller
 * that reaches `client.getAccountStatus()` directly has done exactly that — it
 * would hand a locked session the ids, names and unread counts of its
 * operator's OTHER rooms.
 *
 * ⚠ **AND IT IS A TRIPWIRE, NOT A FENCE**, like every other B3 surface. Bash can
 * open a second unpinned MCP connection or issue the loopback HTTP itself, and
 * neither passes through this module. What actually refuses a cross-container
 * read is the container-locked credential (B1) and the server's own membership
 * fence. Do not let a green test here read as containment.
 */

import type {
  AccountMessagesOptions,
  AccountMessagesPage,
  AccountStatus,
  AccountStatusOptions,
  DoplClient,
} from "@dopl/client";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { narrowToLock } from "../workspace-directory.js";

/**
 * The caller's account-wide channel status, NARROWED to the container lock.
 *
 * ⚠ The counters in `truncated` are the SERVER's and are passed through
 * untouched — narrowing removes rows the caller may not see, which is a
 * different fact from the server having hit a ceiling, and collapsing the two
 * would let a locked session read "nothing was clipped" as "you have one room".
 */
export async function accountStatus(
  client: DoplClient,
  directory: WorkspaceDirectory,
  opts: AccountStatusOptions = {},
): Promise<AccountStatus> {
  const status = await client.getAccountStatus(opts);
  return {
    ...status,
    // ⚠ `?? []` — the wire type is non-optional and an older server is not, and
    // a `.filter` on undefined throws where an empty list merely says "none".
    channels: narrowToLock(status.channels ?? [], directory),
  };
}

/**
 * One account-wide message page, NARROWED to the container lock.
 *
 * ⚠ **`channelCount` IS RE-DERIVED, NOT PASSED THROUGH.** The server counts the
 * channels it WATCHED; under a lock this session may see one of them, and
 * reporting the server's number would tell a locked agent how many rooms its
 * operator has. It is the one field narrowing must rewrite.
 */
export async function accountMessages(
  client: DoplClient,
  directory: WorkspaceDirectory,
  opts: AccountMessagesOptions,
): Promise<AccountMessagesPage> {
  const page = await client.readAccountMessages(opts);
  const messages = narrowToLock(page.messages ?? [], directory);
  const locked = directory.lockedWorkspaceId();
  return {
    ...page,
    messages,
    channelCount: locked
      ? new Set(messages.map((m) => m.channelId)).size
      : page.channelCount,
  };
}
