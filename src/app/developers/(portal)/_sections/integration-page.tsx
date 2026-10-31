"use client";

/**
 * One device integration: how it is doing, then the panels that shape it. Overview summarises, What it
 * receives sets the rules, Capabilities sets what it may do, Calls and Users show it in use.
 */
import { CAPABILITY_RISK_TIER } from "@dopl/device-contracts";
import { ChevronRight, FlaskConical } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, DataCell, DataRow, DataTable, ICON, MeterFigure, PillMenu, Segmented, StatCard, TwoLine, type Column } from "../_design/ui";
import { BarChart, Limit } from "../_design/ui-data";
import { FillCard, SplitLayout } from "../_design/ui-output";
import { Between, Breadcrumbs, CardSection, ChipRow, Grow, Mark, Page, Row, Stack, StatRow, TableHead, Text, Toast } from "../_design/ui-page";
import { STATUS_LABEL, dailySeries } from "../_data/activity";
import { categoryById, integrationById, type ModelId } from "../_data/catalog";
import { useCalls, usePortal, useUsers } from "../_components/portal-store";
import { devicesOfIntegration, devicesOfModel, figuresOfDevices } from "../_components/stats";
import { BASE, fmt, since } from "../_components/ui";
import { CategoryGlyph } from "../_components/category-glyph";
import { testDelivery } from "../_components/test-delivery";
import { CallsBrowser, STATUS_TONE } from "./activity";
import { CapabilitiesTab } from "./integration-capabilities";
import { ReceivesTab, useReceivesEditor } from "./receives";
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
  { key: "shown", label: "Shown, 7d", width: "26%" },
];
const CALL_COLUMNS: Column[] = [
  { key: "call", label: "Latest calls", width: "62%" },
  { key: "status", label: "Status", width: "24%" },
  { key: "at", label: "When", width: "14%" },
];

