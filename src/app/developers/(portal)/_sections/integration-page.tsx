"use client";

/**
 * One device integration: how it is doing, then the panels that describe it. Overview summarises, What it
 * receives and Capabilities show the rules in force, Calls and Users show it in use.
 */
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { categoryById, type Integration, type ModelId } from "@/features/device-sdk/portal/catalog";
import { LOW_RATE, STATUS_LABEL, counted, dailyBars, devicesOfIntegration, devicesOfModel, figuresOfDevices, type Call, type MetricRow, type PortalUser } from "@/features/device-sdk/portal/view";
import { Badge, Button, Card, DataCell, DataRow, DataTable, ICON, MeterFigure, PillMenu, Segmented, StatCard, TwoLine, type Column } from "../_design/ui";
import { BarChart } from "../_design/ui-data";
import { FillCard, SplitLayout } from "../_design/ui-output";
import { Between, Breadcrumbs, Grow, Mark, Page, Row, Stack, StatRow, TableHead, Text } from "../_design/ui-page";
import { CategoryGlyph } from "../_components/category-glyph";
import { BASE, fmt, portalNow, since } from "../_components/format";
import { CallsBrowser, STATUS_TONE } from "./activity";
import { CapabilitiesTab, type RulesOfModel } from "./integration-capabilities";
import { ReceivesTab } from "./receives";
import { UserSheet } from "./users-sheet";
import { UsersTable } from "./users-table";
import { sortUsers, type Sort } from "./users-model";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "receives", label: "What it receives" },
  { key: "capabilities", label: "Capabilities" },
  { key: "calls", label: "Calls" },
  { key: "users", label: "Users" },
];
const MODEL_COLUMNS: Column[] = [
  { key: "name", label: "Model", width: "34%" },
  { key: "firmware", label: "Firmware", width: "26%" },
  { key: "users", label: "Users", width: "14%" },
  { key: "rate", label: "Delivered, 7d", width: "26%" },
];
const CALL_COLUMNS: Column[] = [
  { key: "call", label: "Latest calls", width: "62%" },
  { key: "status", label: "Status", width: "24%" },
  { key: "at", label: "When", width: "14%" },
];

