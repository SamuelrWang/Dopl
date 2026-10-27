"use client";

/**
 * THE PLAYGROUND'S `window.dopl`: the in-memory stand-in for the desktop bridge, so the PRODUCT
 * components and hooks run unchanged over fake data (`shared/lib/spa-bridge.ts › getSpaBridge`).
 *
 * Several pieces serve it at once: the frame's layer (the popups, Settings, the shell; see
 * `staging-app-bridge.ts`) and a face's own server (`knowledge-staging/staging-bridge.ts`,
 * `ontology-staging`). Each mount registers a LAYER; `window.dopl` is rebuilt from every live
 * layer, so mount and unmount order never matter. A face layer outranks the frame's base layer
 * for a route both serve; an `apiRequest` that answers `null` passes the request down.
 */

import { useEffect, useState } from "react";
import type { SpaBridgeSurface } from "@/shared/lib/spa-bridge";

export type BridgeOpts = Parameters<SpaBridgeSurface["apiRequest"]>[1];
export type BridgeResponse = Awaited<ReturnType<SpaBridgeSurface["apiRequest"]>>;

/** One server's share of the bridge. `apiRequest` answers `null` for a route it does not serve. */
export type StagingBridgeLayer = Omit<Partial<SpaBridgeSurface>, "apiRequest"> & {
  apiRequest?: (path: string, opts: BridgeOpts) => Promise<BridgeResponse | null>;
} & Record<string, unknown>;

interface Entry {
  layer: StagingBridgeLayer;
  base: boolean;
}

const entries: Entry[] = [];

export const bridgeOk = (body: unknown): BridgeResponse =>
  body === undefined
    ? { status: 204, statusText: "No Content", hasBody: false }
    : { status: 200, statusText: "OK", hasBody: true, body };

export const bridgeFail = (status: number, code: string, message: string): BridgeResponse => ({
  status,
  statusText: "",
  hasBody: true,
  body: { error: { code, message } },
});

/** Face layers first, newest first; the frame's base layers last. */
function ranked(): Entry[] {
  return [...entries.filter((e) => !e.base).reverse(), ...entries.filter((e) => e.base).reverse()];
}

async function apiRequest(path: string, opts: BridgeOpts): Promise<BridgeResponse> {
  for (const { layer } of ranked()) {
    const answer = await layer.apiRequest?.(path, opts);
    if (answer) return answer;
  }
  return bridgeFail(404, "NOT_FOUND", `Staging serves no ${opts.method ?? "GET"} ${path}`);
}

function install(): void {
  const host = window as { dopl?: unknown };
  if (entries.length === 0) {
    delete host.dopl;
    return;
  }
  const merged: Record<string, unknown> = {};
  for (const { layer } of [...ranked()].reverse()) Object.assign(merged, layer);
  host.dopl = { ...merged, apiRequest };
}

/**
 * Registers `layer` for this mount (client-only, an effect) and answers `true` once it is
 * installed, so a face can hold its first read until then. `base` marks the frame's own layer.
 */
export function useStagingBridgeLayer(
  layer: StagingBridgeLayer,
  { base = false }: { base?: boolean } = {}
): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const entry: Entry = { layer, base };
    entries.push(entry);
    install();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot: the face waits for the bridge
    setReady(true);
    return () => {
      entries.splice(entries.indexOf(entry), 1);
      install();
    };
  }, [layer, base]);
  return ready;
}
