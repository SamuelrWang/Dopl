"use client";

import { useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { PILL_ICON, pillButton } from "@/shared/ui/pill-button";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { SelectMenu } from "@/shared/ui/select-menu";
import {
  LOG_WINDOWS,
  portalQuery,
  withFilters,
  type LogFilters,
  type PortalParams,
} from "@/features/device-sdk/portal/scope";
import { KIND_LABEL } from "../_lib/format";

const OUTCOMES = [
  { key: "all", label: "Any outcome" },
  { key: "ok", label: "OK" },
  { key: "error", label: "Error" },
  { key: "denied", label: "Denied" },
] as const;

const WINDOWS = LOG_WINDOWS.map((w) => ({ key: w, label: w }));

const KIND_OPTIONS = [
  { value: "all", label: "Any device" },
  ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label })),
];

const TEXT_FILTERS = [
  { key: "route", label: "Route", placeholder: "auto, glasses, a device id" },
  { key: "capability", label: "Capability", placeholder: "display.card" },
  { key: "intent", label: "Intent", placeholder: "notify" },
] as const;

type TextKey = (typeof TEXT_FILTERS)[number]["key"];

/** The log's filter bar. Every change is a URL change; the server page does the read. */
export function LogFilterBar({ params, showInternalToggle }: { params: PortalParams; showInternalToggle: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const f = params.filters;
  const [draft, setDraft] = useState<Record<TextKey, string>>({
    route: f.route ?? "",
    capability: f.capability ?? "",
    intent: f.intent ?? "",
  });

  const apply = (patch: Partial<LogFilters>) => router.push(`${pathname}?${portalQuery(withFilters(params, patch))}`);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = (v: string) => (v.trim() === "" ? null : v.trim());
    apply({ route: clean(draft.route), capability: clean(draft.capability), intent: clean(draft.intent) });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          options={OUTCOMES}
          value={f.outcome ?? "all"}
          onChange={(v) => apply({ outcome: v === "all" ? null : v })}
          ariaLabel="Outcome"
        />
        <SegmentedControl options={WINDOWS} value={f.window} onChange={(window) => apply({ window })} ariaLabel="Time window" />
        <SelectMenu
          variant="outline"
          options={KIND_OPTIONS}
          value={f.deviceKind ?? "all"}
          onChange={(v) => apply({ deviceKind: v === "all" ? null : (v as LogFilters["deviceKind"]) })}
          ariaLabel="Device kind"
        />
        {showInternalToggle && (
          <SegmentedControl
            options={[
              { key: "on", label: "Include internal" },
              { key: "off", label: "Hide internal" },
            ]}
            value={f.internal ? "on" : "off"}
            onChange={(v) => apply({ internal: v === "on" })}
            ariaLabel="Internal traffic"
          />
        )}
      </div>
      <form className="flex flex-wrap items-center gap-2" onSubmit={submit} aria-label="Text filters">
        {TEXT_FILTERS.map((t) => (
          <label key={t.key} className="flex items-center gap-1.5 text-caption text-text-muted">
            {t.label}
            <input
              value={draft[t.key]}
              onChange={(e) => setDraft((d) => ({ ...d, [t.key]: e.target.value }))}
              placeholder={t.placeholder}
              maxLength={128}
              className="card-well h-7 w-40 rounded-field px-2 font-mono text-small text-text-primary placeholder:text-text-disabled"
            />
          </label>
        ))}
        <button type="submit" className={pillButton("outline", "sm")}>
          Apply
        </button>
        {(f.route || f.capability || f.intent || f.outcome || f.deviceKind) && (
          <button
            type="button"
            className={cn(pillButton("quiet", "sm"))}
            onClick={() => {
              setDraft({ route: "", capability: "", intent: "" });
              apply({ route: null, capability: null, intent: null, outcome: null, deviceKind: null });
            }}
          >
            <X size={PILL_ICON.sm} aria-hidden="true" />
            Clear filters
          </button>
        )}
      </form>
    </div>
  );
}
