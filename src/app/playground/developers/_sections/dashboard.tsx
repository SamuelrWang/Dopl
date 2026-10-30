"use client";

/** The whole portal on one page: usage, the API key, integrations. */
import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { ChevronRight, Plus } from "lucide-react";
import { CopyButton } from "@/shared/ui/copy-button";
import { pillButton, PILL_ICON } from "@/shared/ui/pill-button";
import { QUIET_HEADING_TEXT } from "@/shared/ui/section-heading";
import { StatusPill } from "@/shared/ui/status-pill";
import { toast } from "@/shared/ui/toast";
import { CATEGORIES, integrationsIn, type IntegrationId } from "../_data/catalog";
import { dailyBars, usageOf } from "../_data/logs";
import { usePortal } from "../_components/portal-store";
import { Bars, Card, PortalPage, fmt, ov } from "../_components/ui";
import { AddIntegrationDialog, IntegrationDialog } from "./integration-dialogs";

export const maskKey = (key: string) => `${key.slice(0, 8)}${"•".repeat(12)}${key.slice(-4)}`;

function Usage() {
  const { state } = usePortal();
  const usage = usageOf(state.env);
  const cells: [string, number][] = [
    ["API calls", usage.calls],
    ["Delivered", usage.delivered],
    ["Active users", usage.activeUsers],
  ];
  return (
    <Card title="Usage" count="Last 7 days">
      <div className="grid grid-cols-3 gap-4">
        {cells.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <span className={ov.cellLabel}>{label}</span>
            <span className={ov.figure}>{fmt(value)}</span>
          </div>
        ))}
      </div>
      <Bars bars={dailyBars(state.env)} label="API calls per day" />
    </Card>
  );
}

function ApiKey() {
  const { state, update } = usePortal();
  const keys = state.keys[state.env];
  const create = () => {
    const tail = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).slice(-1)).join("");
    update((s) => ({ ...s, keys: { ...s.keys, [s.env]: [`sk_${s.env}_demo${tail}`, ...s.keys[s.env]] } }));
    toast({ title: "API key created" });
  };
  return (
    <Card
      title="API key"
      aside={
        <button type="button" className={pillButton("outline", "sm")} onClick={create}>
          Create key
        </button>
      }
    >
      <ul className={ov.rows}>
        {keys.map((key) => (
          <li key={key} className={ov.row}>
            <span className="min-w-0 flex-1 truncate font-mono text-small text-text-primary">{maskKey(key)}</span>
            <CopyButton text={key} label="Copy key" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Integrations() {
  const { state } = usePortal();
  const [open, setOpen] = useState<IntegrationId | null>(null);
  const [adding, setAdding] = useState(false);
  return (
    <Card
      title="Integrations"
      aside={
        <button type="button" className={pillButton("ink", "sm")} onClick={() => setAdding(true)}>
          <Plus size={PILL_ICON.sm} aria-hidden="true" />
          Add
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        {CATEGORIES.map((category) => {
          const list = integrationsIn(category.id);
          return (
            <section key={category.id} className="flex flex-col" aria-label={category.name}>
              <h3 className={QUIET_HEADING_TEXT}>{category.name}</h3>
              {list.length === 0 && <span className="py-1 text-caption text-text-muted">No integration yet</span>}
              {list.map((integration) => {
                const added = state.integrations[integration.id];
                if (!added) {
                  return (
                    <div key={integration.id} className="flex items-center justify-between py-1 text-caption text-text-muted">
                      <span>{integration.name}</span>
                      <span>{integration.comingSoon ? "Coming soon" : "Not added"}</span>
                    </div>
                  );
                }
                return (
                  <div key={integration.id} className={cn(ov.row, ov.openRow)}>
                    <span className={ov.rowMain}>
                      <button type="button" className={cn(ov.open, ov.rowTitle)} onClick={() => setOpen(integration.id)}>
                        {integration.name}
                      </button>
                    </span>
                    {added.status === "live" ? (
                      <StatusPill tone="live" dot bare>
                        Live
                      </StatusPill>
                    ) : (
                      <StatusPill>Testing</StatusPill>
                    )}
                    <ChevronRight size={13} aria-hidden="true" className="text-text-muted" />
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      <IntegrationDialog id={open} onClose={() => setOpen(null)} />
      <AddIntegrationDialog open={adding} onClose={() => setAdding(false)} />
    </Card>
  );
}

export function DashboardSection() {
  return (
    <PortalPage title="Dashboard">
      <Usage />
      <ApiKey />
      <Integrations />
    </PortalPage>
  );
}
