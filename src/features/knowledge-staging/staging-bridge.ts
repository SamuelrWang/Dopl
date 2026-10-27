"use client";

/**
 * The staging page's network: an in-memory stand-in for every route the /home Knowledge face
 * calls, served through the SPA bridge's `apiRequest` seam (`shared/lib/spa-bridge.ts`) as one
 * layer of the playground bridge (`ui-staging/staging-bridge.ts`), as
 * `ontology-staging/store/staging-server.ts` does for the Ontology face. The PRODUCT components
 * and hooks run unchanged; the bridge has no sync pair, so realtime is off, and presence stays
 * local (`shared/realtime/use-presence.ts` does not join a channel in the SPA renderer).
 */
import { useEffect } from "react";
import {
  bridgeFail,
  bridgeOk,
  useStagingBridgeLayer,
  type BridgeOpts,
  type BridgeResponse,
  type StagingBridgeLayer,
} from "@/features/ui-staging/staging-bridge";
import { STAGING_USER_ID } from "./data";
import { resetKnowledgeStore } from "./fake-store";
import { FakeHttpError } from "./server/http";
import { matchRoute } from "./server/routes";

/** A short pause, so busy states ("Saving…", spinners, pending rows) are visible. */
const LATENCY_MS = 140;

async function apiRequest(path: string, opts: BridgeOpts): Promise<BridgeResponse | null> {
  const url = new URL(path, "http://staging.invalid");
  const method = (opts.method ?? "GET").toUpperCase();
  const route = matchRoute(method, url.pathname);
  if (!route) return null;
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  try {
    const body = route.handler({
      method,
      params: route.params,
      query: url.searchParams,
      body: opts.body,
      workspaceId: opts.workspaceId,
    });
    return bridgeOk(body);
  } catch (err) {
    if (err instanceof FakeHttpError) return bridgeFail(err.status, err.code, err.message);
    throw err;
  }
}

const LAYER: StagingBridgeLayer = {
  apiRequest,
  getAuthState: async () => ({ signedIn: true, userId: STAGING_USER_ID }),
};

/**
 * Registers the staging server as this mount's `window.dopl` layer
 * (`ui-staging/staging-bridge.ts`), on a fresh seed. Client-only, so the page server-renders
 * the empty window.
 */
export function useStagingBridge(): boolean {
  useEffect(() => resetKnowledgeStore(), []);
  return useStagingBridgeLayer(LAYER);
}
