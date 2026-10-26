// POST-METADATA SHAPES — the result and the server-internal options.
//
// WHY THIS FILE EXISTS: `service-writes-metadata.ts` crossed the §2 500-line cap (529) and the
// cap is `error` with no exemptions on `src/**`, so `npm run lint` was red. ⚠ THE FILE WAS AT
// EXACTLY 500 at the 2026-10-11 review base, so the 29 lines that took it over were the whole
// of its headroom — the second file that night to be parked on the boundary and pushed off it by
// an ordinary fix. (Framework note from that review: split anything already ≥480 that you touch.)
//
// WHAT IS HERE: two interface declarations and their doc comments, moved VERBATIM. No runtime
// code, so the split cannot change behaviour — the import on the other side is `import type`,
// erased at compile time, and there is no new runtime edge in either direction.
//
// Both are consumed only by `service-writes-metadata.ts › resolvePostMetadata`'s signature;
// callers pass and read these shapes structurally and import neither, which is why moving them
// moves no call site.

/**
 * Stored `metadata`.
 *
 * ⚠ IT CARRIED A SECOND FIELD, `threadClosed`, until thread closing was removed
 * (wiring plan Phase 4, 2026-08-18): the thread row is resolved here and nowhere
 * else on the write path, so this was the only place that could see a post
 * landing in a closed thread, and the notice rode out to the caller (and into the
 * MCP `post` result). With no closer left, the only threads it could ever fire on
 * are legacy ones — the column is unread now, so the notice went with it.
 */
export interface PostMetadataResult {
  metadata: Record<string, unknown>;
  /**
   * **A THREAD TAG THE POSTER WAS NOT ENTITLED TO, DROPPED** (2026-09-02, v2
   * wave B slice B4 — ruling B1). Only the LEGACY (`thread-<channelId>-<seq>`)
   * arm can produce it; the first-class uuid arm 403s instead.
   *
   * ⚠ **IT IS REPORTED RATHER THAN MERELY DONE, AND THE READER IS THE VERDICT.**
   * A stripped tag leaves a message that LOOKS like a plain main-room post, and
   * the resilience arms would then repair its address as if the author had meant
   * to talk to the room. The author meant to talk to a thread they are not in.
   * So `service-wake-verdict.ts` answers `delivery=none` for it and repairs
   * nothing — the distinction A6 introduced, surfaced, not invented here.
   *
   * ⚠ Still NEVER a throw: the installed desktop posts these ids for lifecycle
   * events, some against openers with no `to_user_id` at all, and a 403 would
   * reject real posts from the field.
   */
  threadTagStripped: boolean;
  /**
   * **THE MEMBER HANDLES FOLD 9 ALREADY DERIVED**, carried out for the agent door to mint
   * around (2026-09-07, Samuel's suffix ruling: members outrank agents).
   *
   * ⚠ **THE READER IS THE VERDICT, AND IT IS HERE FOR THE SAME REASON `threadTagStripped` IS.**
   * `service-wake-verdict.ts` runs after this fold and reads its output; the member namespace is
   * a fact this fold established off reads this request has already paid for, and re-deriving it
   * one function later would mean a second `channel_members` + `profiles` pair on the hot write
   * path for a body that already loaded both.
   *
   * ⚠ **EMPTY FOR EVERY POST THAT TAGS NOBODY**, which is the common one and the one that reads
   * no roster at all — see `service-writes-metadata-mentions.ts › BodyMentions`.
   */
  memberHandles: string[];
  /**
   * **THIS SERVER GUESSED THE `escalationAnswer` KEY OFF THE BODY** (fold 11b),
   * rather than the caller sending it (2026-09-06).
   *
   * ⚠ **THE READER IS THE INSERT, AND IT EXISTS SO A RACE CANNOT FAIL A PLAIN
   * SENTENCE.** The typed door's "most recent OPEN card" is a read; the one
   * answer per escalation is enforced by a partial unique index at commit. A
   * press landing in between makes this member's ordinary message 23505 —
   * 11b's own docblock promises it "can only ever ADD a stamp, never refuse a
   * post", and without this flag the write could not keep that promise.
   * `service-writes.ts` drops the key and re-inserts, silently, exactly as
   * every other near miss is silent.
   *
   * ⚠ **NEVER TRUE FOR A PRESSED ANSWER.** `input.escalationAnswer` is the
   * caller's own decision and a lost race there is a 409 with a sentence — the
   * two doors differ here on purpose, because only one of them was a guess.
   */
  typedEscalationAnswer: boolean;
}

/**
 * Server-internal inputs to the metadata fold — no HTTP caller can supply
 * these; they are not fields of `ChannelMessageCreateInput` and no route parses
 * them.
 *
 * ⚠ TWO OPTIONS ENDED HERE with thread closing (Phase 4, 2026-08-18):
 * `closeProposal` (stamped the close-proposal marker keys for the deleted
 * `proposeThreadClose`) and `reopened` (stamped `threadReopened` for the deleted
 * `reopenThread`).
 */
export interface PostMetadataOptions {
  /**
   * Stamp reserved `metadata.handoff` true. Only caller:
   * `service-threads.createThread`, forwarding validated `ThreadCreateInput.handoff`.
   * ⚠ Reserved on the runtime stamp's terms — desktop reads it to decide whether
   * to open a requester window, so it must never be caller-settable.
   */
  handoff?: boolean;
  /**
   * Stamp reserved `metadata.fanoutGroup` with this id. Only caller:
   * `service-threads-broadcast.ts › createThreadFanOut` (through
   * `service-threads.ts › createThread`), which derives it server-side from the
   * channel, the creator and the validated base idempotency key.
   *
   * ⚠ Reserved on the handoff stamp's terms — the transcript renders every
   * opening message sharing a group id as ONE card, so a caller able to set it
   * could splice its own thread into somebody else's request.
   */
  fanoutGroupId?: string;
  /** Checked addressees stamped as mentions, and those the body must @-tag (2026-10-08). */
  addressedUserIds?: readonly string[];
  mustTagUserIds?: readonly string[];
  /** Stamp reserved `metadata.taskId`. Only caller: `service-tasks-assign.ts`, via `postMessage`. */
  taskId?: string;
}
