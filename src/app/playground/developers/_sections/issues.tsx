"use client";

/** Issues: failures grouped by cause, with count, affected users, the fix and mute. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BellOff, ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { pillButton } from "@/shared/ui/pill-button";
import { StatusPill } from "@/shared/ui/status-pill";
import { toast } from "@/shared/ui/toast";
import { issuesFor, type Issue } from "../_data/issues";
import { userById } from "../_data/users";
import { usePortal } from "../_components/portal-store";
import { BASE, Id, PortalPage, UserFace, fmt, ov } from "../_components/ui";

function IssueCard({ issue, muted }: { issue: Issue; muted: boolean }) {
  const router = useRouter();
  const { update } = usePortal();
  const [open, setOpen] = useState(false);
  const fix = () => {
    if (issue.id === "stale_pairing") {
      const stale = issue.userIds.flatMap((id) => userById(id)?.devices.filter((d) => d.state === "stale").map((d) => d.id) ?? []);
      update((s) => ({ ...s, revoked: [...s.revoked, ...stale] }));
      toast({ title: `Revoked ${stale.length} stale pairings` });
    } else if (issue.id === "needs_relink") {
      const stuck = issue.userIds.flatMap((id) => userById(id)?.devices.filter((d) => d.state === "needs_relink").map((d) => d.id) ?? []);
      update((s) => ({ ...s, deviceStates: { ...s.deviceStates, ...Object.fromEntries(stuck.map((d) => [d, "online" as const])) } }));
      toast({ title: `Relink links sent to ${issue.userIds.length} users` });
    } else if (issue.id === "overflow") {
      router.push(`${BASE}/devices/even_realities?tab=receives`);
    } else {
      router.push(`${BASE}/webhooks`);
    }
  };
  return (
    <section className={cn("white-card", ov.card, muted && "opacity-70")} aria-label={issue.title}>
      <div className="flex items-center gap-3">
        <span className={ov.rowMain}>
          <span className="flex items-center gap-2">
            <span className="text-title font-medium text-text-primary">{issue.title}</span>
            {muted ? <StatusPill>Muted</StatusPill> : <StatusPill tone="attention">{issue.code}</StatusPill>}
          </span>
          <span className={ov.rowMeta}>
            {fmt(issue.count)} {issue.countLabel}, {issue.userIds.length} users affected, first seen {issue.firstSeen}
          </span>
        </span>
        <button type="button" className={pillButton("outline", "sm")} onClick={fix}>
          {issue.action}
        </button>
        <button
          type="button"
          aria-pressed={muted}
          className={pillButton("quiet", "sm")}
          onClick={() => update((s) => ({ ...s, mutedIssues: muted ? s.mutedIssues.filter((x) => x !== issue.id) : [...s.mutedIssues, issue.id] }))}
        >
          <BellOff size={12} aria-hidden="true" />
          {muted ? "Unmute" : "Mute"}
        </button>
        <button type="button" aria-expanded={open} className={pillButton("quiet", "sm")} onClick={() => setOpen(!open)}>
          Details
          <ChevronDown size={12} aria-hidden="true" className={open ? "rotate-180" : undefined} />
        </button>
      </div>
      {open && (
        <div className="card-well flex flex-col px-3.5 py-1">
          <ul className={ov.rows}>
            {issue.userIds.map((id) => {
              const user = userById(id);
              if (!user) return null;
              return (
                <li key={id} className={cn(ov.row, ov.openRow)}>
                  <UserFace name={user.name} />
                  <span className={ov.rowMain}>
                    <Link href={`${BASE}/users/${id}`} className={cn(ov.open, ov.rowTitle)}>
                      {user.name}
                    </Link>
                    <Id>{id}</Id>
                  </span>
                </li>
              );
            })}
          </ul>
          {issue.callIds.length > 0 && (
            <Link href={`${BASE}/activity?call=${issue.callIds[0]}`} className={cn(pillButton("outline", "xs"), "my-2 self-start")}>
              Open latest call
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

export function IssuesSection() {
  const { state } = usePortal();
  const issues = issuesFor(state.env, state.revoked, Object.keys(state.deviceStates));
  return (
    <PortalPage title="Issues" meta={<span>Grouped by cause</span>}>
      {issues.length === 0 && <EmptyState variant="outline" title="No open issues" />}
      {issues.map((i) => (
        <IssueCard key={i.id} issue={i} muted={state.mutedIssues.includes(i.id)} />
      ))}
    </PortalPage>
  );
}
