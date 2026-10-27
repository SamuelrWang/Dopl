"use client";

import { useEffect, useRef, useState } from "react";
import type { ConnectCandidate, ConnectPageView } from "@/features/device-sdk/server/connect/hosted";
import { ConnectFlow } from "@/app/connect/[token]/connect-flow";
import { pillButton } from "@/shared/ui/pill-button";
import { Card } from "../_components/ui";
import { DEMO_PROJECT } from "../_data/fixtures";

/**
 * The END USER's hosted Connect screen (`/connect/{token}`), rendered from the real `ConnectFlow`
 * with a fake view and Acme's branding. ConnectFlow is untouched: its POSTs to
 * `/api/connect/{token}/{step}` are answered in the browser by a fetch shim scoped to the demo
 * token's prefix (installed on mount, removed on unmount), so nothing reaches the API.
 */
const DEMO_TOKEN_PREFIX = "demo_acme_";

const BRANDING = { ...DEMO_PROJECT.branding };

const CANDIDATES: ConnectCandidate[] = [
  { adapter_id: "even_g2", kind: "glasses", label: "Even G2", pairing: "enter_code", supported: ["present.*", "ask.*", "input.*"], unsupported: ["capture.photo"] },
  { adapter_id: "desktop", kind: "desktop", label: "Dopl desktop", pairing: "display_code", supported: ["present.notify"], unsupported: ["ask.*", "input.*", "capture.photo"] },
  { adapter_id: "simulator", kind: "glasses", label: "Simulated glasses", pairing: "display_code", supported: ["present.*", "ask.*", "input.*", "capture.photo"], unsupported: [] },
];

const CHOOSE: ConnectPageView = { state: "choose", branding: BRANDING, candidates: CANDIDATES };

const consentFor = (device: string): ConnectPageView => ({
  state: "consent",
  branding: BRANDING,
  device,
  scopes: [
    { scope: "presence.read", tier: "T0", checked: true },
    { scope: "present.*", tier: "T1", checked: true },
    { scope: "ask.*", tier: "T1", checked: true },
    { scope: "input.*", tier: "T1", checked: true },
    { scope: "capture.photo", tier: "T2", checked: false },
  ],
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

export function ConnectPreviewSection() {
  const [run, setRun] = useState(0);
  const [view, setView] = useState<ConnectPageView>(CHOOSE);
  const token = `${DEMO_TOKEN_PREFIX}${run}`;
  const picked = useRef<string>("Even G2");

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
        setView(consentFor(picked.current));
        return json({ ok: true });
      }
      return json({ connection_id: "conn_demo" });
    };
    return () => {
      window.fetch = realFetch;
    };
  }, []);

  return (
    <Card
      title="Connect"
      aside={
        <button
          type="button"
          className={pillButton("outline", "sm")}
          onClick={() => {
            setView(CHOOSE);
            setRun((n) => n + 1);
          }}
        >
          Restart
        </button>
      }
    >
      <div className="card-well flex justify-center px-5 py-12">
        <ConnectFlow key={`${token}:${view.state}`} token={token} view={view} />
      </div>
    </Card>
  );
}
