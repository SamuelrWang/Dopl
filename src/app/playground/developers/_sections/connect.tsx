"use client";

/**
 * Connect page: allowed integrations, branding and scopes beside the END USER's real hosted screen
 * (`ConnectFlow`). Its POSTs to `/api/connect/{token}/{step}` are answered in the browser by a fetch
 * shim scoped to the demo token's prefix, so nothing reaches the API.
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { CapabilityScope, RiskTier } from "@dopl/device-contracts";
import { CAPABILITY_FAMILY, CAPABILITY_RISK_TIER, type CapabilityId } from "@dopl/device-contracts";
import type { ConnectCandidate, ConnectPageView } from "@/features/device-sdk/server/connect/hosted";
import { ConnectFlow } from "@/app/connect/[token]/connect-flow";
import { cn } from "@/shared/lib/utils";
import { NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import { pillButton } from "@/shared/ui/pill-button";
import { SECTION_TITLE } from "@/shared/ui/section-title";
import { StatusPill } from "@/shared/ui/status-pill";
import { Switch } from "@/shared/ui/switch";
import { RAISED_INPUT } from "@/shared/ui/wells";
import { INTEGRATIONS, categoryById } from "../_data/catalog";
import { scopesByTier, type ConnectConfig } from "../_data/misc";
import { usePortal } from "../_components/portal-store";
import { Card, IntegrationStatusPill, PortalPage, TierChip, ov } from "../_components/ui";

const DEMO_TOKEN_PREFIX = "demo_larkfield_";

const CANDIDATES: Record<string, ConnectCandidate> = {
  even_realities: { adapter_id: "even_g2", kind: "glasses", label: "Even Realities G2", pairing: "enter_code", supported: ["present.*", "ask.*", "input.*"], unsupported: ["capture.photo"] },
  dopl_desktop: { adapter_id: "desktop", kind: "desktop", label: "Dopl desktop app", pairing: "display_code", supported: ["present.notify"], unsupported: ["ask.*", "input.*", "capture.photo"] },
};

const LOW_TIERS: readonly RiskTier[] = ["T0", "T1"];

function tierOfScope(scope: CapabilityScope): RiskTier {
  if (!scope.endsWith(".*")) return CAPABILITY_RISK_TIER[scope as CapabilityId];
  const family = scope.slice(0, -2);
  const ids = (Object.keys(CAPABILITY_RISK_TIER) as CapabilityId[]).filter((id) => CAPABILITY_FAMILY[id] === family);
  return (["T0", "T1", "T2", "T3", "T4"] as RiskTier[]).find((t) => ids.some((id) => CAPABILITY_RISK_TIER[id] === t)) ?? "T0";
}

function viewOf(config: ConnectConfig, phase: { device: string } | null): ConnectPageView {
  const branding = { display_name: config.displayName, logo_url: config.logoUrl || undefined, accent_color: config.accent };
  if (!phase) {
    return { state: "choose", branding, candidates: config.allowedIntegrations.map((id) => CANDIDATES[id]).filter(Boolean) };
  }
  return {
    state: "consent",
    branding,
    device: phase.device,
    scopes: config.scopes.map((scope) => ({ scope, tier: tierOfScope(scope), checked: LOW_TIERS.includes(tierOfScope(scope)) })),
  };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function Preview({ draft }: { draft: ConnectConfig }) {
  const [run, setRun] = useState(0);
  const [phase, setPhase] = useState<{ device: string } | null>(null);
  const picked = useRef("Even Realities G2");
  const token = `${DEMO_TOKEN_PREFIX}${run}`;
  useEffect(() => {
    const realFetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const m = url.match(/\/api\/connect\/([^/]+)\/(pair|claim|consent)$/);
      if (!m || !decodeURIComponent(m[1]).startsWith(DEMO_TOKEN_PREFIX)) return realFetch(input, init);
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { adapter_id?: string };
      if (m[2] === "pair") {
        picked.current = Object.values(CANDIDATES).find((c) => c.adapter_id === body.adapter_id)?.label ?? "Device";
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
  const view = viewOf(draft, phase);
  return (
    <div className="flex min-w-0 flex-col gap-3 p-1">
      <div className="flex items-center justify-between">
        <h2 className={SECTION_TITLE}>End user preview</h2>
        <button
          type="button"
          className={pillButton("outline", "xs")}
          onClick={() => {
            setPhase(null);
            setRun((n) => n + 1);
          }}
        >
          Restart
        </button>
      </div>
      <div className="card-well flex justify-center px-3 py-8">
        <ConnectFlow key={`${token}:${view.state}:${JSON.stringify(draft)}`} token={token} view={view} />
      </div>
    </div>
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

export function ConnectSection() {
  const { state, update } = usePortal();
  const { draft, published } = state.connect;
  const dirty = JSON.stringify(draft) !== JSON.stringify(published);
  const edit = (patch: Partial<ConnectConfig>) => update((s) => ({ ...s, connect: { ...s.connect, draft: { ...s.connect.draft, ...patch } } }));
  const [next, setNext] = useState("");
  return (
    <PortalPage
      title="Connect page"
      aside={<Preview draft={draft} />}
      asideWidth={420}
      actions={
        <>
          {dirty ? (
            <StatusPill tone="attention">Draft</StatusPill>
          ) : (
            <StatusPill tone="live" dot bare>
              Published
            </StatusPill>
          )}
          <button type="button" disabled={!dirty} className={cn(pillButton("ink", "lg", { raise: false }), "disabled:opacity-60")} onClick={() => update((s) => ({ ...s, connect: { ...s.connect, published: s.connect.draft } }))}>
            Publish
          </button>
        </>
      }
    >
      <Card title="Allowed integrations" count={draft.allowedIntegrations.length}>
        <ul className={ov.rows}>
          {INTEGRATIONS.filter((i) => state.integrations[i.id]).map((i) => {
            const on = draft.allowedIntegrations.includes(i.id);
            return (
              <li key={i.id} className={ov.row}>
                <span className={ov.rowMain}>
                  <span className={ov.rowTitle}>{i.name}</span>
                  <span className={ov.rowMeta}>{categoryById(i.categoryId).name}</span>
                </span>
                <IntegrationStatusPill status={state.integrations[i.id]!.status} />
                <Switch
                  aria-label={`Allow ${i.name}`}
                  checked={on}
                  onChange={() => edit({ allowedIntegrations: on ? draft.allowedIntegrations.filter((x) => x !== i.id) : [...draft.allowedIntegrations, i.id] })}
                />
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title="Branding">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input value={draft.displayName} onChange={(e) => edit({ displayName: e.target.value })} className={cn(RAISED_INPUT, "h-8 px-3")} />
          </Field>
          <Field label="Logo URL">
            <input value={draft.logoUrl} placeholder="https://" onChange={(e) => edit({ logoUrl: e.target.value })} className={cn(RAISED_INPUT, "h-8 px-3 font-mono")} />
          </Field>
        </div>
      </Card>
      <Card title="Requested scopes" count={`${draft.scopes.length} selected`}>
        {scopesByTier().map(({ tier, scopes }) => (
          <div key={tier} className="flex items-start gap-2.5">
            <span className="w-8 shrink-0 pt-0.5">
              <TierChip tier={tier} />
            </span>
            <span className="flex flex-wrap gap-1.5">
              {scopes.map((s) => {
                const on = draft.scopes.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    onClick={() => edit({ scopes: on ? draft.scopes.filter((x) => x !== s) : [...draft.scopes, s] })}
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
      <Card title="Redirect URIs" count={draft.redirects.length}>
        <ul className={ov.rows}>
          {draft.redirects.map((u) => (
            <li key={u} className={ov.row}>
              <span className={cn(ov.rowTitle, "min-w-0 flex-1 font-mono text-caption")}>{u}</span>
              <button type="button" aria-label={`Remove ${u}`} className={cn(NAKED_ICON_BUTTON, "p-1")} onClick={() => edit({ redirects: draft.redirects.filter((x) => x !== u) })}>
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <span className="flex gap-2">
          <input value={next} placeholder="https://" onChange={(e) => setNext(e.target.value)} className={cn(RAISED_INPUT, "h-8 flex-1 px-3 font-mono")} />
          <button
            type="button"
            disabled={!/^https:\/\/\S+\.\S+/.test(next)}
            className={cn(pillButton("outline", "md"), "disabled:opacity-60")}
            onClick={() => {
              edit({ redirects: [...draft.redirects, next] });
              setNext("");
            }}
          >
            Add
          </button>
        </span>
      </Card>
    </PortalPage>
  );
}
