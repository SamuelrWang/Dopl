import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Environment } from "../types";
import { summarizeUsage, usageBuckets, type UsagePoint, type UsageRange, type UsageSummary } from "../portal/usage";

/**
 * USAGE READS for `/developers/usage` (P3). Service role, server only.
 *
 * 🔒 BILLABLE ONLY: every count reads `dev_billable_events` (W0.2: `dev_events` minus internal
 * orgs), never `dev_events`, so Dopl's own traffic can never show up as a customer's usage.
 * 🔒 REACH: the caller passes project ids it already checked (`listPortalProjects`); an empty list
 * reads nothing.
 *
 * Counts are `head` + `count: exact` per bucket (two per bucket: all calls, and failed ones),
 * run a few at a time. At most 30 buckets, so at most 60 small counts on the
 * `(project_id, env, ts)` index. ⚠ A single grouped SQL aggregate would be one round trip; it
 * needs a migration (an RPC), out of scope for P3 (no prod writes).
 */

const PARALLEL = 8;

async function countRange(input: {
  projectIds: readonly string[];
  env: Environment;
  startIso: string;
  endIso: string;
  failedOnly: boolean;
}): Promise<number> {
  let q = supabaseAdmin()
    .from("dev_billable_events")
    .select("event_id", { count: "exact", head: true })
    .in("project_id", [...input.projectIds])
    .eq("env", input.env)
    .gte("ts", input.startIso)
    .lt("ts", input.endIso);
  if (input.failedOnly) q = q.neq("outcome", "ok");
  const { count, error } = await q;
  if (error) throw new Error(`usage count failed: ${error.message}`);
  return count ?? 0;
}

/** Calls and failed calls per bucket of `range`, over `projectIds` in `env`. */
export async function readUsage(input: {
  projectIds: readonly string[];
  env: Environment;
  range: UsageRange;
  now: Date;
}): Promise<UsageSummary> {
  const buckets = usageBuckets(input.range, input.now);
  if (input.projectIds.length === 0) return summarizeUsage(buckets.map((b) => ({ ...b, calls: 0, failed: 0 })));

  const jobs = buckets.flatMap((b) => [
    () => countRange({ ...input, startIso: b.startIso, endIso: b.endIso, failedOnly: false }),
    () => countRange({ ...input, startIso: b.startIso, endIso: b.endIso, failedOnly: true }),
  ]);
  const results: number[] = new Array(jobs.length);
  for (let i = 0; i < jobs.length; i += PARALLEL) {
    const slice = await Promise.all(jobs.slice(i, i + PARALLEL).map((job) => job()));
    slice.forEach((n, j) => (results[i + j] = n));
  }
  const points: UsagePoint[] = buckets.map((b, i) => ({ ...b, calls: results[2 * i], failed: results[2 * i + 1] }));
  return summarizeUsage(points);
}