export function IntegrationPageSection({ integrationId, initialTab, initialModel }: { integrationId: string; initialTab?: string; initialModel?: string }) {
  const integration = integrationById(integrationId)!;
  const category = categoryById(integration.categoryId);
  const { state, update } = usePortal();
  const added = state.integrations[integration.id];
  const crumbs = [{ label: "Devices", href: `${BASE}/devices` }, { label: category.name, href: `${BASE}/devices` }, { label: integration.name }];
  const [model, setModel] = useState<ModelId>(integration.models.find((m) => m.id === initialModel)?.id ?? integration.models[0].id);
  const [tab, setTab] = useState(TABS.some((t) => t.key === initialTab) ? initialTab! : "overview");
  const [openCall, setOpenCall] = useState<string | undefined>();
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>({ key: "delivery", dir: -1 });
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const users = useUsers();
  const calls = useCalls();
  const editor = useReceivesEditor(integration.categoryId, model);
  const say = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((now) => (now === text ? null : now)), 3200);
  };

  const head = (
    <Stack>
      <Breadcrumbs items={crumbs} />
      <Between>
        <Row>
          <Mark tone="ink">
            <CategoryGlyph id={integration.categoryId} size={ICON} />
          </Mark>
          <TwoLine title={<Text kind="title" as="h1">{integration.name}</Text>} sub={integration.adapter} />
          {added ? <Badge tone={added.status === "live" ? "ok" : "neutral"} dot>{added.status === "live" ? "Live" : "Testing"}</Badge> : <Badge>Coming soon</Badge>}
        </Row>
        {added && (
          <Row>
            {integration.models.length > 1 && <PillMenu stable label={integration.models.find((m) => m.id === model)!.name} value={model} options={integration.models.map((m) => ({ value: m.id, label: m.name }))} onChange={(id) => setModel(id as ModelId)} />}
            <Button href={`${BASE}/playground?model=${model}`}>
              <FlaskConical {...ICON} aria-hidden="true" />
              Test in Playground
            </Button>
          </Row>
        )}
      </Between>
    </Stack>
  );

  if (!added) {
    return (
      <Page>
        {head}
        <CardSection icon={<CategoryGlyph id={integration.categoryId} size={ICON} />} title="Planned models">
          {integration.models.map((m) => (
            <Card key={m.id} label={m.name}>
              <TwoLine title={<Text kind="h3">{m.name}</Text>} sub={`${m.capabilities.length} planned capabilities`} />
              <ChipRow>
                {m.capabilities.map((c) => (
                  <Badge key={c} tone={CAPABILITY_RISK_TIER[c] === "T4" ? "warn" : "ring"}>
                    {c}
                  </Badge>
                ))}
              </ChipRow>
            </Card>
          ))}
        </CardSection>
      </Page>
    );
  }

  const devices = devicesOfIntegration(users, integration.id);
  const figures = figuresOfDevices(devices);
  const scoped = calls.filter((c) => c.modelId && integration.models.some((m) => m.id === c.modelId));
  const modelCalls = scoped.filter((c) => c.modelId === model);
  const modelUsers = sortUsers(users.filter((u) => u.devices.some((d) => d.modelId === model)), sort);
  const selected = modelUsers.find((u) => u.id === openUser) ?? null;
  const tests = integration.models.find((m) => m.id === model)!.capabilities.length;
  const tabs = <Segmented label="Device sections" options={TABS.map((t) => t.label)} value={TABS.findIndex((t) => t.key === tab)} onChange={(i) => setTab(TABS[i].key)} />;

  if (tab === "calls") {
    return (
      <Page fit>
        {head}
        {tabs}
        <CallsBrowser key={openCall ?? model} calls={modelCalls} initial={{ call: openCall }} />
      </Page>
    );
  }

  return (
    <Page
      overlays={
        <>
          {selected && (
            <UserSheet
              user={selected}
              calls={calls}
              onClose={() => setOpenUser(null)}
              onSendTest={() => {
                const target = selected.devices.find((d) => d.id === selected.activeDeviceId) ?? selected.devices[0];
                const call = testDelivery(selected, target, "Active device, seen within the online window");
                update((s) => ({ ...s, sentCalls: [call, ...s.sentCalls] }));
                say(`Sent to ${target?.name ?? selected.name}`);
              }}
              onRelink={() => say("Relink link copied")}
            />
          )}
          {notice && <Toast>{notice}</Toast>}
        </>
      }
    >
      {head}
      {tabs}
      {tab === "overview" && (
        <>
          <StatRow>
            <StatCard label="Connected users" value={fmt(figures.users)} hint={`${fmt(figures.devices)} devices`} />
            <StatCard label="Devices online" value={fmt(figures.online)} hint={`of ${fmt(figures.devices)}`} />
            <StatCard label="Deliveries, 7d" value={fmt(figures.deliveries)} hint={`${fmt(figures.seen)} seen`} />
            <StatCard label="Shown rate" value={`${figures.rate}%`} hint="Seen by device of sent" />
          </StatRow>
          <SplitLayout
            wide
            left={
              <FillCard>
                <Text kind="h3">Deliveries</Text>
                <BarChart bars={dailySeries(figures.deliveries, 14)} />
              </FillCard>
            }
            right={
              <FillCard>
                <Text kind="h3">Readiness</Text>
                <Limit goal label="Capability tests" used={Math.min(added.testsPassed, tests)} limit={tests} />
                <Between>
                  <Text>Live rules</Text>
                  <Badge tone="ok" dot>v{editor.state.live || "none"}</Badge>
                </Between>
                <Between>
                  <Text>Test rules</Text>
                  <Badge>v{editor.state.test || "none"}</Badge>
                </Between>
                <Grow />
                <Button block onClick={() => setTab("receives")}>
                  Edit rules
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
                      <Text clip>{[...new Set(mine.map((d) => d.firmware))].join(", ") || "None seen"}</Text>
                    </DataCell>
                    <DataCell>
                      <Text num>{fmt(f.users)}</Text>
                    </DataCell>
                    <DataCell>{f.deliveries ? <MeterFigure value={Math.round(f.rate)} low={f.rate < 90} /> : <Text kind="faint">None</Text>}</DataCell>
                  </DataRow>
                );
              })}
            </DataTable>
          </Card>
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
        </>
      )}
      {tab === "receives" && <ReceivesTab editor={editor} onCapabilities={() => setTab("capabilities")} />}
      {tab === "capabilities" && <CapabilitiesTab model={model} />}
      {tab === "users" && <UsersTable rows={modelUsers} sort={sort} page={page} openId={openUser} onSort={setSort} onPage={setPage} onOpen={setOpenUser} />}
    </Page>
  );
}
