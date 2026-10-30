"use client";

import Link from "next/link";
import { Check, CircleAlert } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import { StatusPill } from "@/shared/ui/status-pill";
import { ThinMeter } from "@/shared/ui/usage-meter";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { dailySeries } from "../_data/activity";
import { issuesFor } from "../_data/issues";
import { CallRow } from "../_components/calls";
import { ALL_LEVELS, HierarchyFilter, matchesHierarchy, type Hierarchy } from "../_components/hierarchy-filter";
import { useCalls, usePortal, useUsers } from "../_components/portal-store";
import { WEEK, activeWithin, figuresOfDevices } from "../_components/stats";
import { BASE, Bars, Card, Cell, PortalPage, Strip, fmt, ov } from "../_components/ui";

interface Step {
  key: string;
  label: string;
  detail: string;
  state: "done" | "attention" | "todo";
  href: string;
  cta: string;
}

function useSteps(): Step[] {
  const { state } = usePortal();
  const users = useUsers();
  const calls = useCalls();
  const keys = state.keys.filter((k) => k.env === state.env && !k.revoked);
  const added = Object.keys(state.integrations).length;
  const first = calls.filter((c) => c.kind === "delivery").at(-1);
  const endpoints = state.endpoints.filter((e) => e.env === state.env);
  const failing = endpoints.find((e) => e.state === "failing");
  return [
    { key: "key", label: "Create an API key", detail: `${keys.length} active keys`, state: keys.length ? "done" : "todo", href: "/keys", cta: "Create key" },
    { key: "add", label: "Add a device", detail: `${added} added`, state: added ? "done" : "todo", href: "/devices", cta: "Open devices" },
    { key: "connect", label: "Connect a user", detail: `${users.length} users connected`, state: users.length ? "done" : "todo", href: "/connect", cta: "Open Connect page" },
    { key: "send", label: "Send a first delivery", detail: first ? `Latest ${first.id}` : "Nothing sent yet", state: first ? "done" : "todo", href: "/playground", cta: "Open playground" },
    {
      key: "webhook",
      label: "Receive a webhook",
      detail: failing ? `${failing.description} is failing` : `${endpoints.length} endpoints healthy`,
      state: failing ? "attention" : endpoints.length ? "done" : "todo",
      href: "/webhooks",
      cta: "Open webhooks",
    },
  ];
}

function Checklist() {
  const steps = useSteps();
  const done = steps.filter((s) => s.state === "done").length;
  return (
    <Card title="First delivery setup" count={`${done} of ${steps.length}`} aside={<ThinMeter used={done} limit={steps.length} className="w-24" />}>
      <ul className={ov.rows}>
        {steps.map((s) => (
          <li key={s.key} className={ov.row}>
            <span className={ov.mark} data-tone={s.state === "attention" ? "over" : undefined}>
              {s.state === "done" ? <Check size={12} aria-hidden="true" /> : s.state === "attention" ? <CircleAlert size={12} aria-hidden="true" /> : null}
            </span>
            <span className={ov.rowMain}>
              <span className={ov.rowTitle}>{s.label}</span>
              <span className={ov.rowMeta}>{s.detail}</span>
            </span>
            {s.state !== "done" && (
              <Link href={BASE + s.href} className={pillButton("outline", "sm")}>
                {s.cta}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function OverviewSection() {
  const router = useRouter();
  const { state } = usePortal();
  const users = useUsers();
  const calls = useCalls();
  const [levels, setLevels] = useState<Hierarchy>(ALL_LEVELS);
  const scopedUsers = users.filter((u) => u.devices.some((d) => matchesHierarchy(d.modelId, levels)));
  const figures = figuresOfDevices(users.flatMap((u) => u.devices).filter((d) => matchesHierarchy(d.modelId, levels)));
  const issues = issuesFor(state.env, state.revoked, Object.keys(state.deviceStates)).filter((i) => !state.mutedIssues.includes(i.id));
  const recent = calls.filter((c) => c.kind === "delivery" && matchesHierarchy(c.modelId, levels)).slice(0, 6);
  return (
    <PortalPage title="Overview" actions={<HierarchyFilter value={levels} onChange={setLevels} />}>
      <Strip label="Health">
        <Cell label="Deliveries, 7 days" value={fmt(figures.deliveries)} href={`${BASE}/activity`} />
        <Cell label="Shown rate" value={`${figures.rate}%`} sub="Seen by device of sent" />
        <Cell label="Active users, 7 days" value={fmt(activeWithin(scopedUsers, WEEK))} of={`/ ${scopedUsers.length}`} href={`${BASE}/users`} />
        <Cell label="Devices online" value={fmt(figures.online)} of={`/ ${figures.devices}`} href={`${BASE}/devices`} />
        <Cell label="Open issues" value={fmt(issues.length)} href={`${BASE}/issues`} />
      </Strip>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3.5">
        <Checklist />
        <div className="flex min-w-0 flex-col gap-3.5">
          <Card title="Deliveries" count="Last 14 days">
            <Bars bars={dailySeries(figures.deliveries, 14)} label="Deliveries per day" />
          </Card>
          <Card title="Recent issues" count={issues.length} aside={<Link href={`${BASE}/issues`} className={pillButton("quiet", "xs")}>All issues</Link>}>
            {issues.length === 0 ? (
              <p className={ov.note}>Nothing needs you.</p>
            ) : (
              <ul className={ov.rows}>
                {issues.slice(0, 3).map((i) => (
                  <li key={i.id} className={cn(ov.row, ov.openRow)}>
                    <span className={ov.rowMain}>
                      <Link href={`${BASE}/issues`} className={cn(ov.open, ov.rowTitle)}>
                        {i.title}
                      </Link>
                      <span className={ov.rowMeta}>
                        {fmt(i.count)} {i.countLabel}, {i.userIds.length} users
                      </span>
                    </span>
                    <StatusPill tone="attention">{i.code}</StatusPill>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <Card title="Latest deliveries" aside={<Link href={`${BASE}/activity`} className={pillButton("quiet", "xs")}>All activity</Link>}>
        <ul className="m-0 flex list-none flex-col">
          {recent.map((c) => (
            <CallRow key={c.id} call={c} onOpen={() => router.push(`${BASE}/activity?call=${c.id}`)} />
          ))}
        </ul>
      </Card>
    </PortalPage>
  );
}
