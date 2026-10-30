"use client";

import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import { CreateButton } from "../_components/create-button";
import { DialogActions, StandardDialog } from "@/shared/ui/standard-dialog";
import { StatusPill } from "@/shared/ui/status-pill";
import { toast } from "@/shared/ui/toast";
import { ThinMeter } from "@/shared/ui/usage-meter";
import { RAISED_INPUT } from "@/shared/ui/wells";
import { minsAgo } from "../_data/company";
import { ALL_WEBHOOK_EVENTS, type EndpointRow } from "../_data/misc";
import { CallPanel, CallRow } from "../_components/calls";
import { useCalls, usePortal } from "../_components/portal-store";
import { Cell, FactChip, Id, PortalPage, Strip, fmt, ov, since } from "../_components/ui";

export function WebhooksSection() {
  const { state, update } = usePortal();
  const calls = useCalls();
  const endpoints = state.endpoints.filter((e) => e.env === state.env);
  const [openCall, setOpenCall] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["ask.answered"]);
  const call = openCall ? calls.find((c) => c.id === openCall) : null;
  const add = () => {
    const row: EndpointRow = { id: `wh_${state.endpoints.length + 1}`, env: state.env, url, description: "New endpoint", events, state: "healthy", successRate: 100, sent7d: 0, lastAt: minsAgo(0) };
    update((s) => ({ ...s, endpoints: [...s.endpoints, row] }));
    setAdding(false);
    setUrl("");
  };
  const sent = endpoints.reduce((n, e) => n + e.sent7d, 0);
  return (
    <PortalPage
      title="Webhooks"
      actions={<CreateButton onClick={() => setAdding(true)}>Add endpoint</CreateButton>}
      aside={call ? <CallPanel call={call} onClose={() => setOpenCall(null)} /> : undefined}
    >
      <Strip label="Summary">
        <Cell label="Endpoints" value={String(endpoints.length)} />
        <Cell label="Sent, 7 days" value={fmt(sent)} />
        <Cell label="Failing" value={String(endpoints.filter((e) => e.state === "failing").length)} />
      </Strip>
      {endpoints.map((e) => {
        const recent = calls.filter((c) => c.webhook?.endpointId === e.id).slice(0, 4);
        return (
          <section key={e.id} className={cn("white-card", ov.card)} aria-label={e.description}>
            <div className="flex items-center gap-3">
              <span className={ov.rowMain}>
                <span className="flex items-center gap-2">
                  <span className="text-title font-medium text-text-primary">{e.description}</span>
                  {e.state === "failing" ? (
                    <StatusPill tone="attention" dot>
                      Failing
                    </StatusPill>
                  ) : e.state === "paused" ? (
                    <StatusPill>Paused</StatusPill>
                  ) : (
                    <StatusPill tone="live" dot bare>
                      Healthy
                    </StatusPill>
                  )}
                </span>
                <Id className="text-caption">{e.url}</Id>
              </span>
              <span className="flex w-32 items-center gap-2">
                <span className="text-caption font-medium tabular-nums text-text-primary">{e.successRate}%</span>
                <ThinMeter used={e.successRate} limit={100} className="flex-1" />
              </span>
              <span className={ov.rowAside}>Last {since(e.lastAt)}</span>
              <button type="button" className={pillButton("outline", "sm")} onClick={() => toast({ title: `Test event sent to ${e.description}` })}>
                Send test
              </button>
              <button
                type="button"
                className={pillButton("quiet", "sm")}
                onClick={() => update((s) => ({ ...s, endpoints: s.endpoints.map((x) => (x.id === e.id ? { ...x, state: x.state === "paused" ? "healthy" : "paused" } : x)) }))}
              >
                {e.state === "paused" ? "Resume" : "Pause"}
              </button>
            </div>
            <span className="flex flex-wrap gap-1">
              {e.events.map((name) => (
                <FactChip key={name}>{name}</FactChip>
              ))}
            </span>
            {recent.length > 0 && (
              <ul className="m-0 flex list-none flex-col">
                {recent.map((c) => (
                  <CallRow key={c.id} call={c} selected={c.id === openCall} onOpen={() => setOpenCall(c.id)} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
      <StandardDialog open={adding} onClose={() => setAdding(false)} title="Add endpoint">
        <div className="flex flex-col gap-3">
          <input aria-label="Endpoint URL" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} className={cn(RAISED_INPUT, "h-8 px-3 font-mono")} />
          <span className="flex flex-wrap gap-1.5">
            {ALL_WEBHOOK_EVENTS.map((name) => {
              const on = events.includes(name);
              return (
                <button key={name} type="button" aria-pressed={on} onClick={() => setEvents(on ? events.filter((x) => x !== name) : [...events, name])} className={pillButton(on ? "ink" : "outline", "xs", { raise: false })}>
                  {name}
                </button>
              );
            })}
          </span>
        </div>
        <DialogActions>
          <button type="button" className={pillButton("quiet", "md")} onClick={() => setAdding(false)}>
            Cancel
          </button>
          <button type="button" disabled={!/^https:\/\/\S+\.\S+/.test(url)} className={cn(pillButton("ink", "md", { raise: false }), "disabled:opacity-60")} onClick={add}>
            Add endpoint
          </button>
        </DialogActions>
      </StandardDialog>
    </PortalPage>
  );
}