export function IntegrationPageSection({ integration, users, calls, metrics, rules, initialTab, initialModel }: { integration: Integration; users: PortalUser[]; calls: Call[]; metrics: MetricRow[]; rules: RulesOfModel; initialTab?: string; initialModel?: string }) {
  const category = categoryById(integration.categoryId);
  const crumbs = [{ label: "Devices", href: `${BASE}/devices` }, { label: category.name, href: `${BASE}/devices` }, { label: integration.name }];
  const [model, setModel] = useState<ModelId>(integration.models.find((m) => m.id === initialModel)?.id ?? integration.models[0].id);
  const [tab, setTab] = useState(TABS.some((t) => t.key === initialTab) ? initialTab! : "overview");
  const [openCall, setOpenCall] = useState<string | undefined>();
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>({ key: "delivery", dir: -1 });
  const [page, setPage] = useState(1);

  const head = (
    <Stack>
      <Breadcrumbs items={crumbs} />
      <Between>
        <Row>
          <Mark tone="ink">
            <CategoryGlyph id={integration.categoryId} size={ICON} />
          </Mark>
          <TwoLine title={<Text kind="title" as="h1">{integration.name}</Text>} sub={integration.adapter} />
        </Row>
        {integration.models.length > 1 && <PillMenu stable label={integration.models.find((m) => m.id === model)!.name} value={model} options={integration.models.map((m) => ({ value: m.id, label: m.name }))} onChange={(id) => setModel(id as ModelId)} />}
      </Between>
    </Stack>
  );
  const devices = devicesOfIntegration(users, integration.id);
  const ids = new Set(devices.map((d) => d.id));
  const figures = figuresOfDevices(devices);
  const scoped = calls.filter((c) => c.modelId && integration.models.some((m) => m.id === c.modelId));
  const modelCalls = scoped.filter((c) => c.modelId === model);
  const modelUsers = sortUsers(users.filter((u) => u.devices.some((d) => d.modelId === model)), sort);
  const selected = modelUsers.find((u) => u.id === openUser) ?? null;
  const bars = dailyBars(metrics.filter((m) => m.device !== null && ids.has(m.device)), 14, portalNow());
  const tabs = <Segmented label="Device sections" options={TABS.map((t) => t.label)} value={TABS.findIndex((t) => t.key === tab)} onChange={(i) => setTab(TABS[i].key)} />;

  if (tab === "calls") {
    return (
      <Page fit>
        {head}
        {tabs}
        <CallsBrowser key={openCall ?? model} calls={modelCalls} users={users} initial={{ call: openCall }} />
      </Page>
    );
  }

  return (
    <Page overlays={selected && <UserSheet user={selected} onClose={() => setOpenUser(null)} />}>
      {head}
      {tabs}
      {tab === "overview" && (
        <>
          <StatRow>
            <StatCard label="Connected users" value={fmt(figures.users)} hint={counted(figures.devices, "device")} />
            <StatCard label="Devices online" value={fmt(figures.online)} hint={`of ${fmt(figures.devices)}`} />
            <StatCard label="Deliveries, 7d" value={fmt(figures.deliveries)} hint={`${fmt(figures.delivered)} taken by a device`} />
            <StatCard label="Delivered" value={figures.deliveries ? `${figures.rate}%` : "None"} hint="Taken by a device, of sent" />
          </StatRow>
          <SplitLayout
            wide
            left={
              <FillCard>
                <Text kind="h3">Deliveries</Text>
                <BarChart bars={bars} />
              </FillCard>
            }
            right={
              <FillCard>
                <Text kind="h3">Rules</Text>
                <Between>
                  <Text>In force</Text>
                  <Badge tone="ok" dot>{rules.profileId} v{rules.profileVersion}</Badge>
                </Between>
                <Grow />
                <Button block onClick={() => setTab("receives")}>
                  View rules
                </Button>
              </FillCard>
            }
          />
          <Card flush>
            <DataTable columns={MODEL_COLUMNS}>
              {integration.models.map((m) => {
                const mine = devicesOfModel(users, m.id);
                const f = figuresOfDevices(mine);
                return (
                  <DataRow key={m.id} selected={m.id === model} onClick={() => setModel(m.id)}>
                    <DataCell>
                      <TwoLine title={m.name} sub={`${m.capabilities.length} capabilities`} />
                    </DataCell>
                    <DataCell>
                      <Text clip>{[...new Set(mine.map((d) => d.firmware).filter(Boolean))].join(", ") || "None reported"}</Text>
                    </DataCell>
                    <DataCell>
                      <Text num>{fmt(f.users)}</Text>
                    </DataCell>
                    <DataCell>{f.deliveries ? <MeterFigure value={Math.round(f.rate)} low={f.rate < LOW_RATE} /> : <Text kind="faint">None</Text>}</DataCell>
                  </DataRow>
                );
              })}
            </DataTable>
          </Card>
          {scoped.length > 0 && (
            <Card flush>
              <DataTable columns={CALL_COLUMNS}>
                {scoped.slice(0, 6).map((c) => (
                  <DataRow
                    key={c.id}
                    onClick={() => {
                      setOpenCall(c.id);
                      if (c.modelId) setModel(c.modelId);
                      setTab("calls");
                    }}
                  >
                    <DataCell>
                      <TwoLine title={c.title} sub={c.capability ?? undefined} />
                    </DataCell>
                    <DataCell>
                      <Badge tone={STATUS_TONE[c.status] ?? "neutral"} dot>
                        {STATUS_LABEL[c.status]}
                      </Badge>
                    </DataCell>
                    <DataCell>
                      <Text nowrap>{since(c.at)}</Text>
                    </DataCell>
                  </DataRow>
                ))}
              </DataTable>
              <TableHead>
                <Grow />
                <Button size="sm" variant="ghost" onClick={() => setTab("calls")}>
                  All calls
                  <ChevronRight {...ICON} aria-hidden="true" />
                </Button>
              </TableHead>
            </Card>
          )}
        </>
      )}
      {tab === "receives" && <ReceivesTab rules={rules} />}
      {tab === "capabilities" && <CapabilitiesTab rules={rules} />}
      {tab === "users" && <UsersTable rows={modelUsers} sort={sort} page={page} openId={openUser} onSort={setSort} onPage={setPage} onOpen={setOpenUser} />}
    </Page>
  );
}
