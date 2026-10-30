"use client";

/** One integration: its tabs, with a model selector for the tabs that work per model. */
import Link from "next/link";
import { useState } from "react";
import { CAPABILITY_RISK_TIER } from "@dopl/device-contracts";
import { pillButton } from "@/shared/ui/pill-button";
import { SelectMenu } from "@/shared/ui/select-menu";
import { StatusPill } from "@/shared/ui/status-pill";
import { ThinMeter } from "@/shared/ui/usage-meter";
import { dailySeries } from "../_data/activity";
import { categoryById, integrationById, type ModelId } from "../_data/catalog";
import { CallList, CallPanel, CallRow } from "../_components/calls";
import { useCalls, usePortal, useUsers } from "../_components/portal-store";
import { devicesOfIntegration, devicesOfModel, figuresOfDevices } from "../_components/stats";
import { BASE, Bars, Card, Cell, FactChip, IntegrationStatusPill, PortalPage, RowList, Strip, TierChip, TypeMark, fmt, ov } from "../_components/ui";
import { UserHeaderRow, UserRow } from "../_components/user-row";
import { CapabilitiesTab } from "./integration-capabilities";
import { ReceivesPreview, ReceivesTab, useReceivesEditor } from "./receives";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "receives", label: "What it receives" },
  { key: "capabilities", label: "Capabilities" },
  { key: "calls", label: "Calls" },
  { key: "users", label: "Users" },
];

export function IntegrationPageSection({ integrationId, initialTab, initialModel }: { integrationId: string; initialTab?: string; initialModel?: string }) {
  const integration = integrationById(integrationId)!;
  const category = categoryById(integration.categoryId);
  const { state } = usePortal();
  const added = state.integrations[integration.id];
  const crumbs = [{ label: "Devices", href: `${BASE}/devices` }, { label: category.name, href: `${BASE}/devices` }, { label: integration.name }];
  const firstModel = integration.models.find((m) => m.id === initialModel)?.id ?? integration.models[0].id;
  const [model, setModel] = useState<ModelId>(firstModel);
  const [tab, setTab] = useState(TABS.some((t) => t.key === initialTab) ? initialTab! : "overview");
  const [openCall, setOpenCall] = useState<string | null>(null);
  const users = useUsers();
  const calls = useCalls();
  const editor = useReceivesEditor(integration.categoryId, model);

  if (!added) {
    return (
      <PortalPage
        crumbs={crumbs}
        title={integration.name}
        lead={<TypeMark kind={category.kind} />}
        meta={<StatusPill>Coming soon</StatusPill>}
        actions={
          <Link href={`${BASE}/devices/add?integration=${integration.id}`} className={pillButton("ink", "lg")}>
            Add integration
          </Link>
        }
      >
        {integration.models.map((m) => (
          <Card key={m.id} title={m.name} count={`${m.capabilities.length} planned capabilities`}>
            <ul className={ov.rows}>
              {m.capabilities.map((c) => (
                <li key={c} className={ov.row}>
                  <TierChip tier={CAPABILITY_RISK_TIER[c]} />
                  <span className="font-mono text-small text-text-primary">{c}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </PortalPage>
    );
  }

  const devices = devicesOfIntegration(users, integration.id);
  const figures = figuresOfDevices(devices);
  const scoped = calls.filter((c) => c.modelId && integration.models.some((m) => m.id === c.modelId));
  const callRow = openCall ? scoped.find((c) => c.id === openCall) : null;
  const modelCalls = scoped.filter((c) => c.modelId === model);
  const modelUsers = users.filter((u) => u.devices.some((d) => d.modelId === model));

  const aside =
    tab === "receives" ? <ReceivesPreview editor={editor} /> : (tab === "calls" || tab === "overview") && callRow ? <CallPanel call={callRow} onClose={() => setOpenCall(null)} /> : undefined;

  return (
    <PortalPage
      crumbs={crumbs}
      title={integration.name}
      lead={<TypeMark kind={category.kind} />}
      meta={
        <>
          <IntegrationStatusPill status={added.status} />
          <span>{integration.adapter}</span>
        </>
      }
      actions={
        <SelectMenu
          variant="raised"
          prefix="Model"
          ariaLabel="Model"
          value={model}
          options={integration.models.map((m) => ({ value: m.id, label: m.name }))}
          onChange={setModel}
        />
      }
      tabs={TABS}
      tab={tab}
      onTab={setTab}
      aside={aside}
      asideWidth={tab === "receives" ? 360 : 400}
    >
      {tab === "overview" && (
        <>
          <Strip label="Summary">
            <Cell label="Connected users" value={fmt(figures.users)} />
            <Cell label="Devices online" value={fmt(figures.online)} of={`/ ${figures.devices}`} />
            <Cell label="Deliveries, 7 days" value={fmt(figures.deliveries)} />
            <Cell label="Shown rate" value={`${figures.rate}%`} sub="Seen by device of sent" />
          </Strip>
          <Card title="Models" count={integration.models.length}>
            <ul className={ov.rows}>
              {integration.models.map((m) => {
                const f = figuresOfDevices(devicesOfModel(users, m.id));
                const firmware = [...new Set(devicesOfModel(users, m.id).map((d) => d.firmware))];
                return (
                  <li key={m.id} className={ov.row}>
                    <span className={ov.rowMain}>
                      <span className={ov.rowTitle}>{m.name}</span>
                      <span className={ov.rowMeta}>
                        {m.capabilities.length} capabilities, firmware {firmware.join(", ") || "none seen"}
                      </span>
                    </span>
                    <span className="flex w-24 items-center gap-2">
                      <span className="text-caption font-medium tabular-nums text-text-primary">{f.rate}%</span>
                      <ThinMeter used={f.rate} limit={100} className="flex-1" />
                    </span>
                    <Link href={`${BASE}/playground?model=${m.id}`} className={pillButton("outline", "sm")}>
                      Test on simulator
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3.5">
            <Card title="Deliveries" count="Last 14 days">
              <Bars bars={dailySeries(figures.deliveries, 14)} label="Deliveries per day" />
            </Card>
            <Card title="Readiness">
              <div className="flex flex-wrap gap-1.5">
                <FactChip>{added.testsPassed} capability tests passed</FactChip>
                <FactChip>Live rules v{editor.state.live}</FactChip>
                <FactChip>Test rules v{editor.state.test}</FactChip>
              </div>
            </Card>
          </div>
          <Card title="Latest calls">
            <ul className="m-0 flex list-none flex-col">
              {scoped.slice(0, 6).map((c) => (
                <CallRow key={c.id} call={c} selected={c.id === openCall} onOpen={() => setOpenCall(c.id)} />
              ))}
            </ul>
          </Card>
        </>
      )}
      {tab === "receives" && <ReceivesTab editor={editor} onCapabilities={() => setTab("capabilities")} />}
      {tab === "capabilities" && <CapabilitiesTab model={model} />}
      {tab === "calls" && <CallList calls={modelCalls} selected={openCall} onOpen={setOpenCall} levels={false} />}
      {tab === "users" && (
        <div className="flex flex-col gap-1.5">
          <UserHeaderRow />
          <RowList>
            {modelUsers.map((u) => (
              <UserRow key={u.id} user={u} />
            ))}
          </RowList>
        </div>
      )}
    </PortalPage>
  );
}
