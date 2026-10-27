"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { CapabilityScope, RiskTier } from "@dopl/contracts/device-sdk";
import type { ConnectCandidate, ConnectPageView } from "@/features/device-sdk/server/connect/hosted";
import { ConnectFlow } from "@/app/connect/[token]/connect-flow";
import { cn } from "@/shared/lib/utils";
import { NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import { pillButton } from "@/shared/ui/pill-button";
import { StatusPill } from "@/shared/ui/status-pill";
import { RAISED_INPUT } from "@/shared/ui/wells";
import { usePortal } from "../_components/portal-context";
import { editConnect, publishConnect, resetConnect } from "../_components/portal-actions";
import { Card, PageHeader, TierChip, ov } from "../_components/ui";
import { configDirty, scopesByTier, tierOfScope, type ConnectConfig } from "../_data/connect-config";
import { ADDABLE_TYPES } from "../_data/device-types";
import { TypeStatusPill } from "./devices";

/**
 * CONNECT CUSTOMIZATION (Plaid's Link customization, Smartcar's vehicle access): the END USER's
 * hosted Connect screen (`/connect/{token}`), rendered from the real `ConnectFlow` with the draft
 * settings beside it. ConnectFlow is untouched: its POSTs to `/api/connect/{token}/{step}` are
 * answered in the browser by a fetch shim scoped to the demo token's prefix (installed on mount,
 * removed on unmount), so nothing reaches the API.
 */
const DEMO_TOKEN_PREFIX = "demo_acme_";

const CANDIDATES: ConnectCandidate[] = [
  { adapter_id: "even_g2", kind: "glasses", label: "Even G2", pairing: "enter_code", supported: ["present.*", "ask.*", "input.*"], unsupported: ["capture.photo"] },
  { adapter_id: "desktop", kind: "desktop", label: "Dopl desktop", pairing: "display_code", supported: ["present.notify"], unsupported: ["ask.*", "input.*", "capture.photo"] },
  { adapter_id: "simulator", kind: "glasses", label: "Simulated glasses", pairing: "display_code", supported: ["present.*", "ask.*", "input.*", "capture.photo"], unsupported: [] },
];

const LOW_TIERS: readonly RiskTier[] = ["T0", "T1"];

function viewOf(config: ConnectConfig, phase: { device: string } | null): ConnectPageView {
  if (!phase) {
    const allowed = new Set(ADDABLE_TYPES.filter((t) => config.allowed_types.includes(t.id)).map((t) => t.adapter_id));
    return { state: "choose", branding: config.branding, candidates: CANDIDATES.filter((c) => allowed.has(c.adapter_id)) };
  }
  return {
    state: "consent",
    branding: config.branding,
    device: phase.device,
    scopes: config.scopes.map((scope) => ({ scope, tier: tierOfScope(scope), checked: LOW_TIERS.includes(tierOfScope(scope)) })),
  };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

export function ConnectPreviewSection() {
  const { store } = usePortal();
  const { draft, published } = store.connect;
  const dirty = configDirty(draft, published);
  const [run, setRun] = useState(0);
  const [phase, setPhase] = useState<{ device: string } | null>(null);
  const token = `${DEMO_TOKEN_PREFIX}${run}`;
  const picked = useRef<string>("Even G2");
  const view = viewOf(draft, phase);

  useEffect(() => {
    const realFetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const m = url.match(/\/api\/connect\/([^/]+)\/(pair|claim|consent)$/);
      if (!m || !decodeURIComponent(m[1]).startsWith(DEMO_TOKEN_PREFIX)) return realFetch(input, init);
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { adapter_id?: string };
      if (m[2] === "pair") {
        picked.current = CANDIDATES.find((c) => c.adapter_id === body.adapter_id)?.label ?? "Device";
        return json(body.adapter_id === "even_g2" ? { method: "enter_code" } : { method: "display_code", code: "K7Q2-94" });
      }
      if (m[2] === "claim") {
        setPhase({ device: picked.current });
        return json({ ok: true });
      }
      return json({ connection_id: "conn_demo" });
    };
    return () => {
      window.fetch = realFetch;
    };
  }, []);

  return (
    <>
      <PageHeader
        title="Connect customization"
        action={
          <>
            {dirty ? <StatusPill tone="attention">Draft</StatusPill> : <StatusPill tone="live" dot bare>Published</StatusPill>}
            <button type="button" disabled={!dirty} className={cn(pillButton("quiet", "md"), "disabled:opacity-60")} onClick={resetConnect}>
              Reset
            </button>
            <button type="button" disabled={!dirty} className={cn(pillButton("ink", "lg"), "disabled:opacity-60")} onClick={publishConnect}>
              Publish
            </button>
          </>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3.5">
        <Card
          title="Preview"
          className="sticky top-0"
          aside={
            <button
              type="button"
              className={pillButton("outline", "sm")}
              onClick={() => {
                setPhase(null);
                setRun((n) => n + 1);
              }}
            >
              Restart
            </button>
          }
        >
          <div className="card-well flex justify-center px-5 py-12">
            <ConnectFlow key={`${token}:${view.state}:${JSON.stringify(draft)}`} token={token} view={view} />
          </div>
        </Card>
        <div className="flex min-w-0 flex-col gap-3.5">
          <BrandingCard config={draft} />
          <DeviceTypesCard config={draft} />
          <ScopesCard config={draft} />
          <RedirectsCard config={draft} />
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={ov.cellLabel}>{label}</span>
      {children}
    </label>
  );
}

function BrandingCard({ config }: { config: ConnectConfig }) {
  const b = config.branding;
  const set = (patch: Partial<ConnectConfig["branding"]>) => editConnect((c) => ({ ...c, branding: { ...c.branding, ...patch } }));
  return (
    <Card title="Branding">
      <Field label="Name">
        <input value={b.display_name ?? ""} onChange={(e) => set({ display_name: e.target.value || undefined })} className={cn(RAISED_INPUT, "h-8 px-3")} />
      </Field>
      <Field label="Logo URL">
        <input
          value={b.logo_url ?? ""}
          placeholder="https://"
          onChange={(e) => set({ logo_url: e.target.value || undefined })}
          className={cn(RAISED_INPUT, "h-8 px-3 font-mono")}
        />
      </Field>
      <Field label="Accent">
        <span className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Accent colour"
            value={b.accent_color ?? "#000000"}
            onChange={(e) => set({ accent_color: e.target.value })}
            className="h-8 w-10 shrink-0 rounded-field border border-border-default bg-bg-overlay p-0.5"
          />
          <span className="font-mono text-small text-text-primary">{b.accent_color}</span>
        </span>
      </Field>
    </Card>
  );
}

function DeviceTypesCard({ config }: { config: ConnectConfig }) {
  const { env, typeState } = usePortal();
  return (
    <Card title="Device types" count={config.allowed_types.length}>
      <ul className={ov.rows}>
        {ADDABLE_TYPES.map((t) => {
          const state = typeState(t.id, null);
          const locked = env === "live" && state.status !== "connected";
          const on = config.allowed_types.includes(t.id);
          return (
            <li key={t.id} className={cn(ov.row, locked && "opacity-60")}>
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  checked={on && !locked}
                  disabled={locked}
                  onChange={() =>
                    editConnect((c) => ({
                      ...c,
                      allowed_types: on ? c.allowed_types.filter((x) => x !== t.id) : [...c.allowed_types, t.id],
                    }))
                  }
                />
                <span className={ov.rowTitle}>{t.name}</span>
              </label>
              <TypeStatusPill state={state} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ScopesCard({ config }: { config: ConnectConfig }) {
  const toggle = (s: CapabilityScope) =>
    editConnect((c) => ({ ...c, scopes: c.scopes.includes(s) ? c.scopes.filter((x) => x !== s) : [...c.scopes, s] }));
  return (
    <Card title="Default scopes" count={`${config.scopes.length} selected`}>
      {scopesByTier().map(({ tier, scopes }) => (
        <div key={tier} className="flex items-start gap-2.5">
          <span className="w-8 shrink-0 pt-0.5">
            <TierChip tier={tier} />
          </span>
          <span className="flex flex-wrap gap-1.5">
            {scopes.map((s) => {
              const on = config.scopes.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(s)}
                  className={cn(pillButton(on ? "ink" : "outline", "xs", { raise: false }), "font-mono")}
                >
                  {s}
                </button>
              );
            })}
          </span>
        </div>
      ))}
    </Card>
  );
}

function RedirectsCard({ config }: { config: ConnectConfig }) {
  const [next, setNext] = useState("");
  const ok = /^https:\/\/[^\s/]+\.[^\s]+/.test(next) && !config.redirect_uris.includes(next);
  return (
    <Card title="Redirect URIs" count={config.redirect_uris.length}>
      <ul className={ov.rows}>
        {config.redirect_uris.map((u, i) => (
          <li key={u} className={ov.row}>
            <span className={cn(ov.rowTitle, "min-w-0 flex-1 font-mono")}>{u}</span>
            {i === 0 && <StatusPill>Default</StatusPill>}
            <button
              type="button"
              aria-label={`Remove ${u}`}
              className={cn(NAKED_ICON_BUTTON, "p-1")}
              onClick={() => editConnect((c) => ({ ...c, redirect_uris: c.redirect_uris.filter((x) => x !== u) }))}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <span className="flex gap-2">
        <input value={next} placeholder="https://" onChange={(e) => setNext(e.target.value)} className={cn(RAISED_INPUT, "h-8 flex-1 px-3 font-mono")} />
        <button
          type="button"
          disabled={!ok}
          className={cn(pillButton("outline", "md"), "disabled:opacity-60")}
          onClick={() => {
            editConnect((c) => ({ ...c, redirect_uris: [...c.redirect_uris, next] }));
            setNext("");
          }}
        >
          Add
        </button>
      </span>
    </Card>
  );
}
