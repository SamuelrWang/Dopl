"use strict";
/**
 * **THE THREAD SHAPES, SPLIT OUT OF `channel-types.ts`** (2026-10-12).
 *
 * ⚠ **A REAL SPLIT, PAYING OFF A DATED EXEMPTION.** `channel-types.ts` sat at 499
 * lines against the 500-line cap and took a "split scheduled" entry in
 * `eslint.config.mjs` when B2 needed two declaration lines. Grammar B needed more
 * room again, so the debt is settled rather than rolled: the thread subject moves
 * here whole and the exemption is dropped. ⚠ The same lesson that list records
 * about `invitations.ts` — what finally moves a file is a behavioural requirement
 * landing on it, not the line count that had been scheduling it for weeks.
 *
 * ⚠ **THE SEAM IS THE SUBJECT, AND THE MESSAGE SHAPES DELIBERATELY STAYED.**
 * `ChannelMessage` is named by `twin-drift.test.ts`'s pair list against
 * `src/features/channels/types.ts`, and `WorkspaceChannelMessage` extends it; a
 * parity gate that has to chase a type between filenames is a gate that gets
 * turned off. Threads are a different subject and nothing in that pair list names
 * them.
 *
 * ⚠ **NO IMPORTER MOVED.** `channel-types.ts` re-exports every name below, which
 * is the arrangement the exemption list itself calls a real split — `channel.ts`,
 * `client-channels.ts` and `index.ts` all still import these from
 * `./channel-types.js`.
 *
 * ⚠ **AND THE SPLIT IS SURFACE-NEUTRAL, BUT THE WAVE IT LANDED IN IS NOT**
 * (Review 37). Moving these four names added and removed nothing: the same
 * identifiers are exported from the same module path as before. Grammar B DID add
 * one new export in the same wave — `ChannelMessageCite`, beside
 * `ChannelMessage.cites` — so the package's export set grew by exactly one name.
 * Saying the surface is unchanged would be wrong by that one.
 */
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * ⚠ TWO RESULT SHAPES ENDED HERE with thread closing (wiring plan Phase 4,
 * 2026-08-18): `ChannelThreadClosed` (thread + `echoSeq`, the seq of the
 * `task_finished` / `task_failed` marker a close posted) and
 * `ChannelThreadCloseProposed` (thread + `markerSeq` + the proposed outcome).
 *
 * The rule they both carried is live on {@link ChannelThreadCreated.openingSeq}
 * and is the reason they existed at all: **a write that also posts a message
 * hands its seq BACK.** Guessing one (last known seq + 1) once armed a hold past
 * a peer reply already in the channel and the wait never returned. `null` means
 * look it up, never "one past the last seq you saw".
 */
