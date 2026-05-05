"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  INTEGRATION_PROVIDERS,
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_LOGO_URL,
  PROVIDER_TAGLINES,
} from "../constants";
import type { IntegrationProvider } from "../types";

type ConnectionSummary = {
  id: string;
  provider: IntegrationProvider;
  alias: string;
  status: "connected" | "needs_auth" | "error";
  account_email: string | null;
  account_label: string | null;
  last_used_at: string | null;
  granted_workspace_ids: string[];
};

type WorkspaceSummary = { id: string; slug: string; name: string };

type LoadState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

const POPUP_FEATURES = "width=600,height=720,menubar=no,toolbar=no,popup=yes";

/**
 * Body of /settings/integrations. Lives inside the page's full-bleed
 * panel — no outer container or max-width here. Renders one row per
 * provider, each expandable into per-account sub-rows with grant
 * controls. The popup OAuth handshake happens here too: open the
 * broker URL in `window.open`, listen for the postMessage from the
 * popup-success page, refresh the list.
 */
export function IntegrationsManager() {
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  // Track the popup-watch interval so it can be cleared when the
  // popup posts back (success path) — without this the interval keeps
  // polling `popup.closed` forever, leaking timers.
  const popupWatchIntervalRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [connsRes, wsRes] = await Promise.all([
        fetch("/api/integrations/connections"),
        fetch("/api/integrations/workspaces"),
      ]);
      if (!connsRes.ok || !wsRes.ok) {
        throw new Error("Failed to load");
      }
      const connsBody = (await connsRes.json()) as {
        connections: ConnectionSummary[];
      };
      const wsBody = (await wsRes.json()) as { workspaces: WorkspaceSummary[] };
      setConnections(connsBody.connections);
      setWorkspaces(wsBody.workspaces);
      setLoad({ kind: "ready" });
    } catch (err) {
      setLoad({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clearPopupWatch = useCallback(() => {
    if (popupWatchIntervalRef.current !== null) {
      window.clearInterval(popupWatchIntervalRef.current);
      popupWatchIntervalRef.current = null;
    }
  }, []);

  // Listen for the OAuth popup's done message and refresh.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      if (
        typeof ev.data === "object" &&
        ev.data !== null &&
        (ev.data as { type?: string }).type === "dopl:integration:result"
      ) {
        clearPopupWatch();
        void refresh();
        setBusyProvider(null);
      }
    }
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      clearPopupWatch();
    };
  }, [refresh, clearPopupWatch]);

  async function handleConnect(provider: IntegrationProvider) {
    setBusyProvider(provider);
    try {
      const res = await fetch(
        `/api/integrations/${encodeURIComponent(provider)}/connect`,
        { method: "POST" }
      );
      if (!res.ok) {
        setBusyProvider(null);
        alert(`Couldn't start the connection (HTTP ${res.status}).`);
        return;
      }
      const body = (await res.json()) as
        | { status: "connected"; connection_id: string }
        | { status: "needs_auth"; auth_url: string; connection_id: string };
      if (body.status === "connected") {
        await refresh();
        setBusyProvider(null);
        return;
      }
      const popup = window.open(body.auth_url, "dopl-oauth", POPUP_FEATURES);
      if (!popup) {
        setBusyProvider(null);
        alert(
          "Your browser blocked the connect popup. Allow popups for this site and try again."
        );
        return;
      }
      // Watchdog: if the popup is closed without firing the
      // postMessage (some browsers eat cross-origin posts even on the
      // same origin during dev), clear the busy state and re-fetch in
      // case the connection finalized server-side. The interval is
      // cleared in `onMessage` (success) or on unmount.
      clearPopupWatch();
      popupWatchIntervalRef.current = window.setInterval(() => {
        if (popup.closed) {
          clearPopupWatch();
          setBusyProvider((current) =>
            current === provider ? null : current
          );
          void refresh();
        }
      }, 700);
    } catch {
      setBusyProvider(null);
      alert("Couldn't start the connection.");
    }
  }

  async function handleDisconnect(connectionId: string, label: string) {
    if (!window.confirm(`Disconnect ${label}? You can reconnect anytime.`)) {
      return;
    }
    const res = await fetch(
      `/api/integrations/connections/${connectionId}`,
      { method: "DELETE" }
    ).catch(() => null);
    if (!res || !res.ok) {
      alert("Couldn't disconnect. Try again.");
      return;
    }
    await refresh();
  }

  async function handleGrantsChange(
    connectionId: string,
    workspaceIds: string[]
  ) {
    const res = await fetch(
      `/api/integrations/connections/${connectionId}/grants`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_ids: workspaceIds }),
      }
    );
    if (!res.ok) {
      alert("Couldn't update workspace access. Try again.");
      return;
    }
    await refresh();
  }

  if (load.kind === "loading") {
    return <p className="text-sm text-text-tertiary">Loading integrations…</p>;
  }
  if (load.kind === "error") {
    return (
      <p className="text-sm text-red-400">
        Couldn&apos;t load integrations: {load.message}
      </p>
    );
  }

  // Group connections by provider for the per-provider sections.
  const byProvider = new Map<IntegrationProvider, ConnectionSummary[]>();
  for (const c of connections) {
    const existing = byProvider.get(c.provider) ?? [];
    existing.push(c);
    byProvider.set(c.provider, existing);
  }

  return (
    <ul className="space-y-2">
      {INTEGRATION_PROVIDERS.map((provider) => {
        const accounts = byProvider.get(provider) ?? [];
        const isBusy = busyProvider === provider;
        return (
          <li
            key={provider}
            className="rounded-xl border border-white/[0.08] bg-white/[0.015] overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 py-3">
              <ProviderLogo provider={provider} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary">
                  {PROVIDER_DISPLAY_NAMES[provider]}
                </p>
                <p className="text-xs text-text-tertiary truncate">
                  {PROVIDER_TAGLINES[provider]}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleConnect(provider)}
                disabled={isBusy}
                className="rounded-md bg-white text-black px-3 py-1.5 text-xs font-medium hover:bg-white/90 disabled:opacity-50"
              >
                {isBusy
                  ? "Connecting…"
                  : accounts.length === 0
                    ? "Connect"
                    : "Add account"}
              </button>
            </div>

            {accounts.length > 0 ? (
              <ul className="border-t border-white/[0.06] divide-y divide-white/[0.04]">
                {accounts.map((c) => (
                  <ConnectionRow
                    key={c.id}
                    connection={c}
                    workspaces={workspaces}
                    onDisconnect={() =>
                      handleDisconnect(
                        c.id,
                        c.account_email ?? PROVIDER_DISPLAY_NAMES[provider]
                      )
                    }
                    onGrantsChange={(wsIds) => handleGrantsChange(c.id, wsIds)}
                  />
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function ProviderLogo({ provider }: { provider: IntegrationProvider }) {
  const url = PROVIDER_LOGO_URL[provider];
  if (url) {
    return (
      <span className="grid place-items-center h-9 w-9 rounded-lg border border-white/[0.06] bg-black/30 shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="h-4 w-4" />
      </span>
    );
  }
  const initial = PROVIDER_DISPLAY_NAMES[provider].slice(0, 1);
  return (
    <span className="grid place-items-center h-9 w-9 rounded-lg border border-white/[0.06] bg-white/[0.04] text-sm font-medium text-text-secondary shrink-0">
      {initial}
    </span>
  );
}

const STATUS_DOT: Record<ConnectionSummary["status"], string> = {
  connected: "bg-emerald-400",
  needs_auth: "bg-amber-400",
  error: "bg-red-400",
};

const STATUS_LABEL: Record<ConnectionSummary["status"], string> = {
  connected: "Connected",
  needs_auth: "Awaiting authorization",
  error: "Error",
};

function ConnectionRow({
  connection,
  workspaces,
  onDisconnect,
  onGrantsChange,
}: {
  connection: ConnectionSummary;
  workspaces: WorkspaceSummary[];
  onDisconnect: () => void;
  onGrantsChange: (workspaceIds: string[]) => void;
}) {
  const grants = new Set(connection.granted_workspace_ids);
  const accountLabel =
    connection.account_email ??
    connection.account_label ??
    connection.alias ??
    "Account";
  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <span
          className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[connection.status]}`}
          aria-hidden
        />
        <p className="text-sm text-text-primary truncate">{accountLabel}</p>
        <span className="text-[10px] uppercase tracking-wide text-text-tertiary">
          {STATUS_LABEL[connection.status]}
        </span>
        <div className="ml-auto">
          <button
            type="button"
            onClick={onDisconnect}
            className="text-xs text-text-tertiary hover:text-text-secondary"
          >
            Disconnect
          </button>
        </div>
      </div>

      {workspaces.length > 0 ? (
        <details className="mt-1 group">
          <summary className="text-[11px] text-text-tertiary cursor-pointer hover:text-text-secondary list-none flex items-center gap-1">
            <span className="group-open:rotate-90 transition-transform inline-block">
              ▸
            </span>
            Used in {grants.size}/{workspaces.length} workspace
            {workspaces.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 ml-4 space-y-1.5">
            {workspaces.map((ws) => {
              const checked = grants.has(ws.id);
              return (
                <li key={ws.id}>
                  <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(grants);
                        if (e.target.checked) next.add(ws.id);
                        else next.delete(ws.id);
                        onGrantsChange(Array.from(next));
                      }}
                      className="h-3.5 w-3.5 rounded border-white/20 bg-transparent"
                    />
                    <span className="truncate">{ws.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </li>
  );
}
