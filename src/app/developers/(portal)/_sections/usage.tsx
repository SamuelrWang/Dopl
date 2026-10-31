"use client";

/** Usage: how much this project sends, and what is driving it. Figures follow the Category and Model filters; the counts on the right never do. */
import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import { ALL_MODELS, CATEGORIES, categoryOf, modelById, modelOfAdapter, trail, type ModelId } from "@/features/device-sdk/portal/catalog";
import { counted, dailyBars, rateOf, rowsBetween, totalsOf, type KeyView, type MetricRow, type PortalUser } from "@/features/device-sdk/portal/view";
import { Badge, Button, DataCell, DataRow, DataTable, ICON, MeterFigure, PillMenu, Segmented, StatCard, TwoLine, type Column } from "../_design/ui";
import { BarChart, Limit } from "../_design/ui-data";
import { FillBody, FillCard, FitRows, ScrollArea, SplitLayout, useFitRows } from "../_design/ui-output";
import { Between, Page, PageHeader, Row, StatRow, TableHead, Text } from "../_design/ui-page";
import { downloadCsv, fmt, portalNow } from "../_components/format";
import { usePortal } from "../_components/portal-store";

const RANGES = [{ label: "7 days", days: 7 }, { label: "30 days", days: 30 }];
const BREAKDOWNS = ["Model", "User", "API key"];

interface UsageProps {
  users: PortalUser[];
  metrics: MetricRow[];
  keys: KeyView[];
  keyLimit: number;
  seats: number;
  endpoints: number;
}

const ADAPTER_OF_KIND: Record<string, string> = { glasses: "even_g2", desktop: "desktop", home_hub: "google_home" };

/** A row's device may be gone from the fleet by now, so its kind still places it. */
function modelOfRow(m: MetricRow, models: ReadonlyMap<string, ModelId>): ModelId | null {
  if (!m.device) return null;
  return models.get(m.device) ?? modelOfAdapter(ADAPTER_OF_KIND[m.kind ?? ""] ?? "");
}

