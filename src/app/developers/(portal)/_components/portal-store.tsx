"use client";

/**
 * The demo's local state: one provider in the route's layout, so edits survive moving between pages
 * and vanish on reload. No API, no DB. Sections read `usePortal()` and write with `update`.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { CapabilityId } from "@dopl/device-contracts";
import { ALL_CALLS, type Call } from "../_data/activity";
import { MEMBERS, PROJECTS, type Env, type Member } from "../_data/company";
import {
  INTEGRATIONS,
  SEED_INTEGRATIONS,
  integrationById,
  seedCapabilities,
  type CapabilitySetting,
  type CategoryId,
  type IntegrationId,
  type IntegrationStatus,
  type ModelId,
} from "../_data/catalog";
import { SEED_CONNECT, SEED_ENDPOINTS, SEED_KEYS, type ApiKeyRow, type ConnectConfig, type EndpointRow } from "../_data/misc";
import { seedReceives, type ReceivesState } from "../_data/receives";
import { ALL_USERS, type DeviceState, type PortalUser, type UserPrefs } from "../_data/users";

export interface AddedIntegration {
  status: IntegrationStatus;
  addedAt: string;
  testsPassed: number;
}

export interface SavedView {
  id: string;
  name: string;
  filters: UserFilters;
}

export interface UserFilters {
  q: string;
  category: string;
  integration: string;
  model: string;
  status: string;
  issues: string;
  firmware: string;
  active: string;
}

export const NO_FILTERS: UserFilters = { q: "", category: "all", integration: "all", model: "all", status: "all", issues: "all", firmware: "all", active: "all" };

export interface PortalState {
  env: Env;
  project: string;
  integrations: Partial<Record<IntegrationId, AddedIntegration>>;
  /** Rules live on the category; a model overrides inside it. */
  receives: Partial<Record<CategoryId, ReceivesState>>;
  capabilities: Partial<Record<ModelId, Partial<Record<CapabilityId, CapabilitySetting>>>>;
  deviceStates: Record<string, DeviceState>;
  revoked: string[];
  prefs: Record<string, UserPrefs>;
  mutedIssues: string[];
  savedViews: SavedView[];
  keys: ApiKeyRow[];
  endpoints: EndpointRow[];
  members: Member[];
  connect: { draft: ConnectConfig; published: ConnectConfig };
  checklist: { key: boolean; webhook: boolean };
  sentCalls: Call[];
}

const SEED_VIEWS: SavedView[] = [
  { id: "view_relink", name: "Needs relink", filters: { ...NO_FILTERS, issues: "relink" } },
  { id: "view_dormant", name: "Quiet for 2 days", filters: { ...NO_FILTERS, active: "over7" } },
  { id: "view_g2_old", name: "G2 on old firmware", filters: { ...NO_FILTERS, model: "g2", firmware: "1.3.8" } },
];

function seed(): PortalState {
  const added = INTEGRATIONS.filter((i) => SEED_INTEGRATIONS[i.id]);
  return {
    env: "live",
    project: PROJECTS[0].value,
    integrations: { ...SEED_INTEGRATIONS },
    receives: Object.fromEntries([...new Set(added.map((i) => i.categoryId))].map((c) => [c, seedReceives(c)])) as PortalState["receives"],
    capabilities: Object.fromEntries(added.flatMap((i) => i.models).map((m) => [m.id, seedCapabilities(m)])) as PortalState["capabilities"],
    deviceStates: {},
    revoked: [],
    prefs: {},
    mutedIssues: [],
    savedViews: SEED_VIEWS,
    keys: SEED_KEYS,
    endpoints: SEED_ENDPOINTS,
    members: MEMBERS,
    connect: { draft: SEED_CONNECT, published: SEED_CONNECT },
    checklist: { key: true, webhook: true },
    sentCalls: [],
  };
}

interface PortalApi {
  state: PortalState;
  update: (fn: (s: PortalState) => PortalState) => void;
}

const Ctx = createContext<PortalApi | null>(null);

export function PortalProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PortalState>(seed);
  const value = useMemo(() => ({ state, update: setState }), [state]);
  return <Ctx value={value}>{children}</Ctx>;
}

export function usePortal(): PortalApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("usePortal needs PortalProvider");
  return api;
}

/** The env's users with this session's revokes, relinks and preference edits laid over them. */
export function useUsers(): PortalUser[] {
  const { state } = usePortal();
  return useMemo(
    () =>
      ALL_USERS.filter((u) => u.env === state.env).map((u) => ({
        ...u,
        prefs: state.prefs[u.id] ?? u.prefs,
        devices: u.devices
          .filter((d) => !state.revoked.includes(d.id))
          .map((d) => ({ ...d, state: state.deviceStates[d.id] ?? d.state })),
      })),
    [state.env, state.prefs, state.revoked, state.deviceStates]
  );
}

export function useUser(id: string): PortalUser | null {
  const { state } = usePortal();
  const u = ALL_USERS.find((x) => x.id === id);
  if (!u) return null;
  return {
    ...u,
    prefs: state.prefs[u.id] ?? u.prefs,
    devices: u.devices.filter((d) => !state.revoked.includes(d.id)).map((d) => ({ ...d, state: state.deviceStates[d.id] ?? d.state })),
  };
}

export function useCalls(): Call[] {
  const { state } = usePortal();
  return useMemo(() => [...state.sentCalls, ...ALL_CALLS].filter((c) => c.env === state.env), [state.env, state.sentCalls]);
}

/** Adds an integration to the project as Testing; one already added is left alone. */
export function addIntegration(s: PortalState, id: IntegrationId, at: string): PortalState {
  if (s.integrations[id]) return s;
  const integration = integrationById(id)!;
  const category = integration.categoryId;
  return {
    ...s,
    integrations: { ...s.integrations, [id]: { status: "testing", addedAt: at, testsPassed: 0 } },
    receives: s.receives[category] ? s.receives : { ...s.receives, [category]: seedReceives(category) },
    capabilities: { ...s.capabilities, ...(Object.fromEntries(integration.models.map((m) => [m.id, seedCapabilities(m)])) as PortalState["capabilities"]) },
  };
}
