"use client";

/**
 * Overview: is everything working, what should I do next. A project summary leads in the black panel;
 * setup, trends and the newest users sit around it. Fits the window. The questions answer from this
 * page's own figures; no model is involved.
 */
import { ArrowRight, FlaskConical, Paperclip } from "lucide-react";
import { useState } from "react";
import { activeWithin, dailyBars, figuresOfDevices, percentDelta, rateOf, rowsBetween, totalsOf, type EndpointView, type Issue, type MetricRow, type PortalUser } from "@/features/device-sdk/portal/view";
import { Badge, Button, Chip, ICON, Initials, Stat, TwoLine, initialsOf } from "../_design/ui";
import { Banner } from "../_design/ui-extras";
import { BarChart, LineChart, Ring, Timeline, type Step } from "../_design/ui-data";
import { AvatarStack, FillBody, FillCard, FitRows, InkFoot, InkPanel, InkQuote, SplitLayout, StatStrip, ThreeUp } from "../_design/ui-output";
import { Between, FilterRow, Grow, ListRow, Page, PageHeader, Row, Text } from "../_design/ui-page";
import { BASE, fmt, portalNow, since } from "../_components/format";
import { usePortal } from "../_components/portal-store";

const RECENT = 4;
const WEEK_MS = 7 * 86_400_000;
const DAY_MS = 86_400_000;

export interface OverviewProps {
  users: PortalUser[];
  metrics: MetricRow[];
  endpoints: EndpointView[];
  issues: Issue[];
  activeKeys: number;
}

function setupOf({ users, metrics, endpoints, activeKeys }: OverviewProps): (Step & { href: string; cta: string })[] {
  const devices = users.flatMap((u) => u.devices);
  const sent = totalsOf(metrics).deliveries;
  const failing = endpoints.find((e) => e.state === "failing");
  const received = endpoints.some((e) => e.delivered7d > 0);
  return [
    { key: "key", label: "Create an API key", detail: `${activeKeys} active`, state: activeKeys ? "done" : "pending", href: "/keys", cta: "Create key" },
    { key: "add", label: "Connect a device", detail: `${devices.length} connected`, state: devices.length ? "done" : "pending", href: "/connect", cta: "Open Connect" },
    { key: "connect", label: "Connect a user", detail: `${users.length} connected`, state: users.length ? "done" : "pending", href: "/connect", cta: "Open Connect" },
    { key: "send", label: "Send a delivery", detail: sent ? "Sent" : "Nothing yet", state: sent ? "done" : "pending", href: "/playground", cta: "Open Playground" },
    { key: "hook", label: "Receive a webhook", detail: failing ? `${failing.name} failing` : "Nothing yet", state: failing ? "failed" : received ? "done" : "pending", href: "/webhooks", cta: "Open webhooks" },
  ];
}

