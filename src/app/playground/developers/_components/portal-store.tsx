"use client";

/** The demo's local state: added integrations and API keys. Edits vanish on reload. No API, no DB. */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { IntegrationId } from "../_data/catalog";
import type { Env } from "../_data/logs";

export type OutputFormat = "plain" | "markdown";

export interface AddedIntegration {
  status: "testing" | "live";
  maxLines: number;
  format: OutputFormat;
}

export interface PortalState {
  env: Env;
  integrations: Partial<Record<IntegrationId, AddedIntegration>>;
  keys: Record<Env, string[]>;
}

const SEED: PortalState = {
  env: "live",
  integrations: {
    even_realities: { status: "live", maxLines: 4, format: "plain" },
    dopl_desktop: { status: "live", maxLines: 6, format: "plain" },
  },
  keys: { live: ["sk_live_demo-sample-fixture-only"], test: ["sk_test_demo-sample-fixture-only"] },
};

interface PortalApi {
  state: PortalState;
  update: (fn: (s: PortalState) => PortalState) => void;
}

const Ctx = createContext<PortalApi | null>(null);

export function PortalProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(SEED);
  const value = useMemo(() => ({ state, update: setState }), [state]);
  return <Ctx value={value}>{children}</Ctx>;
}

export function usePortal(): PortalApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("usePortal needs PortalProvider");
  return api;
}
