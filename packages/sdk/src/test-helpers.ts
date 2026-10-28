/** Test-only: a recording fetch mock and fixtures shaped after openapi.yaml. Excluded from the build. */
import { vi } from "vitest";

import { Dopl } from "./client.js";

/** Documented fake keys: valid shape, obviously not real (`EXAMPLE` + zeros). Never put a real key here. */
export const SK = "sk_test_EXAMPLE00000000000000"; // gitleaks:allow (documented fake)
export const PK = "pk_test_EXAMPLE00000000000000"; // gitleaks:allow (documented fake)
export const BASE = "https://api.example.test/v1";

export interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export type Reply = { status?: number; body?: unknown; raw?: string; headers?: Record<string, string> };

export function mockFetch(...replies: Reply[]) {
  const calls: Recorded[] = [];
  const queue = [...replies];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: String(init.method),
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const r = queue.length > 1 ? queue.shift()! : (queue[0] ?? { body: {} });
    const text = r.raw ?? (r.body === undefined ? "" : JSON.stringify(r.body));
    return new Response(text, { status: r.status ?? 200, headers: r.headers });
  });
  return { fn, calls };
}

export function client(key: string, ...replies: Reply[]) {
  const m = mockFetch(...replies);
  return { dopl: new Dopl({ apiKey: key, baseUrl: BASE, fetch: m.fn }), ...m };
}

export const DEVICE = {
  id: "dev_sim_01",
  kind: "glasses",
  vendor: "Even Realities",
  model: "G2",
  firmware: null,
  adapter_id: "even_g2",
  adapter_version: "0.3",
  capabilities: [],
  online: true,
  last_seen_at: null,
};

export const DELIVERY = {
  delivery_id: "dlv_1",
  routed_to: { device_id: "dev_sim_01", kind: "glasses", reason: "active" },
  status: "delivered",
};

export function action(status: string, extra: Record<string, unknown> = {}) {
  return {
    action_id: "dlv_1",
    device_id: "dev_sim_01",
    capability: "ask.choice",
    status,
    result: null,
    error: null,
    created_at: "2026-10-27T00:00:00Z",
    updated_at: "2026-10-27T00:00:00Z",
    ...extra,
  };
}

export const CONTEXT = {
  active_device: { id: "dev_sim_01", kind: "glasses", model: "G2", last_seen_s: 3 },
  posture: "glanceable",
  available: [],
  profile: null,
  source_of_last_message: null,
};
