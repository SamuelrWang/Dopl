"use client";

/**
 * Usage: how much of the plan is used, where it will land by renewal, and what is driving it. Figures
 * follow the Category and Model filters; the plan's limits never do.
 */
import { CreditCard, Download } from "lucide-react";
import { useState } from "react";
import { Button, Card, DataCell, DataRow, DataTable, ICON, MeterFigure, PillMenu, Segmented, StatCard, TwoLine, type Column } from "../_design/ui";
import { BarChart, Limit } from "../_design/ui-data";
import { FillCard, SplitLayout } from "../_design/ui-output";
import { Between, Grow, Page, PageHeader, Stack, StatRow, TableHead, Text, Toast, Toolbar } from "../_design/ui-page";
import { dailySeries } from "../_data/activity";
import { ALL_MODELS, CATEGORIES, categoryOf, modelById, trail, type ModelId } from "../_data/catalog";
import { PLAN } from "../_data/misc";
import { userDeliveries } from "../_data/users";
import { usePortal, useUsers } from "../_components/portal-store";
import { devicesOfModel, figuresOfDevices } from "../_components/stats";
import { fmt } from "../_components/ui";

const RANGES = [{ label: "7 days", days: 7 }, { label: "30 days", days: 30 }, { label: "90 days", days: 90 }];
const BREAKDOWNS = ["Model", "User", "API key"];
const TOP = 8;
const KEY_LIMIT = 20;
const ENDPOINT_LIMIT = 10;
/** The demo is 29 days into a 30-day period. */
const ELAPSED = 29 / 30;
const COLUMNS: Column[] = [
  { key: "name", label: "Name", width: "40%" },
  { key: "calls", label: "Calls, 7d", width: "20%" },
  { key: "detail", label: "Detail", width: "20%" },
  { key: "share", label: "Share", width: "20%" },
];