export function OverviewSection(props: OverviewProps) {
  const { users, metrics, issues } = props;
  const { test, setEnv } = usePortal();
  const [asked, setAsked] = useState<string | null>(null);
  const now = portalNow();
  const figures = figuresOfDevices(users.flatMap((u) => u.devices));
  const week = totalsOf(rowsBetween(metrics, now, 6));
  const before = totalsOf(rowsBetween(metrics, now, 13, 7));
  const rate = rateOf(week);
  const deliveryDelta = percentDelta(week.deliveries, before.deliveries);
  const rateChange = before.deliveries && week.deliveries ? rate - rateOf(before) : null;
  const newUsers = users.filter((u) => now - Date.parse(u.createdAt) <= WEEK_MS).length;
  const seenToday = users.flatMap((u) => u.devices).filter((d) => d.lastSeenAt && now - Date.parse(d.lastSeenAt) <= DAY_MS).length;
  const worst = issues[0];
  const steps = setupOf(props);
  const done = steps.filter((s) => s.state === "done").length;
  const next = steps.find((s) => s.state !== "done");
  const bars = dailyBars(metrics, 14, now);
  const rates = bars.map((b, i) => b.rate ?? bars.slice(0, i).reverse().find((x) => x.rate !== null)?.rate ?? 0);
  const newest = [...users].sort((a, b) => Date.parse(b.lastDeliveryAt ?? "0") - Date.parse(a.lastDeliveryAt ?? "0")).slice(0, RECENT);
  const relink = users.filter((u) => u.devices.some((d) => d.state === "needs_relink"));

  const answers: Record<string, string> = {
    "Why are deliveries failing?": worst ? `${worst.title}: ${fmt(worst.count)} ${worst.countLabel}. ${worst.why}` : "Nothing is failing this week.",
    "Which users need a relink?": relink.length ? relink.slice(0, 3).map((u) => u.name).join(", ") + (relink.length > 3 ? ` and ${relink.length - 3} more.` : ".") : "None.",
    "What changed this week?": `${fmt(week.deliveries)} deliveries against ${fmt(before.deliveries)} the week before. ${newUsers} new ${newUsers === 1 ? "user" : "users"}, ${issues.length} open ${issues.length === 1 ? "issue" : "issues"}.`,
  };
  const summary = `${fmt(week.deliveries)} deliveries this week, ${rate}% taken by a device. ${worst ? `${issues.length} ${issues.length === 1 ? "issue" : "issues"} open; ${worst.title.toLowerCase()} is the largest, with ${fmt(worst.count)} ${worst.countLabel}.` : "Nothing needs you."}`;

  return (
    <Page fit>
      <PageHeader title="Overview" test={test} action={worst && <Button href={`${BASE}/issues`}>{issues.length} open {issues.length === 1 ? "issue" : "issues"}<ArrowRight {...ICON} aria-hidden="true" /></Button>} />
      {test && (
        <Banner icon={FlaskConical} action="Switch to Live" onAction={() => setEnv("live")}>
          Test environment. Nothing here reaches real users.
        </Banner>
      )}
      <StatStrip>
        <Stat label="Deliveries, 7d" value={fmt(week.deliveries)} delta={deliveryDelta?.text} down={deliveryDelta?.down} />
        <Stat label="Delivered" value={`${rate}%`} delta={rateChange === null ? undefined : `${Math.abs(rateChange).toFixed(1)}%`} down={rateChange !== null && rateChange < 0} />
        <Stat label="Active users, 7d" value={fmt(activeWithin(users, WEEK_MS, now))} delta={newUsers ? `${newUsers} new` : undefined} />
        <Stat label="Devices online" value={`${fmt(figures.online)} of ${fmt(figures.devices)}`} hint={`${fmt(seenToday)} seen today`} />
      </StatStrip>
      <FitRows>
        <SplitLayout
          wide
          left={
            <InkPanel fill title="Project summary">
              <InkQuote>{asked ? answers[asked] : summary}</InkQuote>
              {asked && (
                <Text kind="smallMuted" clip>
                  {asked}
                </Text>
              )}
              <FilterRow>
                {Object.keys(answers).map((question) => (
                  <Chip key={question} ring on={asked === question} pressed={asked === question} onClick={() => setAsked(asked === question ? null : question)}>
                    {question}
                  </Chip>
                ))}
              </FilterRow>
              <InkFoot>
                <Button size="sm" variant="ghost" href={`${BASE}/activity`}>
                  <Paperclip {...ICON} aria-hidden="true" />
                  Activity
                </Button>
                <Grow />
                <Text kind="smallMuted">Last 7 days</Text>
              </InkFoot>
            </InkPanel>
          }
          right={
            <FillCard>
              <Row>
                <Ring value={Math.round((done / steps.length) * 100)} label={`${done} of ${steps.length} set up`} />
                <TwoLine title={<Text kind="h3">Setup</Text>} sub={`${done} of ${steps.length} done`} />
              </Row>
              <FillBody>
                <Timeline steps={steps.map((s) => (s.state === "done" ? { ...s, detail: undefined } : s))} />
              </FillBody>
              {next && (
                <Button block href={BASE + next.href}>
                  {next.cta}
                </Button>
              )}
            </FillCard>
          }
        />
        <ThreeUp>
          <FillCard>
            <Between>
              <Text kind="h3">Deliveries</Text>
              <Badge tone="ring">14 days</Badge>
            </Between>
            <BarChart bars={bars} />
          </FillCard>
          <FillCard>
            <Between>
              <TwoLine title={<Text kind="h3">Delivered</Text>} sub={`${rate}% this week`} />
              <Badge tone="ring">14 days</Badge>
            </Between>
            <LineChart values={rates} min={0} max={100} label="Delivered over 14 days" />
          </FillCard>
          <FillCard>
            <Between>
              <Text kind="h3">Recent users</Text>
              <AvatarStack>
                {newest.map((u) => (
                  <Initials key={u.id} small text={initialsOf(u.name)} />
                ))}
              </AvatarStack>
            </Between>
            <FillBody>
              <div>
                {newest.map((u, i) => (
                  <ListRow key={u.id} line={i < newest.length - 1}>
                    <TwoLine title={u.name} sub={u.named ? u.id : undefined} />
                    <Grow />
                    <Text kind="smallMuted" nowrap>
                      {since(u.lastDeliveryAt)}
                    </Text>
                  </ListRow>
                ))}
              </div>
            </FillBody>
          </FillCard>
        </ThreeUp>
      </FitRows>
    </Page>
  );
}
