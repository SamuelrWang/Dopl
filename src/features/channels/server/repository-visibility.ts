import "server-only";

/**
 * THE CHANNEL-VISIBILITY PREDICATE, as one PostgREST `or` string.
 *
 * ⚠ **ITS OWN MODULE BECAUSE `repository.ts` IS AT THE 500-LINE CAP** (494 after
 * this extraction, measured 2026-08-22 — it was 498, and a file at the cap does
 * not just stop growing, it stops being correctable). The rule it encodes is
 * §5's, and it has exactly one statement so that "what may this caller see" and
 * "what does the list query ask for" cannot drift apart.
 *
 * THE RULE: a caller sees every PUBLIC channel in the workspace, PLUS every
 * PRIVATE channel they are a member of. ⚠ The soft-delete and archived filters
 * are NOT here — they are `AND` terms the caller applies, and folding them into
 * an `or` string would change the boolean structure of the query.
 */

/**
 * `visibility.eq.public` — plus `id.in.(…)` when the caller belongs to anything.
 *
 * ⚠ **THE EMPTY-ARRAY BRANCH IS LOAD-BEARING, NOT A MICRO-OPTIMIZATION.**
 * PostgREST's `in.()` with no values is a syntax error, so a caller who belongs
 * to no channel would 500 on the plain channel list rather than seeing the
 * workspace's public rooms. The branch is what makes "a brand-new member" a
 * working case.
 *
 * ⚠ SAFE TO INTERPOLATE, AND ONLY BECAUSE OF WHERE THE IDS COME FROM: every id
 * is a `channel_members.channel_id` read back out of the database, i.e. a uuid,
 * so none can carry a comma, a paren or a quote into `or`'s grammar. ⚠ **Never
 * call this with ids that came from a request body.**
 *
 * ⚠ **THIS IS NOT THE AWAIT FENCE.** The workspace-wide hold
 * (`repository-await-workspace.ts › listMemberChannelRefs`) is MEMBERSHIP-ONLY
 * and deliberately does NOT admit public non-member channels — an await is a
 * wake primitive, and being woken by every public room nobody invited you into
 * is noise. Two different questions; do not unify them.
 *
 * ⚠ **`includePublic: false` IS THE GUEST (2026-08-26), AND IT CAN ANSWER
 * `null`.** A guest has no tenancy — see `service-shared.ts ›
 * mayReadPublicChannels` for the argument and
 * `20260826120000_guest_channel_realtime_rls.sql` for the DB half of the same
 * rule. With the public term gone and no memberships, the predicate has NO
 * terms, and `or()` / `in.()` with none is a PostgREST SYNTAX ERROR (a 500 on
 * the plain channel list, the same trap the empty-array branch below exists
 * for). So the empty case is `null` = "this caller may see nothing", which the
 * two callers turn into an empty list rather than a query.
 */
export function visibleChannelsOr(
  memberChannelIds: string[],
  opts: { includePublic?: boolean } = {}
): string | null {
  const parts: string[] = [];
  if (opts.includePublic ?? true) parts.push("visibility.eq.public");
  if (memberChannelIds.length > 0) {
    parts.push(`id.in.(${memberChannelIds.join(",")})`);
  }
  return parts.length > 0 ? parts.join(",") : null;
}
