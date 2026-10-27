"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConnectCandidate, ConnectPageView, ConsentScope } from "@/features/device-sdk/server/connect/hosted";
import { pillButton } from "@/shared/ui/pill-button";

/**
 * The hosted Connect card: choose a device (with its compatibility pre-check) → pair → consent by
 * risk tier → done. Labels and controls only, no explainer copy (Samuel's minimal-UI ruling).
 *
 * ⚠ THE ACCENT IS THE DEVELOPER'S (`branding.accent_color`, validated `#RRGGBB` by the contracts),
 * so it is an inline style, not a token: a white-label page wears its customer's colour.
 */

const TIER_LABEL: Record<string, string> = {
  T0: "Read",
  T1: "Show and ask",
  T2: "Camera and microphone",
  T3: "Actions",
  T4: "Safety-critical · confirm every time",
};

const PRIMARY = `${pillButton("ink", "lg")} w-full justify-center`;
const ROW = "flex w-full items-center justify-between gap-3 rounded-card border border-border-subtle px-4 py-3 text-left";

async function post(token: string, step: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/connect/${encodeURIComponent(token)}/${step}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = (json.error as { message?: string } | undefined)?.message;
    throw new Error(message ?? "Something went wrong. Try again.");
  }
  return json;
}

export function ConnectFlow({ token, view }: { token: string; view: ConnectPageView }) {
  const { branding } = view;
  const accent = branding.accent_color ? { backgroundColor: branding.accent_color } : undefined;
  const [done, setDone] = useState(view.state === "done");

  return (
    <div className="w-full max-w-md rounded-card border border-border-subtle bg-white p-8">
      <header className="flex items-center gap-3">
        {branding.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={branding.logo_url} alt="" width={32} height={32} className="h-8 w-8 rounded-tile object-contain" />
        )}
        <span className="text-title font-medium text-text-primary">{branding.display_name ?? "Connect a device"}</span>
      </header>
      <div className="mt-6">
        {done ? (
          <h1 className="text-display font-semibold text-text-primary">Connected</h1>
        ) : view.state === "expired" ? (
          <h1 className="text-display font-semibold text-text-primary">This link has expired</h1>
        ) : view.state === "choose" ? (
          <ChooseAndPair token={token} candidates={view.candidates} accent={accent} />
        ) : view.state === "consent" ? (
          <Consent token={token} device={view.device} scopes={view.scopes} accent={accent} onDone={() => setDone(true)} />
        ) : null}
      </div>
    </div>
  );
}

function ChooseAndPair({
  token,
  candidates,
  accent,
}: {
  token: string;
  candidates: ConnectCandidate[];
  accent?: React.CSSProperties;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<ConnectCandidate | null>(null);
  const [shownCode, setShownCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const pick = (c: ConnectCandidate) =>
    run(async () => {
      const flow = await post(token, "pair", { adapter_id: c.adapter_id, kind: c.kind });
      setPicked(c);
      setShownCode(flow.method === "display_code" ? String(flow.code) : null);
    });

  const claim = (value: string) =>
    run(async () => {
      await post(token, "claim", { adapter_id: picked!.adapter_id, kind: picked!.kind, code: value });
      router.refresh();
    });

  if (candidates.length === 0) {
    return <h1 className="text-display font-semibold text-text-primary">No supported devices</h1>;
  }

  if (!picked) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-display font-semibold text-text-primary">Choose your device</h1>
        {candidates.map((c) => (
          <button
            key={`${c.adapter_id}:${c.kind}`}
            type="button"
            disabled={busy}
            onClick={() => pick(c)}
            className={`${ROW} cursor-pointer hover:bg-menu-item-hover-bg disabled:opacity-40`}
          >
            <span className="text-body font-medium text-text-primary">{c.label}</span>
            <span className="text-caption text-text-secondary">
              {c.supported.length}/{c.supported.length + c.unsupported.length} supported
            </span>
          </button>
        ))}
        {error && <p className="text-small text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-display font-semibold text-text-primary">{picked.label}</h1>
      {picked.unsupported.length > 0 && (
        <p className="text-caption text-text-secondary">Not supported: {picked.unsupported.join(", ")}</p>
      )}
      {shownCode !== null ? (
        <>
          <p className="text-label font-semibold uppercase tracking-wide text-text-muted">Code</p>
          <p className="font-mono text-stat tabular-nums text-text-primary">{shownCode}</p>
          <button type="button" disabled={busy} onClick={() => claim(shownCode)} className={PRIMARY} style={accent}>
            Continue
          </button>
        </>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void claim(code);
          }}
        >
          <label className="text-label font-semibold uppercase tracking-wide text-text-muted" htmlFor="connect-code">
            Code on your glasses
          </label>
          <input
            id="connect-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            className="rounded-field border border-border-subtle px-3 py-2 font-mono text-title tracking-widest text-text-primary"
          />
          <button type="submit" disabled={busy || code.trim().length === 0} className={PRIMARY} style={accent}>
            Pair
          </button>
        </form>
      )}
      {error && <p className="text-small text-danger">{error}</p>}
    </div>
  );
}

function Consent({
  token,
  device,
  scopes,
  accent,
  onDone,
}: {
  token: string;
  device: string;
  scopes: ConsentScope[];
  accent?: React.CSSProperties;
  onDone: () => void;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(scopes.map((s) => [s.scope, s.checked]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tiers = [...new Set(scopes.map((s) => s.tier))];
  const chosen = scopes.filter((s) => checked[s.scope]).map((s) => s.scope);

  async function allow() {
    setBusy(true);
    setError(null);
    try {
      const out = await post(token, "consent", { scopes: chosen });
      if (typeof out.redirect_url === "string") window.location.assign(out.redirect_url);
      else onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-display font-semibold text-text-primary">{device}</h1>
      {tiers.map((tier) => (
        <fieldset key={tier} className="flex flex-col gap-2">
          <legend className="text-label font-semibold uppercase tracking-wide text-text-muted">{TIER_LABEL[tier] ?? tier}</legend>
          {scopes
            .filter((s) => s.tier === tier)
            .map((s) => (
              <label key={s.scope} className={`${ROW} cursor-pointer`}>
                <span className="font-mono text-body text-text-primary">{s.scope}</span>
                <input
                  type="checkbox"
                  checked={checked[s.scope] ?? false}
                  onChange={(e) => setChecked((prev) => ({ ...prev, [s.scope]: e.target.checked }))}
                />
              </label>
            ))}
        </fieldset>
      ))}
      <button type="button" disabled={busy || chosen.length === 0} onClick={allow} className={PRIMARY} style={accent}>
        Allow
      </button>
      {error && <p className="text-small text-danger">{error}</p>}
    </div>
  );
}
