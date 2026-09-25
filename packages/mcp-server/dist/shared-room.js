"use strict";
/**
 * shared-room.ts — **IS THERE A SECOND AUDIENCE IN THIS ROOM?** The MCP
 * server's copy of the one member-count predicate (Samuel's rulings R-08 and
 * R-15, 2026-09-17; F-513).
 *
 * 🔒 ⚠ **IT IS BLIND TO THE CONTAINER KIND, AND THAT IS THE RULING.** Both
 * readers here used to ask `containerKind(w) === "home channel"` FIRST — the
 * container lock in `factory.ts › bootServer` and the confirm class's target in
 * `tools/confirm-token.ts › resolveConfirmTarget` — so a nine-member `standard`
 * workspace answered "solo" to both. **"Shared" is MORE THAN ONE MEMBER,
 * whatever kind of container the room sits in**, and R-15 arms the container
 * lock on exactly that.
 *
 * ⚠ **THE HOME SHELF IS STILL EXCLUDED, AND NOW IT IS EXCLUDED ON PURPOSE.**
 * F-564's warning was against `!isStandardWorkspace(…)`, whose NEGATIVE spelling
 * armed a peer-shaped lock on every operator's own `home` container. The
 * member count excludes it positively: a home shelf has exactly one member,
 * so it answers solo for the reason it IS solo. `confirm-token.ts` used to call
 * that exclusion "correct by accident"; it is the rule now.
 *
 * 🔒 ⚠ **AN ABSENT COUNT READS AS SHARED** — §8's stale-field rule INVERTED, on
 * purpose. `memberCount` is new on the cached `listWorkspaces` payload; an older
 * server sends none, and the reflex fallback (unknown → the permissive case)
 * would silently unlock every container across the release window in which a
 * desktop build runs against a server that predates the field. Unknown = not
 * solo = narrowed.
 *
 * ⚠ **A HAND MIRROR OF `src/shared/tenancy/shared-room.ts › isSharedRoom`,
 * BECAUSE `packages/` CANNOT IMPORT `src/`** and `@dopl/contracts` is type-only.
 * The bodies are pinned against each other by
 * `src/shared/tenancy/shared-room-parity.test.ts`, which slices THIS file.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSharedRoom = isSharedRoom;
/** More than one member — or a count nobody could read, which is the same answer. */
function isSharedRoom(memberCount) {
    return (typeof memberCount === "number" ? memberCount : 0) !== 1;
}
