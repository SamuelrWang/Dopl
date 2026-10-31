/**
 * Issues are computed on read, one group per cause: nothing stores them, so none can go stale. Pure.
 * A group's copy says what the data shows and no more. First seen is capped by the 30-day event retention.
 */
import type { EndpointView, Issue, PortalUser } from "./view";

export interface ErrorRow {
  event_id: string;
  ts: string;
  error_code: string | null;
  external_user_id: string | null;
}

const USERS = "/users";
const WEBHOOKS = "/webhooks";
const ACTIVITY = "/activity";

const WHY: Record<string, string> = {
  device_offline: "The device was not online when the call arrived, so it was refused.",
  grant_missing: "The user has not granted this capability on the device that was targeted.",
  grant_expired: "The user's grant ran out. Nothing reaches the device until they link it again.",
  capability_unsupported: "The call asked the device for something its adapter does not offer.",
  rate_limited: "Calls went over the rate limit and were refused.",
  vendor_error: "The device's own transport failed while sending.",
};
const TITLE: Record<string, string> = {
  device_offline: "Devices offline when called",
  grant_missing: "Capability not granted",
  grant_expired: "Grants expired",
  capability_unsupported: "Capability not supported",
  rate_limited: "Rate limited",
  vendor_error: "Device transport failed",
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function computeIssues(input: { users: readonly PortalUser[]; errors: readonly ErrorRow[]; endpoints: readonly EndpointView[] }): Issue[] {
  const issues: Issue[] = [];
  const withState = (state: "stale" | "needs_relink") => input.users.filter((u) => u.devices.some((d) => d.state === state));
  const count = (state: "stale" | "needs_relink") => input.users.reduce((n, u) => n + u.devices.filter((d) => d.state === state).length, 0);

  const stale = withState("stale");
  if (stale.length > 0) {
    issues.push({
      id: "stale_pairing",
      kind: "stale_pairing",
      title: "Stale pairings",
      code: "stale",
      count: count("stale"),
      countLabel: count("stale") === 1 ? "device" : "devices",
      why: "These devices still have a live connection but have not been seen for 14 days or more.",
      firstSeen: null,
      userIds: stale.map((u) => u.id),
      latestCallId: null,
      action: { label: "Open users", href: USERS },
    });
  }
  const relink = withState("needs_relink");
  if (relink.length > 0) {
    issues.push({
      id: "needs_relink",
      kind: "needs_relink",
      title: "Needs relink",
      code: "needs_reauth",
      count: count("needs_relink"),
      countLabel: count("needs_relink") === 1 ? "device" : "devices",
      why: "These connections need the user to link the device again. Nothing reaches them until then.",
      firstSeen: null,
      userIds: relink.map((u) => u.id),
      latestCallId: null,
      action: { label: "Open users", href: USERS },
    });
  }

  const groups = new Map<string, ErrorRow[]>();
  for (const e of input.errors) {
    const code = e.error_code ?? "internal_error";
    groups.set(code, [...(groups.get(code) ?? []), e]);
  }
  for (const [code, rows] of groups) {
    const newest = rows.reduce((a, b) => (a.ts > b.ts ? a : b));
    const oldest = rows.reduce((a, b) => (a.ts < b.ts ? a : b));
    issues.push({
      id: `error:${code}`,
      kind: "error_code",
      title: TITLE[code] ?? code.replaceAll("_", " "),
      code,
      count: rows.length,
      countLabel: rows.length === 1 ? "call in 7 days" : "calls in 7 days",
      why: WHY[code] ?? "Calls failed with this error.",
      firstSeen: oldest.ts,
      userIds: [...new Set(rows.map((r) => r.external_user_id).filter((v): v is string => v !== null))],
      latestCallId: newest.event_id,
      action: { label: "Open activity", href: ACTIVITY },
    });
  }

  for (const e of input.endpoints) {
    if (e.state !== "failing") continue;
    issues.push({
      id: `webhook:${e.id}`,
      kind: "webhook_failing",
      title: `${e.name} failing`,
      code: "webhook",
      count: e.failed7d,
      countLabel: e.failed7d === 1 ? "failed event in 7 days" : "failed events in 7 days",
      why: `This endpoint keeps failing, so these events never reach it. ${plural(e.delivered7d, "event")} got through.`,
      firstSeen: null,
      userIds: [],
      latestCallId: null,
      action: { label: "Open webhooks", href: WEBHOOKS },
    });
  }
  return issues.sort((a, b) => b.count - a.count);
}
