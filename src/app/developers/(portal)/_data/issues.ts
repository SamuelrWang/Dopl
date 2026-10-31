/** Failures grouped by cause, computed from the same users and calls every other page reads. */
import type { Env } from "./company";
import { ALL_CALLS } from "./activity";
import { ALL_USERS, hasStale, needsRelink } from "./users";

export type IssueId = "stale_pairing" | "needs_relink" | "overflow" | "webhook_failing";

export interface Issue {
  id: IssueId;
  title: string;
  code: string;
  count: number;
  countLabel: string;
  userIds: string[];
  callIds: string[];
  action: string;
  firstSeen: string;
}

const OVERFLOW_USERS = ["tech_1084", "tech_1058", "tech_1128", "tech_1155"];
const WEBHOOK_USERS = ["tech_1204", "tech_1042", "tech_1120", "tech_1149", "tech_1173"];

/** `revoked` and `fixed` are this session's device ids; a resolved device stops counting. */
export function issuesFor(env: Env, revoked: readonly string[] = [], fixed: readonly string[] = []): Issue[] {
  if (env === "test") return [];
  const users = ALL_USERS.filter((u) => u.env === env).map((u) => ({
    ...u,
    devices: u.devices.filter((d) => !revoked.includes(d.id) && !fixed.includes(d.id)),
  }));
  const stale = users.filter(hasStale);
  const relink = users.filter(needsRelink);
  const refused = (state: string) =>
    users.flatMap((u) => u.devices).filter((d) => d.state === state).reduce((n, d) => n + d.deliveries7d - d.seen7d, 0);
  const calls = (pred: (c: (typeof ALL_CALLS)[number]) => boolean) => ALL_CALLS.filter((c) => c.env === env && pred(c)).map((c) => c.id);
  return [
    {
      id: "stale_pairing",
      title: "Stale pairings",
      code: "device_offline",
      count: refused("stale"),
      countLabel: "refused sends",
      userIds: stale.map((u) => u.id),
      callIds: calls((c) => c.candidates.some((x) => x.verdict === "refused" && x.reason.startsWith("device_offline"))),
      action: "Revoke the stale pairings",
      firstSeen: "19 days ago",
    },
    {
      id: "needs_relink",
      title: "Needs relink",
      code: "needs_reauth",
      count: refused("needs_relink"),
      countLabel: "failed deliveries",
      userIds: relink.map((u) => u.id),
      callIds: calls((c) => c.errorCode === "needs_reauth"),
      action: "Send relink links",
      firstSeen: "3 days ago",
    },
    {
      id: "overflow",
      title: "Messages over the limit",
      code: "overflow.truncate",
      count: 63,
      countLabel: "truncated this week",
      userIds: OVERFLOW_USERS,
      callIds: calls((c) => c.truncated !== null),
      action: "Review length rules",
      firstSeen: "6 days ago",
    },
    {
      id: "webhook_failing",
      title: "Webhook endpoint failing",
      code: "HTTP 500",
      count: 148,
      countLabel: "failed attempts",
      userIds: WEBHOOK_USERS,
      callIds: calls((c) => c.kind === "webhook" && c.status !== "ok"),
      action: "Open the endpoint",
      firstSeen: "13 hours ago",
    },
  ].filter((issue) => issue.count > 0 && issue.userIds.length > 0) as Issue[];
}