export function UsageSection() {
  const { state } = usePortal();
  const users = useUsers();
  const [category, setCategory] = useState("all");
  const [modelId, setModelId] = useState("all");
  const [range, setRange] = useState(1);
  const [by, setBy] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const inFilter = (id: ModelId) => (category === "all" || categoryOf(id).id === category) && (modelId === "all" || id === modelId);
  const devices = users.flatMap((u) => u.devices).filter((d) => inFilter(d.modelId));
  const week = figuresOfDevices(devices);
  const month = Math.round(week.deliveries * 3.9);
  const projected = Math.round(month / ELAPSED);
  const over = Math.max(0, projected - PLAN.deliveriesIncluded);
  const series = dailySeries(week.deliveries, RANGES[range].days);
  const models = ALL_MODELS.filter((m) => devicesOfModel(users, m.id).length > 0);

  const rowsOf = () => {
    if (by === 0)
      return models
        .filter((m) => inFilter(m.id))
        .map((m) => {
          const f = figuresOfDevices(devicesOfModel(users, m.id));
          return { id: m.id as string, name: m.name, sub: trail(m.id).slice(0, 2).join(", "), calls: f.deliveries, detail: `${f.users} users` };
        });
    if (by === 1) return users.map((u) => ({ id: u.id, name: u.name, sub: u.id, calls: userDeliveries(u), detail: `${u.devices.length} device${u.devices.length === 1 ? "" : "s"}` }));
    return state.keys.filter((k) => k.env === state.env && !k.revoked).map((k) => ({ id: k.id, name: k.name, sub: k.prefix, calls: k.calls7d, detail: k.kind === "secret" ? "Secret" : "Publishable" }));
  };
  const sorted = rowsOf().sort((a, b) => b.calls - a.calls);
  const total = Math.max(sorted.reduce((n, r) => n + r.calls, 0), 1);

  const exportCsv = () => {
    const csv = ["name,detail,calls_7d", ...sorted.map((r) => `"${r.name}","${r.detail}",${r.calls}`)].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "usage.csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  const keys = state.keys.filter((k) => !k.revoked && k.env === state.env).length;
  const endpoints = state.endpoints.filter((e) => e.env === state.env).length;

  return (
    <Page overlays={notice && <Toast>{notice}</Toast>}>
      <PageHeader
        title="Usage"
        test={state.env === "test"}
        action={
          <Button onClick={exportCsv}>
            <Download {...ICON} aria-hidden="true" />
            Export
          </Button>
        }
      />

      <StatRow>
        <StatCard label="This month" value={fmt(month)} hint={`${Math.round((month / PLAN.deliveriesIncluded) * 100)}% of ${fmt(PLAN.deliveriesIncluded)}`} />
        <StatCard label="Projected" value={fmt(projected)} hint={over > 0 ? `${fmt(over)} over plan` : "Within plan"} />
        <StatCard label="Delivered" value={week.deliveries ? `${week.rate}%` : "None"} hint="Seen by device, 7d" />
        <StatCard label="Next bill" value={PLAN.price.split(" ")[0]} hint={`${PLAN.name}, renews ${PLAN.renewsOn}`} />
      </StatRow>

      <Toolbar>
        <Between>
          <Between>
            <PillMenu label={category === "all" ? "All categories" : CATEGORIES.find((c) => c.id === category)!.name} value={category} options={[{ value: "all", label: "All categories" }, ...CATEGORIES.map((c) => ({ value: c.id, label: c.name }))]} onChange={(v) => { setCategory(v); setModelId("all"); }} />
            <PillMenu label={modelId === "all" ? "All models" : modelById(modelId as ModelId).name} value={modelId} options={[{ value: "all", label: "All models" }, ...models.filter((m) => category === "all" || categoryOf(m.id).id === category).map((m) => ({ value: m.id, label: m.name }))]} onChange={setModelId} />
          </Between>
          <Segmented label="Range" options={RANGES.map((r) => r.label)} value={range} onChange={setRange} />
        </Between>
      </Toolbar>

      <SplitLayout
        wide
        left={
          <FillCard>
            <Text kind="h3">Deliveries</Text>
            <BarChart bars={series} />
          </FillCard>
        }
        right={
          <FillCard>
            <TwoLine title={<Text kind="h3">{PLAN.name} plan</Text>} sub={`${PLAN.price}, renews ${PLAN.renewsOn}`} />
            <Stack>
              <Limit label="Deliveries" used={month} limit={PLAN.deliveriesIncluded} format={fmt} />
              <Limit label="Seats" used={state.members.length} limit={PLAN.seatsIncluded} />
              <Limit label="API keys" used={keys} limit={KEY_LIMIT} />
              <Limit label="Webhook endpoints" used={endpoints} limit={ENDPOINT_LIMIT} />
            </Stack>
            <Grow />
            <Button block onClick={() => setNotice("Demo: would open billing")}>
              <CreditCard {...ICON} aria-hidden="true" />
              Manage plan
            </Button>
          </FillCard>
        }
      />

      <Card flush>
        <TableHead>
          <Text kind="h3">Top by</Text>
          <Segmented label="Break down by" options={BREAKDOWNS} value={by} onChange={setBy} />
        </TableHead>
        <DataTable columns={COLUMNS}>
          {sorted.slice(0, TOP).map((r) => {
            const share = Math.round((r.calls / total) * 100);
            return (
              <DataRow key={r.id}>
                <DataCell>
                  <TwoLine title={r.name} sub={r.sub} />
                </DataCell>
                <DataCell>
                  <Text num>{fmt(r.calls)}</Text>
                </DataCell>
                <DataCell>
                  <Text kind="muted" nowrap>
                    {r.detail}
                  </Text>
                </DataCell>
                <DataCell>
                  <MeterFigure value={share} />
                </DataCell>
              </DataRow>
            );
          })}
        </DataTable>
      </Card>
    </Page>
  );
}
