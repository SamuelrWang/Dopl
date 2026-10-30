"use client";

/**
 * Devices: categories, with the integrations inside each. Levels are never mixed in one list; models
 * are chips on their integration, and physical devices only appear on a user's page.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { CreateButton, pillButton } from "@/shared/ui/pill-button";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import { StatusPill } from "@/shared/ui/status-pill";
import { ThinMeter } from "@/shared/ui/usage-meter";
import { CATEGORIES, integrationsIn, type Integration } from "../_data/catalog";
import { usePortal, useUsers, type AddedIntegration } from "../_components/portal-store";
import { devicesOfIntegration, figuresOfDevices, figuresOfUsers } from "../_components/stats";
import { BASE, Cell, FactChip, IntegrationStatusPill, PortalPage, RowList, Strip, TypeMark, fmt, ov } from "../_components/ui";
import type { PortalUser } from "../_data/users";

const GRID = "grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_88px_90px_120px_auto] items-center gap-3";

function IntegrationRow({ integration, added, users }: { integration: Integration; added?: AddedIntegration; users: PortalUser[] }) {
  const figures = figuresOfDevices(devicesOfIntegration(users, integration.id));
  const href = `${BASE}/devices/${integration.id}`;
  return (
    <li className={cn(GRID, ov.openRow, "mx-0! min-h-13 border-t border-border-default px-0! py-1.5 first:border-t-0", !added && "opacity-70")}>
      <span className="flex min-w-0 flex-col">
        <Link href={href} className={cn(ov.open, "truncate text-body font-medium text-text-primary")}>
          {integration.name}
        </Link>
        <span className={ov.rowMeta}>{integration.adapter}</span>
      </span>
      <span className="flex min-w-0 flex-wrap gap-1">
        {integration.models.map((m) => (
          <FactChip key={m.id}>{m.name}</FactChip>
        ))}
      </span>
      <span>{added ? <IntegrationStatusPill status={added.status} /> : <StatusPill>Coming soon</StatusPill>}</span>
      {added ? (
        <>
          <span className="text-caption text-text-secondary tabular-nums">{fmt(figures.users)} users</span>
          <span className="flex items-center gap-2">
            <span className="w-10 text-caption font-medium tabular-nums text-text-primary">{figures.deliveries ? `${figures.rate}%` : "None"}</span>
            <ThinMeter used={figures.rate} limit={100} className="flex-1" />
          </span>
        </>
      ) : (
        <>
          <span />
          <span />
        </>
      )}
      <span className="relative justify-self-end">
        {!added && (
          <Link href={`${BASE}/devices/add?integration=${integration.id}`} className={pillButton("outline", "xs")}>
            Add
          </Link>
        )}
      </span>
    </li>
  );
}

export function DevicesSection() {
  const router = useRouter();
  const { state } = usePortal();
  const users = useUsers();
  const figures = figuresOfUsers(users);
  const added = Object.values(state.integrations);
  return (
    <PortalPage title="Devices" actions={<CreateButton onClick={() => router.push(`${BASE}/devices/add`)}>Add integration</CreateButton>}>
      <Strip label="Summary">
        <Cell label="Integrations" value={fmt(added.length)} of={`${added.filter((i) => i.status === "live").length} live`} />
        <Cell label="Devices connected" value={fmt(figures.devices)} of={`${figures.online} online`} />
        <Cell label="Connected users" value={fmt(figures.users)} />
        <Cell label="Shown rate" value={`${figures.rate}%`} />
      </Strip>
      {CATEGORIES.map((category) => {
        const integrations = integrationsIn(category.id);
        return (
          <section key={category.id} className="flex flex-col gap-2" aria-label={category.name}>
            <h2 className={cn(IDENTITY_NAME_TEXT, "flex items-center gap-2 pt-1")}>
              <TypeMark kind={category.kind} size="s" />
              {category.name}
            </h2>
            {integrations.length === 0 ? (
              <EmptyState variant="outline" title="No integration yet" />
            ) : (
              <RowList>
                {integrations.map((i) => (
                  <IntegrationRow key={i.id} integration={i} added={state.integrations[i.id]} users={users} />
                ))}
              </RowList>
            )}
          </section>
        );
      })}
    </PortalPage>
  );
}