export function UsageSection({ users, metrics, keys, keyLimit, seats, endpoints }: UsageProps) {
  const { test, project } = usePortal();
  const [category, setCategory] = useState("all");
  const [modelId, setModelId] = useState("all");
  const [range, setRange] = useState(1);
  const [by, setBy] = useState(0);
  const fit = useFitRows(4);
  const now = portalNow();
  const days = RANGES[range].days;

  const models = useMemo(() => new Map(users.flatMap((u) => u.devices.map((d) => [d.id, d.modelId] as const))), [users]);
  const inFilter = (m: MetricRow) => {
    if (category === "all" && modelId === "all") return true;
    const id = modelOfRow(m, models);
    return id !== null && (category === "all" || categoryOf(id).id === category) && (modelId === "all" || id === modelId);
  };
  const filtered = metrics.filter(inFilter);
  const inRange = rowsBetween(filtered, now, days - 1);
  const month = new Date(now).toISOString().slice(0, 7);
  const thisMonth = totalsOf(filtered.filter((m) => m.day.startsWith(month)));
  const totals = totalsOf(inRange);
  const series = dailyBars(filtered, days, now);
  const usedModels = ALL_MODELS.filter((m) => users.some((u) => u.devices.some((d) => d.modelId === m.id)));

  const rowsOf = () => {
    const rows = rowsBetween(metrics, now, days - 1);
    if (by === 0) {
      return [
        ...usedModels.filter((m) => (category === "all" || categoryOf(m.id).id === category) && (modelId === "all" || m.id === modelId)).map((m) => {
          const owners = users.filter((u) => u.devices.some((d) => d.modelId === m.id)).length;
          return { id: m.id as string, name: m.name, sub: trail(m.id).slice(0, 2).join(", "), calls: totalsOf(rows.filter((r) => modelOfRow(r, models) === m.id)).deliveries, detail: `${owners} ${owners === 1 ? "user" : "users"}` };
        }),
        { id: "unrouted", name: "No device", sub: "Refused before routing", calls: totalsOf(rows.filter((r) => !r.device)).deliveries, detail: "" },
      ];
    }
    if (by === 1) return users.map((u) => ({ id: u.id, name: u.name, sub: u.named ? u.id : "", calls: totalsOf(rows.filter((r) => r.user === u.id)).deliveries, detail: `${u.devices.length} ${u.devices.length === 1 ? "device" : "devices"}` }));
    return [
      ...keys.filter((k) => !k.revokedAt).map((k) => ({ id: k.id, name: k.name, sub: `${k.prefix}••••`, calls: totalsOf(rows.filter((r) => r.key === k.id)).calls, detail: k.kind === "secret" ? "Secret" : "Publishable" })),
      { id: "none", name: "No key", sub: "Before keys were recorded, or from a device", calls: totalsOf(rows.filter((r) => !r.key)).calls, detail: "" },
    ];
  };
  const sorted = rowsOf().filter((r) => r.calls > 0).sort((a, b) => b.calls - a.calls);
  const total = Math.max(sorted.reduce((n, r) => n + r.calls, 0), 1);
  const unit = by === 2 ? "Calls" : "Deliveries";
  const COLUMNS: Column[] = [
    { key: "name", label: "Name", width: "40%" },
    { key: "calls", label: `${unit}, ${days}d`, width: "20%" },
    { key: "detail", label: "Detail", width: "20%" },
    { key: "share", label: "Share", width: "20%" },
  ];
  const exportCsv = () => downloadCsv("usage.csv", [["name", "detail", `${unit.toLowerCase()}_${days}d`], ...sorted.map((r) => [r.name, r.detail, r.calls])]);

  return (
    <Page fit>
      <PageHeader
        title="Usage"
        test={test}
        action={
          <Row>
            {project.org.internal && <Badge>Internal, not billed</Badge>}
            <Button variant="ink" disabled={sorted.length === 0} onClick={exportCsv}>
              <Download {...ICON} aria-hidden="true" />
              Export
            </Button>
          </Row>
        }
      />

      <StatRow>
        <StatCard label="This month" value={fmt(thisMonth.deliveries)} hint="Deliveries, UTC" />
        <StatCard label={`Deliveries, ${days}d`} value={fmt(totals.deliveries)} hint={counted(totals.calls, "call")} />
        <StatCard label="Delivered" value={totals.deliveries ? `${rateOf(totals)}%` : "None"} hint={`Taken by a device, ${days}d`} />
        <StatCard label="Failed" value={fmt(totals.failed)} hint={`${days}d`} />
      </StatRow>

      <FitRows>
        <SplitLayout
          wide
          left={
            <FillCard>
              <Between>
                <Row>
                  <Text kind="h3">Deliveries</Text>
                  <PillMenu stable label={category === "all" ? "All categories" : CATEGORIES.find((c) => c.id === category)!.name} value={category} options={[{ value: "all", label: "All categories" }, ...CATEGORIES.filter((c) => usedModels.some((m) => categoryOf(m.id).id === c.id)).map((c) => ({ value: c.id, label: c.name }))]} onChange={(v) => { setCategory(v); setModelId("all"); }} />
                  <PillMenu stable label={modelId === "all" ? "All models" : modelById(modelId as ModelId).name} value={modelId} options={[{ value: "all", label: "All models" }, ...usedModels.filter((m) => category === "all" || categoryOf(m.id).id === category).map((m) => ({ value: m.id, label: m.name }))]} onChange={setModelId} />
                </Row>
                <Segmented label="Range" options={RANGES.map((r) => r.label)} value={range} onChange={setRange} />
              </Between>
              <BarChart bars={series} />
            </FillCard>
          }
          right={
            <FillCard>
              <Text kind="h3">Project</Text>
              <FillBody even>
                <Limit label="API keys" used={keys.filter((k) => !k.revokedAt).length} limit={keyLimit} />
                <Between>
                  <Text>Seats</Text>
                  <Text num>{fmt(seats)}</Text>
                </Between>
                <Between>
                  <Text>Webhook endpoints</Text>
                  <Text num>{fmt(endpoints)}</Text>
                </Between>
              </FillBody>
            </FillCard>
          }
        />
        <FillCard flush>
          <TableHead>
            <Text kind="h3">Top by</Text>
            <Segmented label="Break down by" options={BREAKDOWNS} value={by} onChange={setBy} />
          </TableHead>
          <ScrollArea areaRef={fit.ref}>
            <DataTable columns={COLUMNS}>
              {sorted.slice(0, fit.count).map((r) => (
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
                    <MeterFigure value={Math.round((r.calls / total) * 100)} />
                  </DataCell>
                </DataRow>
              ))}
            </DataTable>
          </ScrollArea>
        </FillCard>
      </FitRows>
    </Page>
  );
}
