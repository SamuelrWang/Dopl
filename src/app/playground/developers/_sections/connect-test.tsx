"use client";

/**
 * The test link: the END USER's real hosted screen (`ConnectFlow`) in a popup, drawn from the draft.
 * Its POSTs to `/api/connect/{token}/{step}` are answered in the browser by a fetch shim scoped to the
 * demo token's prefix, so nothing reaches the API.
 */
import { useEffect, useRef, useState } from "react";
import type { CapabilityScope, RiskTier } from "@dopl/device-contracts";
import { CAPABILITY_FAMILY, CAPABILITY_RISK_TIER, type CapabilityId } from "@dopl/device-contracts";
import type { ConnectCandidate, ConnectPageView } from "@/features/device-sdk/server/connect/hosted";
import { ConnectFlow } from "@/app/connect/[token]/connect-flow";
import { Button } from "../_design/ui";
import { PreviewStage } from "../_design/ui-output";
import { FlowDialog, Grow } from "../_design/ui-page";
import type { ConnectConfig } from "../_data/misc";

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
  if (!phase) return { state: "choose", branding, candidates: config.allowedIntegrations.map((id) => CANDIDATES[id]).filter(Boolean) };
  return { state: "consent", branding, device: phase.device, scopes: config.scopes.map((scope) => ({ scope, tier: tierOfScope(scope), checked: LOW_TIERS.includes(tierOfScope(scope)) })) };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

export function ConnectTest({ draft, onClose }: { draft: ConnectConfig; onClose: () => void }) {
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
    <FlowDialog
      label="Test link"
      eyebrow="Test link"
      title="What your users see"
      onDismiss={onClose}
      foot={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              setPhase(null);
              setRun((n) => n + 1);
            }}
          >
            Restart
          </Button>
          <Grow />
          <Button variant="ink" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <PreviewStage>
        <ConnectFlow key={`${token}:${view.state}`} token={token} view={view} />
      </PreviewStage>
    </FlowDialog>
  );
}
