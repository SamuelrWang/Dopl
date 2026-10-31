"use client";

/**
 * Overview: is everything working, what should I do next. A project summary leads in the black panel;
 * setup, trends and the newest users sit around it. Fits the window.
 */
import { ArrowRight, FlaskConical, Info, Paperclip } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Chip, ICON, Initials, Stat, TwoLine, initialsOf } from "../_design/ui";
import { Banner } from "../_design/ui-extras";
import { BarChart, LineChart, Ring, Timeline, type Step } from "../_design/ui-data";
import { AvatarStack, FillBody, FillCard, FitRows, InkFoot, InkPanel, InkPrompt, InkQuote, SplitLayout, StatStrip, ThreeUp } from "../_design/ui-output";
import { Between, FilterRow, Grow, ListRow, Page, PageHeader, Row, Text } from "../_design/ui-page";
import { dailySeries } from "../_data/activity";
import { issuesFor } from "../_data/issues";
import { useCalls, usePortal, useUsers } from "../_components/portal-store";
import { WEEK, activeWithin, figuresOfUsers } from "../_components/stats";
import { BASE, fmt, since } from "../_components/ui";

const RECENT = 4;
const QUESTIONS = ["Why are deliveries failing?", "Which users need a relink?", "What changed this week?"];

function useSetup(): (Step & { href: string; cta: string })[] {
  const { state } = usePortal();
  const users = useUsers();
  const calls = useCalls();
  const keys = state.keys.filter((k) => k.env === state.env && !k.revoked);
  const added = Object.keys(state.integrations).length;
  const first = calls.find((c) => c.kind === "delivery");
  const endpoints = state.endpoints.filter((e) => e.env === state.env);
  const failing = endpoints.find((e) => e.state === "failing");
  return [
    { key: "key", label: "Create an API key", detail: `${keys.length} active`, state: keys.length ? "done" : "pending", href: "/keys", cta: "Create key" },
    { key: "add", label: "Add a device", detail: `${added} added`, state: added ? "done" : "pending", href: "/devices", cta: "Open devices" },
    { key: "connect", label: "Connect a user", detail: `${users.length} connected`, state: users.length ? "done" : "pending", href: "/connect", cta: "Open Connect" },
    { key: "send", label: "Send a delivery", detail: first ? "Sent" : "Nothing yet", state: first ? "done" : "pending", href: "/playground", cta: "Open Playground" },
    { key: "hook", label: "Receive a webhook", detail: failing ? `${failing.description} failing` : `${endpoints.length} healthy`, state: failing ? "failed" : endpoints.length ? "done" : "pending", href: "/webhooks", cta: "Open webhooks" },
  ];
}

export function OverviewSection() {
  const { state, update } = usePortal();
  const users = useUsers();
  const [hidBanner, setHidBanner] = useState(false);
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const figures = figuresOfUsers(users);
  const issues = issuesFor(state.env, state.revoked, Object.keys(state.deviceStates)).filter((i) => !state.mutedIssues.includes(i.id));
  const worst = [...issues].sort((a, b) => b.count - a.count)[0];
  const steps = useSetup();
  const done = steps.filter((s) => s.state === "done").length;
  const next = steps.find((s) => s.state !== "done");
  const series = dailySeries(figures.deliveries, 14);
  const rate = series.map((_, i) => figures.rate - 1 + Math.sin(i * 0.9) * 0.9 + (i / series.length) * 1.2);
  const newest = [...users].sort((a, b) => Date.parse(b.lastDeliveryAt ?? "0") - Date.parse(a.lastDeliveryAt ?? "0")).slice(0, RECENT);
  const summary = `${fmt(figures.deliveries)} deliveries this week, ${figures.rate}% seen by a device. ${issues.length ? `${issues.length} issues open; ${worst.title.toLowerCase()} is the largest, with ${fmt(worst.count)} ${worst.countLabel}.` : "Nothing needs you."}`;
  const answer = worst ? `Most of the loss comes from ${worst.title.toLowerCase()}: ${fmt(worst.count)} ${worst.countLabel} across ${worst.userIds.length} users. ${worst.action} to clear it.` : "Nothing is failing this week.";

  return (
    <Page fit>
      <PageHeader title="Overview" test={state.env === "test"} action={worst && <Button href={`${BASE}/issues`}>{issues.length} open issues<ArrowRight {...ICON} aria-hidden="true" /></Button>} />
      {state.env === "test" ? (
        <Banner icon={FlaskConical} action="Switch to Live" onAction={() => update((s) => ({ ...s, env: "live" }))}>
          Test environment. Nothing here reaches real users.
        </Banner>
      ) : (
        !hidBanner && (
          <Banner icon={Info} onClose={() => setHidBanner(true)}>
            Scheduled maintenance on Saturday, 02:00 to 04:00 UTC
          </Banner>
        )
      )}
      <StatStrip>
        <Stat label="Deliveries, 7d" value={fmt(figures.deliveries)} delta="6.1%" />
        <Stat label="Shown rate" value={`${figures.rate}%`} delta="0.8%" />
        <Stat label="Active users, 7d" value={fmt(activeWithin(users, WEEK))} delta="3 new" />
        <Stat label="Devices online" value={`${fmt(figures.online)} of ${fmt(figures.devices)}`} delta="2 fewer" down />
      </StatStrip>
      <FitRows>
        <SplitLayout
          wide
          left={
            <InkPanel fill title="Project summary">
              <InkQuote>{asked ? answer : summary}</InkQuote>
              {asked && (
                <Text kind="smallMuted" clip>
                  {asked}
                </Text>
              )}
              <InkPrompt
                value={q}
                placeholder="Ask about this project"
                send="Ask"
                onChange={setQ}
                onSend={() => {
                  setAsked(q.trim());
                  setQ("");
                }}
              />
              <FilterRow>
                {QUESTIONS.map((question) => (
                  <Chip key={question} ring onClick={() => setAsked(question)}>
                    {question}
                  </Chip>
                ))}
              </FilterRow>
              <InkFoot>
                <Button size="sm" variant="ghost" href={`${BASE}/activity`}>
                  <Paperclip {...ICON} aria-hidden="true" />
                  Use activity logs
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
            <BarChart bars={series} />
          </FillCard>
          <FillCard>
            <Between>
              <TwoLine title={<Text kind="h3">Shown rate</Text>} sub={`${figures.rate}% this week`} />
              <Badge tone="ring">14 days</Badge>
            </Between>
            <LineChart values={rate} min={85} max={100} label="Shown rate over 14 days" />
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
                    <TwoLine title={u.name} sub={u.id} />
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
