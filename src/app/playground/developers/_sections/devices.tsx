"use client";

/**
 * Devices: a heading per category, a card per added model, and an add card closing each section.
 * Physical devices only appear on a user's page.
 */
import Link from "next/link";
import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import { CATEGORIES, functionsOf, integrationsIn, type CategoryId, type Integration, type Model } from "../_data/catalog";
import { usePortal, useUsers, type AddedIntegration } from "../_components/portal-store";
import { devicesOfModel, figuresOfDevices, figuresOfUsers } from "../_components/stats";
import { BASE, Cell, FactChip, IntegrationStatusPill, PortalPage, Strip, TypeMark, fmt, ov } from "../_components/ui";
import type { PortalUser } from "../_data/users";
import { AddDeviceDialog } from "./add-device-dialog";

/** Seven days of calls, drawn from the week's total; deterministic per model. */
function weekBars(id: string, total: number): number[] {
  const seed = [...id].reduce((n, c) => n + c.charCodeAt(0), 0);
  const weights = Array.from({ length: 7 }, (_, i) => 3 + ((seed * (i + 3)) % 7));
  const sum = weights.reduce((n, w) => n + w, 0);
  return weights.map((w) => (total ? w / sum : 0));
}

function WeekBars({ id, total }: { id: string; total: number }) {
  const bars = weekBars(id, total);
  const top = Math.max(...bars, 1 / 7);
  return (
    <span className="flex h-6 w-16 items-end gap-0.5" aria-hidden="true">
      {bars.map((b, i) => (
        <i key={i} className={cn("flex-1 rounded-[1px]", i === bars.length - 1 ? "bg-surface-cta" : "bg-chart-bar")} style={{ height: `${Math.max(12, (b / top) * 100)}%` }} />
      ))}
    </span>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-micro text-text-muted">{label}</span>
      <span className="text-body font-medium tabular-nums text-text-primary">{value}</span>
    </span>
  );
}

function DeviceCard({ model, integration, kind, added, users }: { model: Model; integration: Integration; kind: string; added: AddedIntegration; users: PortalUser[] }) {
  const figures = figuresOfDevices(devicesOfModel(users, model.id));
  const functions = functionsOf(model);
  return (
    <Link href={`${BASE}/devices/${integration.id}`} className="white-card flex flex-col gap-3 p-3.5 transition-colors hover:border-border-strong">
      <span className="flex items-center gap-3">
        <TypeMark kind={kind} size="l" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-heading font-medium text-text-primary">{model.name}</span>
          <span className={ov.rowMeta}>{integration.name}</span>
        </span>
        <IntegrationStatusPill status={added.status} />
      </span>
      <span className="flex min-h-6 flex-wrap gap-1">
        {functions.slice(0, 4).map((f) => (
          <FactChip key={f}>{f}</FactChip>
        ))}
        {functions.length > 4 && <FactChip>+{functions.length - 4}</FactChip>}
      </span>
      <span className="card-well grid grid-cols-3 gap-2 px-3 py-2.5">
        <Figure label="Users" value={fmt(figures.users)} />
        <Figure label="Online" value={fmt(figures.online)} />
        <Figure label="Shown" value={figures.deliveries ? `${figures.rate}%` : "None"} />
      </span>
      <span className="mt-auto flex items-center gap-2.5 border-t border-border-default pt-3">
        <WeekBars id={model.id} total={figures.deliveries} />
        <span className="min-w-0 flex-1 truncate text-caption tabular-nums text-text-secondary">{figures.deliveries ? `${fmt(figures.deliveries)} calls this week` : "No calls yet"}</span>
        <ChevronRight size={14} strokeWidth={2} aria-hidden="true" className="flex-none text-text-disabled" />
      </span>
    </Link>
  );
}

function AddCard({ category, onClick }: { category: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-52 flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-border-strong p-3.5 transition-colors hover:bg-surface-raised-1"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border-default text-text-secondary">
        <Plus size={18} strokeWidth={1.8} aria-hidden="true" />
      </span>
      <span className="flex flex-col items-center">
        <span className="text-body font-medium text-text-primary">Add new device</span>
        <span className={ov.rowMeta}>{category}</span>
      </span>
    </button>
  );
}

export function DevicesSection() {
  const { state } = usePortal();
  const users = useUsers();
  const [adding, setAdding] = useState<CategoryId | null>(null);
  const figures = figuresOfUsers(users);
  const added = Object.values(state.integrations);
  return (
    <PortalPage title="Devices">
      <Strip label="Summary">
        <Cell label="Integrations" value={fmt(added.length)} of={`${added.filter((i) => i.status === "live").length} live`} />
        <Cell label="Devices connected" value={fmt(figures.devices)} of={`${figures.online} online`} />
        <Cell label="Connected users" value={fmt(figures.users)} />
        <Cell label="Shown rate" value={`${figures.rate}%`} />
      </Strip>
      {CATEGORIES.map((category) => (
        <section key={category.id} className="flex flex-col gap-2" aria-label={category.name}>
          <h2 className={cn(IDENTITY_NAME_TEXT, "flex items-center gap-2 pt-1")}>
            <TypeMark kind={category.kind} size="s" />
            {category.name}
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
            {integrationsIn(category.id).flatMap((integration) => {
              const entry = state.integrations[integration.id];
              return entry ? integration.models.map((m) => <DeviceCard key={m.id} model={m} integration={integration} kind={category.kind} added={entry} users={users} />) : [];
            })}
            <AddCard category={category.name} onClick={() => setAdding(category.id)} />
          </div>
        </section>
      ))}
      {adding && <AddDeviceDialog initialCategory={adding} onClose={() => setAdding(null)} />}
    </PortalPage>
  );
}
