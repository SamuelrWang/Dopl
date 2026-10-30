"use client";

/** One integration in a small dialog, and adding one in a single pick. */
import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import { SelectMenu } from "@/shared/ui/select-menu";
import { DialogActions, StandardDialog } from "@/shared/ui/standard-dialog";
import { StatusPill } from "@/shared/ui/status-pill";
import { toast } from "@/shared/ui/toast";
import { RAISED_INPUT } from "@/shared/ui/wells";
import { INTEGRATIONS, categoryById, integrationById, type IntegrationId } from "../_data/catalog";
import { callsThisWeek } from "../_data/logs";
import { usePortal, type OutputFormat } from "../_components/portal-store";
import { fmt, ov } from "../_components/ui";

const FORMATS: { value: OutputFormat; label: string }[] = [
  { value: "plain", label: "Plain text" },
  { value: "markdown", label: "Markdown" },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={ov.row}>
      <span className={ov.rowMain}>
        <span className={ov.rowTitle}>{label}</span>
      </span>
      {children}
    </div>
  );
}

export function IntegrationDialog({ id, onClose }: { id: IntegrationId | null; onClose: () => void }) {
  const { state, update } = usePortal();
  const [tested, setTested] = useState<IntegrationId | null>(null);
  const integration = id ? integrationById(id) : null;
  const added = id ? state.integrations[id] : undefined;
  if (!id || !integration || !added) return null;
  const set = (patch: Partial<typeof added>) => update((s) => ({ ...s, integrations: { ...s.integrations, [id]: { ...added, ...patch } } }));
  const remove = () => {
    update((s) => {
      const integrations = { ...s.integrations };
      delete integrations[id];
      return { ...s, integrations };
    });
    onClose();
  };
  return (
    <StandardDialog open onClose={onClose} title={integration.name} titleCase={false}>
      <div className={ov.rows}>
        <Row label="Category">
          <span className="text-caption text-text-secondary">{categoryById(integration.categoryId).name}</span>
        </Row>
        <Row label="Status">
          {added.status === "live" ? (
            <StatusPill tone="live" dot bare>
              Live
            </StatusPill>
          ) : (
            <button type="button" className={pillButton("outline", "xs")} onClick={() => set({ status: "live" })}>
              Go live
            </button>
          )}
        </Row>
        <Row label="Models">
          <span className="text-caption text-text-secondary">{integration.models.map((m) => m.name).join(", ")}</span>
        </Row>
        <Row label="Calls this week">
          <span className="text-caption tabular-nums text-text-secondary">{fmt(callsThisWeek(state.env, id))}</span>
        </Row>
        <Row label="Max lines">
          <input
            type="number"
            aria-label="Max lines"
            min={1}
            max={integration.lineLimit}
            value={added.maxLines}
            onChange={(e) => set({ maxLines: Math.max(1, Math.min(integration.lineLimit, Number(e.target.value) || 1)) })}
            className={cn(RAISED_INPUT, "h-7 w-16 px-2")}
          />
        </Row>
        <Row label="Format">
          <SelectMenu variant="outline" ariaLabel="Format" value={added.format} options={FORMATS} onChange={(format) => set({ format })} />
        </Row>
      </div>
      <DialogActions>
        <button type="button" className={cn(pillButton("quiet", "md"), "mr-auto")} onClick={remove}>
          Remove
        </button>
        <button
          type="button"
          className={pillButton("ink", "md")}
          onClick={() => {
            setTested(id);
            toast({ title: `Test passed on simulated ${integration.models[0].name}` });
          }}
        >
          {tested === id ? "Test passed" : "Test on simulator"}
        </button>
      </DialogActions>
    </StandardDialog>
  );
}

export function AddIntegrationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, update } = usePortal();
  const available = INTEGRATIONS.filter((i) => !state.integrations[i.id]);
  const add = (id: IntegrationId) => {
    const integration = integrationById(id);
    update((s) => ({
      ...s,
      integrations: { ...s.integrations, [id]: { status: "testing", maxLines: Math.min(4, integration.lineLimit), format: "plain" } },
    }));
    onClose();
  };
  return (
    <StandardDialog open={open} onClose={onClose} title="Add integration">
      <div className="flex flex-col">
        {available.map((integration) => (
          <div key={integration.id} className={cn(ov.row, ov.openRow)}>
            <span className={ov.rowMain}>
              <button type="button" className={cn(ov.open, ov.rowTitle)} onClick={() => add(integration.id)}>
                {integration.name}
              </button>
            </span>
            <span className={ov.rowAside}>{categoryById(integration.categoryId).name}</span>
          </div>
        ))}
      </div>
    </StandardDialog>
  );
}
