/**
 * shared-room.ts — **IS THERE A SECOND AUDIENCE IN THIS ROOM?** One predicate,
 * asked of a MEMBER COUNT and of nothing else (Samuel's ruling R-08, 2026-09-17;
 * `docs/specs/workspace-parity/00-MASTER.md` §2.4 Theme B; F-513).
 *
 * 🔒 ⚠ **IT IS DELIBERATELY BLIND TO THE CONTAINER KIND, AND THAT IS THE WHOLE
 * RULING.** Until 2026-09-17 the tree answered this question two ways: three
 * sites asked `kind === 'link' && memberCount !== 1` and a fourth
 * (`features/channels/lib/tool-profile-resolve.ts › isSharedChannel`, F-692)
 * asked the member count alone — so a nine-member `standard` workspace was
 * "solo" to the MCP container lock and to the publish acknowledgement while
 * being "shared" to the launch profile. **"Shared" now means MORE THAN ONE
 * MEMBER, whatever kind of container the room sits in.**
 *
 * 🔒 ⚠ **AN ABSENT COUNT READS AS SHARED**, which is not a defensive reflex but
 * §8's stale-field rule applied in the INVERTED direction, on purpose. Every
 * reader of this answer uses it to NARROW — remove a shell, arm a directory
 * lock, demand an acknowledgement — so an unknown that read "solo" would
 * describe a stranger's room as one that keeps its shell. `!== 1` says that in
 * one term: `0`, `null` and `undefined` are the unknown, and only an exact `1`
 * is solo.
 *
 * ⚠ **THE RE-EXPORTS ARE THE ONLY OTHER SPELLING IN `src/`.**
 * `features/channels/lib/tool-profile-resolve.ts › isSharedChannel` is this
 * function under its channel-shaped name, kept so no importer moved when the
 * body came here; `features/workspaces/server/shared-publish.ts` calls this one
 * directly.
 *
 * ⚠ **AND `packages/mcp-server/src/shared-room.ts` IS A HAND MIRROR, BECAUSE
 * `packages/` CANNOT IMPORT `src/`** and `@dopl/contracts` is type-only (it
 * emits no runtime code and has no runtime export condition, so it cannot hold
 * a function). The drift bomb is defused the way this repo already defuses it
 * for the desktop's copy of `profileForChannel`: `shared-room-parity.test.ts`
 * SLICES the package's source and runs it against this file over the full input
 * domain, and censuses the tree for the retired `kind === 'link' && memberCount`
 * spelling.
 */

/** More than one member — or a count nobody could read, which is the same answer. */
export function isSharedRoom(memberCount: number | null | undefined): boolean {
  return (typeof memberCount === "number" ? memberCount : 0) !== 1;
}
