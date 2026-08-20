/** Rebuild a page's `searchParams` into a query string for a redirect target.
 *  Shared by the `/login` and `/signup` redirectors — the query MUST ride along
 *  (`?redirectTo=`, `installCluster`) or a deep link dies at the sign-in wall. */
export function forwardQuery(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      query.append(key, one);
    }
  }
  return query;
}
