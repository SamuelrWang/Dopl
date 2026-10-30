"use client";

/**
 * Devices: a heading per category, a card per added model, and an add card closing each section.
 * Physical devices only appear on a user's page.
 */
import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import { ThinMeter } from "@/shared/ui/usage-meter";
import { CATEGORIES, integrationsIn, type CategoryId, type Integration, type Model } from "../_data/catalog";
import { usePortal, useUsers, type AddedIntegration } from "../_components/portal-store";
import { devicesOfModel, figuresOfDevices, figuresOfUsers } from "../_components/stats";
import { BASE, Cell, IntegrationStatusPill, PortalPage, Strip, TypeMark, fmt, ov } from "../_components/ui";
import type { PortalUser } from "../_data/users";
import { AddDeviceDialog } from "./add-device-dialog";

function DeviceCard({ model, integration, added, users }: { model: Model; integration: Integration; added: AddedIntegration; users: PortalUser[] }) {
  const figures = figuresOfDevices(devicesOfModel(users, model.id));
  return (
    <Link href={`${BASE}/devices/${integration.id}`} className="white-card flex min-h-30 flex-col gap-3 p-3.5 transition-colors hover:bg-surface-raised-1">
      <span className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body font-medium text-text-primary">{model.name}</span>
          <span className={ov.rowMeta}>{integration.name}</span>
        </span>
        <IntegrationStatusPill status={added.status} />
      </span>
      <span className="mt-auto flex flex-col gap-1.5">
        <span className="flex items-baseline justify-between text-caption tabular-nums text-text-secondary">
          <span>{fmt(figures.users)} users</span>
          <span>{figures.deliveries ? `${figures.rate}% shown` : "No calls yet"}</span>
        </span>
        <ThinMeter used={figures.rate} limit={100} />
      </span>
    </Link>
  );
}

function AddCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-30 items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-strong text-body text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
    >
      <Plus size={14} aria-hidden="true" />
      Add new device
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
          <div className="grid grid-cols-3 gap-3">
            {integrationsIn(category.id).flatMap((integration) => {
              const entry = state.integrations[integration.id];
              return entry ? integration.models.map((m) => <DeviceCard key={m.id} model={m} integration={integration} added={entry} users={users} />) : [];
            })}
            <AddCard onClick={() => setAdding(category.id)} />
          </div>
        </section>
      ))}
      {adding && <AddDeviceDialog initialCategory={adding} onClose={() => setAdding(null)} />}
    </PortalPage>
  );
}
