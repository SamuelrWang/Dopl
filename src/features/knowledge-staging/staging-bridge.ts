"use client";

/**
 * The staging page's network: an in-memory stand-in for every route the /home Knowledge face
 * calls, served through the SPA bridge's `apiRequest` seam (`shared/lib/spa-bridge.ts`), as
 * `ontology-staging/store/staging-server.ts` does for the Ontology face. The PRODUCT components
 * and hooks run unchanged; the bridge has no sync pair, so realtime is off, and presence stays
 * local (`shared/realtime/use-presence.ts` does not join a channel in the SPA renderer).
 */
import { useEffect, useState } from "react";
import type { SpaBridgeSurface } from "@/shared/lib/spa-bridge";
import { STAGING_USER_ID } from "./data";
import { resetKnowledgeStore } from "./fake-store";
import { FakeHttpError } from "./server/http";
import { matchRoute } from "./server/routes";

type BridgeResponse = Awaited<ReturnType<SpaBridgeSurface["apiRequest"]>>;

/** A short pause, so busy states ("Saving…", spinners, pending rows) are visible. */
const LATENCY_MS = 140;

const fail = (status: number, code: string, message: string): BridgeResponse => ({
  status,
  statusText: "",
  hasBody: true,
  body: { error: { code, message } },
});

async function apiRequest(
  path: string,
  opts: Parameters<SpaBridgeSurface["apiRequest"]>[1]
): Promise<BridgeResponse> {
  const url = new URL(path, "http://staging.invalid");
  const method = (opts.method ?? "GET").toUpperCase();
  const route = matchRoute(method, url.pathname);
  if (!route) return fail(404, "NOT_FOUND", `Staging serves no ${method} ${url.pathname}`);
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  try {
    const body = route.handler({
      method,
      params: route.params,
      query: url.searchParams,
      body: opts.body,
      workspaceId: opts.workspaceId,
    });
    return body === undefined
      ? { status: 204, statusText: "No Content", hasBody: false }
      : { status: 200, statusText: "OK", hasBody: true, body };
  } catch (err) {
    if (err instanceof FakeHttpError) return fail(err.status, err.code, err.message);
    throw err;
  }
}

/**
 * Installs the staging server as `window.dopl` for this mount, on a fresh seed, and restores what
 * was there on unmount. Client-only (an effect), so the page server-renders the empty window.
 */
export function useStagingBridge(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const host = window as { dopl?: unknown };
    const previous = host.dopl;
    resetKnowledgeStore();
    host.dopl = {
      apiRequest,
      getAuthState: async () => ({ signedIn: true, userId: STAGING_USER_ID }),
      openExternal: async (url: string) => {
        window.open(url, "_blank", "noopener");
        return { ok: true };
      },
    } satisfies SpaBridgeSurface;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot: the face waits for the bridge
    setReady(true);
    return () => {
      host.dopl = previous;
    };
  }, []);
  return ready;
}
