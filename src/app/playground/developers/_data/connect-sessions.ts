/**
 * Connect SESSIONS (C2) and the funnel over them: started → device chosen → paired → consented →
 * connected. Deterministic per env, like `./activity.ts`, so server and client draw the same rows.
 */
import type { DeviceKind, Environment } from "@dopl/device-contracts";
import { rng } from "./activity";
import { DEMO_ENVS, ago } from "./fixtures";

export const CONNECT_STEPS = ["started", "device_chosen", "paired", "consented", "connected"] as const;
export type ConnectStep = (typeof CONNECT_STEPS)[number];

export const STEP_LABEL: Record<ConnectStep, string> = {
  started: "Sessions started",
  device_chosen: "Device chosen",
  paired: "Paired",
  consented: "Consented",
  connected: "Connected",
};

export interface ConnectSessionRow {
  /** The Connect token (`ct_…`). */
  id: string;
  env: Environment;
  external_user_id: string;
  adapter_id: string | null;
  kind: DeviceKind | null;
  /** The last step the user reached. */
  reached: ConnectStep;
  steps: Array<{ step: ConnectStep; at: string }>;
  /** Set once the session became a connection. */
  connection_id: string | null;
}

export interface FunnelStep {
  step: ConnectStep;
  count: number;
  /** Share of sessions started that reached this step, 0–100. */
  pct: number;
  /** Share lost since the previous step, 0–100 (0 for the first). */
  drop: number;
}

const stepIndex = (s: ConnectStep) => CONNECT_STEPS.indexOf(s);

export function funnel(sessions: readonly ConnectSessionRow[]): FunnelStep[] {
  const counts = CONNECT_STEPS.map((step) => sessions.filter((s) => stepIndex(s.reached) >= stepIndex(step)).length);
  const first = counts[0];
  return CONNECT_STEPS.map((step, i) => ({
    step,
    count: counts[i],
    pct: first === 0 ? 0 : (counts[i] / first) * 100,
    drop: i === 0 || counts[i - 1] === 0 ? 0 : (1 - counts[i] / counts[i - 1]) * 100,
  }));
}

/** The chance a session that reached step i also reaches step i + 1. */
const CARRY = [0.84, 0.79, 0.93, 0.97];

function build(env: Environment, count: number, seed: number): ConnectSessionRow[] {
  const r = rng(seed);
  const fx = DEMO_ENVS[env];
  const devices = fx.connections.map((c) => c.device);
  const rows: ConnectSessionRow[] = [];
  let minutes = 0;
  for (let i = 0; i < count; i++) {
    minutes += 4 + Math.floor(r() * (env === "live" ? 40 : 160));
    let reached = 0;
    while (reached < CARRY.length && r() < CARRY[reached]) reached++;
    const device = devices[Math.floor(r() * devices.length)];
    const user = env === "live" ? `user_${(4100 + i * 7).toString(36)}` : `user_qa_${i}`;
    const steps = CONNECT_STEPS.slice(0, reached + 1).map((step, k) => ({ step, at: ago(minutes - k * 0.4) }));
    rows.push({
      id: `ct_${env[0]}${(52000 + i * 13).toString(36)}`,
      env,
      external_user_id: user,
      adapter_id: reached >= 1 ? device.adapter_id : null,
      kind: reached >= 1 ? device.kind : null,
      reached: CONNECT_STEPS[reached],
      steps,
      connection_id: reached === CONNECT_STEPS.length - 1 ? `conn_${env[0]}s${i.toString(36)}` : null,
    });
  }
  return rows;
}

export const DEMO_SESSIONS: Record<Environment, ConnectSessionRow[]> = {
  test: build("test", 26, 19),
  live: build("live", 180, 61),
};
