/**
 * WHAT A MESSAGE LINE CLAIMS ABOUT ITS EXCHANGE AND ITS AUTHOR — F4 and F2.
 *
 * F4 — A SYNTHETIC `task-<channel>-<seq>` ID IS NOT A THREAD. It is the label a
 * RECEIVING desktop mints for an untagged request so the reply groups with it on
 * that machine's card (deterministic from `(channel, seq)`), and the mechanism is
 * correct and stays: killing it would strand every untagged exchange. What was
 * wrong is that it rendered IDENTICALLY to a real thread — same `· thread <tag>`,
 * same legend entry, same "continue this thread with thread=<id>" instruction —
 * so an agent could not tell a shared, titled, closable thread from one machine's
 * private grouping label, and was told to post into the latter as if it were the
 * former. Only the LABEL changed.
 *
 * F2 — AN AUTHOR LABEL NAMES AN ACCOUNT, NOT A PROCESS. One `channel_agents` row
 * can be claimed by several concurrent sessions (the desktop's ROOM and PAIR
 * slots are disjoint by design), and two of them gave a peer contradictory
 * instructions 79 seconds apart with nothing on the wire able to attribute
 * either. The `· session <tag>` suffix is that attribution — emitted only when
 * the message carries the server's stamp, so an unstamped transcript renders
 * exactly as it always did.
 *
 * Both are RENDER-side; the stamps themselves are pinned server-side
 * (`service-writes-metadata-session.test.ts`).
 */
export {};
