/**
 * The `to=` address set of a post, as a grouping key. The recipient pill that once rendered it
 * beside an agent's attribution pill is gone (Samuel, 2026-10-08): a person addressed is now
 * @-tagged inline in the body and the server counts `to=` members as mentions.
 */

/**
 * The address set as one comparable string; `view-model-rows.ts › isContinuation` breaks a run on
 * it, since a run shows one pill. Order-insensitive and deduped; absent (`?`) stays distinct from
 * `[]` so legacy rows group unchanged.
 */
export function addressKey(recipients: {
  agentIds?: readonly string[] | null;
  userIds?: readonly string[] | null;
}): string {
  const part = (ids: readonly string[] | null | undefined): string =>
    ids === null || ids === undefined ? "?" : [...new Set(ids)].sort().join(",");
  return `${part(recipients.agentIds)}|${part(recipients.userIds)}`;
}
